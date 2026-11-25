import { and, isNull, lte, min, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { competitors } from '../db/schema.js';

/** How long the most overdue Competitor has been waiting for its Poll, in whole seconds. 0 when none is overdue. */
export async function pollLagSeconds(db: NodePgDatabase): Promise<number> {
  const [row] = await db
    .select({
      lag: sql<string | null>`extract(epoch from now() - ${min(competitors.nextPollAt)})`,
    })
    .from(competitors)
    .where(and(isNull(competitors.removedAt), lte(competitors.nextPollAt, sql`now()`)));
  return Math.floor(Number(row?.lag ?? 0));
}
