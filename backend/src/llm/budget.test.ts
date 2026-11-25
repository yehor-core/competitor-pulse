import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { createLlmBudget } from './budget.js';

// Real Postgres: the guarantees under test are atomicity and surviving a restart.
const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl) || Boolean(process.env.CI);

describe.skipIf(!enabled)('Daily LLM budget', () => {
  let pool: pg.Pool;
  let clock: Date;

  const budgetWith = (policy: { dailyCap: number; windowsPerDay: number }) =>
    createLlmBudget({ db: drizzle(pool), policy, now: () => clock });

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
    await runMigrations(databaseUrl);
    pool = new pg.Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('truncate llm_budget');
    clock = new Date('2026-03-04T12:00:00Z');
  });

  it('hands out slots until the daily cap and then none', async () => {
    const budget = budgetWith({ dailyCap: 3, windowsPerDay: 1 });

    expect(await budget.reserve()).not.toBeNull();
    expect(await budget.reserve()).not.toBeNull();
    expect(await budget.reserve()).not.toBeNull();
    expect(await budget.reserve()).toBeNull();
    expect(await budget.status()).toMatchObject({ dailyCap: 3, used: 3, remainingToday: 0 });
  });

  it('never exceeds the cap when many reservations race', async () => {
    const budget = budgetWith({ dailyCap: 5, windowsPerDay: 1 });

    const results = await Promise.all(Array.from({ length: 20 }, () => budget.reserve()));

    expect(results.filter((slot) => slot !== null)).toHaveLength(5);
    expect((await budget.status()).used).toBe(5);
  });

  it('keeps counting after a restart', async () => {
    const policy = { dailyCap: 2, windowsPerDay: 1 };
    await budgetWith(policy).reserve();
    await budgetWith(policy).reserve();

    const afterRestart = budgetWith(policy);

    expect(await afterRestart.reserve()).toBeNull();
    expect((await afterRestart.status()).used).toBe(2);
  });

  it('gives a slot back on refund, once', async () => {
    const budget = budgetWith({ dailyCap: 1, windowsPerDay: 1 });
    const slot = await budget.reserve();

    await slot?.refund();
    await slot?.refund();

    expect((await budget.status()).used).toBe(0);
    expect(await budget.reserve()).not.toBeNull();
    expect(await budget.reserve()).toBeNull();
  });

  it('starts a fresh count on the next UTC day', async () => {
    const budget = budgetWith({ dailyCap: 1, windowsPerDay: 1 });
    await budget.reserve();
    expect(await budget.reserve()).toBeNull();

    clock = new Date('2026-03-05T00:00:00Z');

    expect(await budget.reserve()).not.toBeNull();
  });

  it('refunds into the day it was reserved on, even after midnight', async () => {
    const budget = budgetWith({ dailyCap: 2, windowsPerDay: 1 });
    clock = new Date('2026-03-04T23:59:59Z');
    const slot = await budget.reserve();
    clock = new Date('2026-03-05T00:00:01Z');

    await slot?.refund();

    const { rows } = await pool.query<{ day: string; used: number }>(
      'select day, used from llm_budget order by day',
    );
    expect(rows).toEqual([{ day: '2026-03-04', used: 0 }]);
  });

  describe('Hourly allowance', () => {
    const policy = { dailyCap: 48, windowsPerDay: 24 };

    it('holds back reservations beyond the allowance of the hours so far', async () => {
      clock = new Date('2026-03-04T00:10:00Z');
      const budget = budgetWith(policy);

      const first = await Promise.all(Array.from({ length: 5 }, () => budget.reserve()));

      expect(first.filter((slot) => slot !== null)).toHaveLength(2);
      expect(await budget.status()).toMatchObject({ used: 2, remainingToday: 46, availableNow: 0 });
    });

    it('carries unused allowance over to later hours of the same day', async () => {
      clock = new Date('2026-03-04T00:10:00Z');
      const budget = budgetWith(policy);
      await budget.reserve();

      clock = new Date('2026-03-04T02:10:00Z');

      expect(await budget.status()).toMatchObject({ used: 1, availableNow: 5 });
      const burst = await Promise.all(Array.from({ length: 8 }, () => budget.reserve()));
      expect(burst.filter((slot) => slot !== null)).toHaveLength(5);
    });
  });
});
