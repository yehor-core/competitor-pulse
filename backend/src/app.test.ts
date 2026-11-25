import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { buildApp } from './app.js';
import { createLlmBudget } from './llm/budget.js';
import { createSourceClient } from './source/client.js';
import { roomyBudget } from './test-support/budget.js';

// Real Postgres, as the project rules require. CI provides it; locally use `docker compose up -d postgres`.
const databaseUrl = process.env.TEST_DATABASE_URL;

// The health check never touches the Source.
const unusedSource = createSourceClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 100 });

describe.each(['/health', '/api/health'])('GET %s', (url) => {
  const pools: pg.Pool[] = [];
  afterAll(async () => {
    await Promise.all(pools.map((pool) => pool.end()));
  });

  it.skipIf(!databaseUrl && !process.env.CI)(
    'answers 200 when the database is reachable',
    async () => {
      const pool = new pg.Pool({ connectionString: databaseUrl });
      pools.push(pool);
      await pool.query('truncate llm_budget');
      const budget = createLlmBudget({
        db: drizzle(pool),
        policy: { dailyCap: 10, windowsPerDay: 1 },
        now: () => new Date(),
      });
      await budget.reserve();
      const app = buildApp({ logLevel: 'silent' }, pool, unusedSource, budget);

      const response = await app.inject({ method: 'GET', url });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: 'ok',
        pollLagSeconds: 0,
        llmBudget: { dailyCap: 10, used: 1, remainingToday: 9, availableNow: 9 },
      });
    },
  );

  it('answers 503 with a reason when the database is unreachable', async () => {
    const pool = new pg.Pool({
      connectionString: 'postgres://nobody:nothing@127.0.0.1:1/none',
      connectionTimeoutMillis: 500,
    });
    pools.push(pool);
    const app = buildApp({ logLevel: 'silent' }, pool, unusedSource, roomyBudget(pool));

    const response = await app.inject({ method: 'GET', url });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable', reason: 'database unreachable' });
  });
});
