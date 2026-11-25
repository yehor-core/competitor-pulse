import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createLlmBudget } from '../llm/budget.js';
import { createSourceClient } from '../source/client.js';
import { startStubSource } from '../test-support/stub-source.js';
import { createMetrics } from './metrics.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe('GET /metrics', () => {
  const pools: pg.Pool[] = [];
  afterAll(async () => {
    await Promise.all(pools.map((pool) => pool.end()));
  });

  it.skipIf(!databaseUrl && !process.env.CI)(
    'exposes Poll lag, Poll status counts, Source response codes, Summary status counts, and the remaining Daily LLM budget',
    async () => {
      const pool = new pg.Pool({ connectionString: databaseUrl });
      pools.push(pool);
      await pool.query('truncate llm_budget');
      const db = drizzle(pool);
      const budget = createLlmBudget({
        db,
        policy: { dailyCap: 10, windowsPerDay: 1 },
        now: () => new Date(),
      });
      await budget.reserve();
      const metrics = createMetrics({ db, budget });
      metrics.pollFinished('ok');
      metrics.pollFinished('ok');
      metrics.pollFinished('failed');
      metrics.sourceResponse('200');
      metrics.sourceResponse('429');
      metrics.summarySettled('ready');
      const source = createSourceClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 100 });
      const app = buildApp({ logLevel: 'silent' }, pool, source, budget, metrics);

      const response = await app.inject({ method: 'GET', url: '/metrics' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/^text\/plain/);
      expect(response.body).toContain('competitor_pulse_poll_lag_seconds 0');
      expect(response.body).toContain('competitor_pulse_polls_total{poll_status="ok"} 2');
      expect(response.body).toContain('competitor_pulse_polls_total{poll_status="failed"} 1');
      expect(response.body).toContain('competitor_pulse_source_responses_total{outcome="200"} 1');
      expect(response.body).toContain('competitor_pulse_source_responses_total{outcome="429"} 1');
      expect(response.body).toContain('competitor_pulse_llm_calls_total{summary_status="ready"} 1');
      expect(response.body).toContain('competitor_pulse_llm_budget_remaining 9');
    },
  );
});

describe('Source client outcomes', () => {
  it('reports the HTTP status, and a named outcome when there is no response', async () => {
    const source = await startStubSource({ status: 404 });
    try {
      const outcomes: string[] = [];
      const answered = createSourceClient({
        baseUrl: source.baseUrl,
        timeoutMs: 500,
        onResponse: (outcome) => outcomes.push(outcome),
      });
      await answered.fetchListing('anything');
      const unreachable = createSourceClient({
        baseUrl: 'http://127.0.0.1:1',
        timeoutMs: 200,
        onResponse: (outcome) => outcomes.push(outcome),
      });
      await unreachable.fetchListing('x');

      expect(outcomes).toEqual(['404', 'unreachable']);
    } finally {
      await source.stop();
    }
  });
});
