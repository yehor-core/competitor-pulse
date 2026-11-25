import { and, desc, eq, lt, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { FastifyBaseLogger } from 'fastify';
import { snapshots } from '../db/schema.js';
import { compareWithBaseline } from '../domain/compare.js';
import { buildSummaryPrompt, type PromptListing } from '../domain/summary-text.js';
import type { LlmClient, LlmResult } from '../llm/client.js';
import { comparableOf } from '../snapshots/model.js';

export interface SummaryWorkerOptions {
  db: NodePgDatabase;
  llm: LlmClient;
  log: FastifyBaseLogger;
}

export interface SummaryWorker {
  /** Starts writing the Summary of a pending Change in the background; never throws and never blocks. */
  enqueue(snapshotId: number): void;
  /** Resolves when every enqueued Summary is settled. */
  idle(): Promise<void>;
}

type SnapshotRow = typeof snapshots.$inferSelect;

const STATUS_OF: Record<Exclude<LlmResult['kind'], 'ok'>, string> = {
  timeout: 'llm_timeout',
  failed: 'llm_failed',
  unusable: 'llm_unusable',
};

function promptListingOf(row: SnapshotRow): PromptListing | null {
  const { title, tagline, price, description } = row;
  if (title === null || tagline === null || price === null || description === null) return null;
  return { title, tagline, price, description };
}

export function createSummaryWorker({ db, llm, log }: SummaryWorkerOptions): SummaryWorker {
  const running = new Set<Promise<void>>();

  async function baselineOf(row: SnapshotRow): Promise<SnapshotRow | undefined> {
    // The Baseline is the latest ok Snapshot before this one, never a delisted or failed one.
    const [baseline] = await db
      .select()
      .from(snapshots)
      .where(
        and(
          eq(snapshots.competitorId, row.competitorId),
          eq(snapshots.pollStatus, 'ok'),
          or(
            lt(snapshots.fetchedAt, row.fetchedAt),
            and(eq(snapshots.fetchedAt, row.fetchedAt), lt(snapshots.id, row.id)),
          ),
        ),
      )
      .orderBy(desc(snapshots.fetchedAt), desc(snapshots.id))
      .limit(1);
    return baseline;
  }

  async function store(row: SnapshotRow, summaryStatus: string, summary: string | null) {
    // Guarded on pending so a Summary that is already settled is never overwritten.
    await db
      .update(snapshots)
      .set({ summary, summaryStatus })
      .where(and(eq(snapshots.id, row.id), eq(snapshots.summaryStatus, 'pending')));
  }

  async function summarize(snapshotId: number): Promise<void> {
    const [row] = await db.select().from(snapshots).where(eq(snapshots.id, snapshotId));
    if (row?.summaryStatus !== 'pending') return;
    const baseline = await baselineOf(row);
    const baselineListing = baseline && promptListingOf(baseline);
    const current = promptListingOf(row);
    const baselineComparable = baseline && comparableOf(baseline);
    const currentComparable = comparableOf(row);
    if (!baselineListing || !current || !baselineComparable || !currentComparable) {
      log.error({ snapshotId }, 'pending Change has no listing to compare; marking Summary failed');
      await store(row, STATUS_OF.failed, null);
      return;
    }
    const { changedFields } = compareWithBaseline(
      { baseline: baselineComparable, wasDelisted: false },
      { pollStatus: 'ok', listing: currentComparable },
    );
    const prompt = buildSummaryPrompt(baselineListing, current, changedFields);

    // Ticket 07 seam: reserve a Daily LLM budget slot here, before the call. When none is left, store
    // `budget_exhausted` with a null Summary and return. Refund the slot only when the request provably
    // never left (see ADR-0002); the LlmResult kinds below all mean the request was sent.
    const result = await llm.complete(prompt);

    if (result.kind === 'ok') {
      await store(row, 'ready', result.text);
    } else {
      log.warn({ snapshotId, outcome: result.kind }, 'Summary could not be written');
      await store(row, STATUS_OF[result.kind], null);
    }
  }

  return {
    enqueue(snapshotId) {
      const task = summarize(snapshotId)
        .catch((error: unknown) => {
          // The Snapshot is already stored; a Summary that cannot be settled stays pending rather than lost.
          log.error({ err: error, snapshotId }, 'Summary could not be stored');
        })
        .finally(() => running.delete(task));
      running.add(task);
    },
    idle: async () => {
      while (running.size > 0) await Promise.all(running);
    },
  };
}
