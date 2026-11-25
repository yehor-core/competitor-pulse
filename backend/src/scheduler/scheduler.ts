import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { FastifyBaseLogger } from 'fastify';
import { competitors, snapshots } from '../db/schema.js';
import { compareWithBaseline } from '../domain/compare.js';
import { comparableOf, outcomeOf } from '../snapshots/model.js';
import type { SourceClient } from '../source/client.js';
import { pollLagSeconds } from './poll-lag.js';

export interface SchedulerOptions {
  db: NodePgDatabase;
  source: SourceClient;
  log: FastifyBaseLogger;
  intervalSeconds: number;
  tickMs: number;
  /** Cap on Polls running at once, across ticks. */
  maxInFlight: number;
  /** How many more requests the Rate limit allows right now; a Poll is claimed only when one is free. */
  budget: { available(): number };
}

export interface Scheduler {
  start(): void;
  /** Stops ticking and waits for Polls that are already running. */
  stop(): Promise<void>;
  /** Claims due Competitors and polls them. Exposed so tests can drive time. */
  tick(): Promise<void>;
}

export function createScheduler(options: SchedulerOptions): Scheduler {
  const { db, source, log, intervalSeconds, tickMs, maxInFlight, budget } = options;
  let timer: NodeJS.Timeout | undefined;
  let inFlight = 0;
  const running = new Set<Promise<void>>();

  // The next Poll time is written in the same transaction that claims the row, so a crash after the claim
  // costs one Poll but never leaves a Competitor stuck, and concurrent claimers never take the same row.
  async function claimDue(limit: number): Promise<string[]> {
    return db.transaction(async (tx) => {
      const due = await tx
        .select({ id: competitors.id })
        .from(competitors)
        .where(and(isNull(competitors.removedAt), lte(competitors.nextPollAt, sql`now()`)))
        .orderBy(asc(competitors.nextPollAt))
        .limit(limit)
        .for('update', { skipLocked: true });
      const ids = due.map((row) => row.id);
      for (const id of ids) {
        await tx
          .update(competitors)
          .set({ nextPollAt: sql`now() + make_interval(secs => ${intervalSeconds})` })
          .where(eq(competitors.id, id));
      }
      return ids;
    });
  }

  async function poll(id: string): Promise<void> {
    const fetchedAt = new Date();
    const outcome = outcomeOf(await source.fetchListing(id));
    await db.transaction(async (tx) => {
      // Failed and incomplete Snapshots hold no listing, so only ok and delisted Snapshots say what came before.
      const [lastKnown] = await tx
        .select()
        .from(snapshots)
        .where(
          and(eq(snapshots.competitorId, id), inArray(snapshots.pollStatus, ['ok', 'delisted'])),
        )
        .orderBy(desc(snapshots.fetchedAt), desc(snapshots.id))
        .limit(1);
      const [lastOk] =
        lastKnown?.pollStatus === 'ok'
          ? [lastKnown]
          : await tx
              .select()
              .from(snapshots)
              .where(and(eq(snapshots.competitorId, id), eq(snapshots.pollStatus, 'ok')))
              .orderBy(desc(snapshots.fetchedAt), desc(snapshots.id))
              .limit(1);
      const comparison = compareWithBaseline(
        {
          baseline: lastOk ? comparableOf(lastOk) : null,
          wasDelisted: lastKnown?.pollStatus === 'delisted',
        },
        {
          pollStatus: outcome.pollStatus,
          listing: outcome.listing && comparableOf(outcome.listing),
        },
      );
      await tx.insert(snapshots).values({
        competitorId: id,
        fetchedAt,
        pollStatus: outcome.pollStatus,
        failureReason: outcome.failureReason,
        ...outcome.listing,
        changed: comparison.changed,
        summary: comparison.summary,
        summaryStatus: comparison.summaryStatus,
      });
      await tx
        .update(competitors)
        .set({ awaitingFirstPollReason: null })
        .where(eq(competitors.id, id));
    });
    log.info(
      { competitorId: id, pollStatus: outcome.pollStatus, failureReason: outcome.failureReason },
      'poll finished',
    );
  }

  async function tick(): Promise<void> {
    // In-flight slots are reserved before the claim awaits, so overlapping ticks cannot overshoot the cap.
    const slots = Math.min(maxInFlight - inFlight, budget.available());
    if (slots <= 0) return;
    inFlight += slots;
    let ids: string[] = [];
    try {
      const lag = await pollLagSeconds(db);
      ids = await claimDue(slots);
      if (lag > 0) log.info({ pollLagSeconds: lag, claimed: ids.length }, 'polls are overdue');
    } finally {
      inFlight -= slots - ids.length;
    }
    const results = await Promise.allSettled(
      ids.map((id) => poll(id).finally(() => (inFlight -= 1))),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        log.error({ err: result.reason, competitorId: ids[index] }, 'poll could not be stored');
      }
    });
  }

  // Ticks are not awaited by the timer: a slow Source must not stop other due Polls from starting.
  function schedule(): void {
    timer = setTimeout(() => {
      const current = tick()
        .catch((error: unknown) => {
          log.error({ err: error }, 'scheduler tick failed');
        })
        .finally(() => running.delete(current));
      running.add(current);
      if (timer !== undefined) schedule();
    }, tickMs);
  }

  return {
    tick,
    start() {
      if (timer === undefined) schedule();
    },
    async stop() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      await Promise.all(running);
    },
  };
}
