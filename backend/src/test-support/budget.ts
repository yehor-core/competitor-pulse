import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { createLlmBudget, type LlmBudget } from '../llm/budget.js';

/** A Daily LLM budget that is never the limit of a test that is about something else. */
export function roomyBudget(pool: pg.Pool): LlmBudget {
  return createLlmBudget({
    db: drizzle(pool),
    policy: { dailyCap: 1000, windowsPerDay: 1 },
    now: () => new Date(),
  });
}
