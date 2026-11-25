import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { llmBudget } from '../db/schema.js';
import { allowedUsedAt, utcDayOf, type BudgetPolicy } from '../domain/llm-budget.js';

export interface BudgetReservation {
  /** Gives the slot back; only for a request that provably never left. A second call does nothing. */
  refund(): Promise<void>;
}

export interface BudgetStatus {
  dailyCap: number;
  used: number;
  remainingToday: number;
  /** Slots the Hourly allowance lets through right now. */
  availableNow: number;
}

export interface LlmBudget {
  /** Takes one slot, or returns null when the Daily LLM budget or the Hourly allowance has none. */
  reserve(): Promise<BudgetReservation | null>;
  status(): Promise<BudgetStatus>;
}

export interface LlmBudgetOptions {
  db: NodePgDatabase;
  policy: BudgetPolicy;
  now: () => Date;
}

export function createLlmBudget({ db, policy, now }: LlmBudgetOptions): LlmBudget {
  return {
    async reserve() {
      const current = now();
      const day = utcDayOf(current);
      const allowed = allowedUsedAt(current, policy);
      // One statement checks the allowance and takes the slot, so racing callers cannot pass the cap together.
      const result = await db.execute(sql`
        insert into llm_budget (day, used)
        select ${day}, 1 where ${allowed} >= 1
        on conflict (day) do update set used = llm_budget.used + 1
        where llm_budget.used < ${allowed}
        returning used`);
      if (result.rows.length === 0) return null;

      let refunded = false;
      return {
        async refund() {
          if (refunded) return;
          refunded = true;
          // Against the day it was taken on, so a refund after midnight does not touch the new day.
          await db
            .update(llmBudget)
            .set({ used: sql`greatest(${llmBudget.used} - 1, 0)` })
            .where(eq(llmBudget.day, day));
        },
      };
    },

    async status() {
      const current = now();
      const [row] = await db
        .select({ used: llmBudget.used })
        .from(llmBudget)
        .where(eq(llmBudget.day, utcDayOf(current)));
      const used = row?.used ?? 0;
      return {
        dailyCap: policy.dailyCap,
        used,
        remainingToday: Math.max(policy.dailyCap - used, 0),
        availableNow: Math.max(allowedUsedAt(current, policy) - used, 0),
      };
    },
  };
}
