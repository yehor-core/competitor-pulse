import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { FastifyBaseLogger } from 'fastify';
import { competitors, snapshots } from '../db/schema.js';
import { outcomeOf } from '../snapshots/model.js';
import type { SourceClient } from '../source/client.js';

export interface SchedulerOptions {
  db: NodePgDatabase;
  source: SourceClient;
  log: FastifyBaseLogger;
  intervalSeconds: number;
  tickMs: number;
  maxInFlight: number;
}

export interface Scheduler {
  start(): void;
  /** Stops ticking and waits for Polls that are already running. */
  stop(): Promise<void>;
  /** Claims due Competitors and polls them. Exposed so tests can drive time. */
  tick(): Promise<void>;
}

export function createScheduler(options: SchedulerOptions): Scheduler {
  const { db, source, log, intervalSeconds, tickMs, maxInFlight } = options;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

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
      await tx.insert(snapshots).values({
        competitorId: id,
        fetchedAt,
        pollStatus: outcome.pollStatus,
        failureReason: outcome.failureReason,
        ...outcome.listing,
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
    const ids = await claimDue(maxInFlight);
    const results = await Promise.allSettled(ids.map((id) => poll(id)));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        log.error({ err: result.reason, competitorId: ids[index] }, 'poll could not be stored');
      }
    });
  }

  function schedule(): void {
    timer = setTimeout(() => {
      running = tick()
        .catch((error: unknown) => {
          log.error({ err: error }, 'scheduler tick failed');
        })
        .then(() => {
          if (timer !== undefined) schedule();
        });
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
      await running;
    },
  };
}
