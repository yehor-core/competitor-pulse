import { drizzle } from 'drizzle-orm/node-postgres';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { runMigrations } from './db/migrate.js';
import { createLlmBudget } from './llm/budget.js';
import { createLlmClient } from './llm/client.js';
import { createScheduler } from './scheduler/scheduler.js';
import { createSourceClient } from './source/client.js';
import { createSummaryWorker, type SummaryWorker } from './summaries/worker.js';
import { startMockLlm, type RunningMockLlm } from './test-support/mock-llm.js';
import { startStubLlm, type StubLlm } from './test-support/stub-llm.js';
import { startStubSource, type StubSource } from './test-support/stub-source.js';
import { roomyBudget } from './test-support/budget.js';

// Real Postgres; the provided mock LLM for slow and failing answers, a scripted LLM for unusable ones.
const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl) || Boolean(process.env.CI);

interface SnapshotJson {
  pollStatus: string;
  changed: boolean;
  summary: string | null;
  summaryStatus: string;
  price: string | null;
}

const listing = {
  title: 'Acme CRM',
  tagline: 'Simple CRM for small teams',
  price: { amount: 29, currency: 'USD', period: 'month' },
  description: 'Track leads and deals in one place.',
};
const found = (patch: Record<string, unknown> = {}) =>
  ({ status: 200, body: { ...listing, ...patch } }) as const;
const dearer = { price: { amount: 39, currency: 'USD', period: 'month' } };

describe.skipIf(!enabled)('Summaries', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let stub: StubSource;
  let mock: RunningMockLlm;
  let scripted: StubLlm | undefined;
  let worker: SummaryWorker;

  const useLlm = (baseUrl: string, timeoutMs = 1000, dailyCap = 100) => {
    worker = createSummaryWorker({
      db: drizzle(pool),
      llm: createLlmClient({ baseUrl, apiKey: 'k', model: 'mock-llm', timeoutMs }),
      budget: createLlmBudget({
        db: drizzle(pool),
        policy: { dailyCap, windowsPerDay: 1 },
        now: () => new Date(),
      }),
      log: app.log,
    });
  };

  async function slotsUsed(): Promise<number> {
    const { rows } = await pool.query<{ used: number }>(
      'select coalesce(sum(used), 0)::int as used from llm_budget',
    );
    return rows[0]?.used ?? 0;
  }

  async function pollOnce(): Promise<void> {
    await pool.query("update competitors set next_poll_at = now() - interval '1 second'");
    await createScheduler({
      db: drizzle(pool),
      source: createSourceClient({ baseUrl: stub.baseUrl, timeoutMs: 500 }),
      log: app.log,
      intervalSeconds: 3600,
      tickMs: 1000,
      maxInFlight: 4,
      budget: { available: () => 4 },
      onChangePending: (snapshotId) => {
        worker.enqueue(snapshotId);
      },
    }).tick();
  }

  async function snapshots(): Promise<SnapshotJson[]> {
    const response = await app.inject({ method: 'GET', url: '/api/competitors/acme/snapshots' });
    return response.json<SnapshotJson[]>();
  }

  /** Polls a baseline, then a changed listing, and waits for the Summary to settle. */
  async function changeAndSettle(): Promise<SnapshotJson[]> {
    await pollOnce();
    stub.answer(found(dearer));
    await pollOnce();
    await worker.idle();
    return snapshots();
  }

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
    await runMigrations(databaseUrl);
    pool = new pg.Pool({ connectionString: databaseUrl });
    mock = await startMockLlm();
    app = buildApp(
      { logLevel: 'silent' },
      pool,
      createSourceClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 100 }),
      roomyBudget(pool),
    );
  });

  afterAll(async () => {
    await app.close();
    await mock.stop();
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('truncate snapshots, competitors, llm_budget cascade');
    await pool.query("insert into competitors (id) values ('acme')");
    stub = await startStubSource(found());
    await mock.reset();
    useLlm(mock.baseUrl);
  });

  afterEach(async () => {
    await stub.stop();
    await scripted?.stop();
    scripted = undefined;
  });

  it('stores the Summary of a Change and leaves other Snapshots without one', async () => {
    const [latest, first] = await changeAndSettle();

    expect(latest).toMatchObject({ changed: true, summaryStatus: 'ready' });
    expect(latest?.summary).toContain('$39/mo');
    expect(first).toMatchObject({ summary: null, summaryStatus: 'not_applicable' });
    expect(await mock.callCount()).toBe(1);
  });

  it('keeps the Snapshot as pending until the LLM answers, without delaying the poll', async () => {
    await mock.configure({ latencyMs: 300 });
    await pollOnce();
    stub.answer(found(dearer));
    await pollOnce();

    const [during] = await snapshots();
    expect(during).toMatchObject({ pollStatus: 'ok', changed: true, summaryStatus: 'pending' });

    await worker.idle();
    expect((await snapshots())[0]).toMatchObject({ summaryStatus: 'ready' });
  });

  it('stores llm_timeout when the LLM is slower than the timeout, and keeps the Snapshot', async () => {
    await mock.configure({ latencyMs: 600 });
    useLlm(mock.baseUrl, 100);

    const [latest] = await changeAndSettle();

    expect(latest).toMatchObject({
      pollStatus: 'ok',
      changed: true,
      price: '$39/mo',
      summary: null,
      summaryStatus: 'llm_timeout',
    });
  });

  it('stores llm_failed when the LLM answers with an error, and does not retry', async () => {
    await mock.configure({ failNext: 1 });

    const [latest] = await changeAndSettle();

    // With one failure queued, a retry would have succeeded; the status proves there was none.
    expect(latest).toMatchObject({ changed: true, summary: null, summaryStatus: 'llm_failed' });
    expect(await mock.callCount()).toBe(0);
  });

  it('stores llm_unusable when the LLM answers with empty or oversized text', async () => {
    scripted = await startStubLlm({ status: 200, content: '   ' });
    useLlm(scripted.baseUrl);

    const [latest] = await changeAndSettle();

    expect(latest).toMatchObject({ changed: true, summary: null, summaryStatus: 'llm_unusable' });
    expect(scripted.requests).toHaveLength(1);
  });

  it('sends the changed field and its old and new values to the LLM', async () => {
    scripted = await startStubLlm({ status: 200, content: 'The price went up.' });
    useLlm(scripted.baseUrl);

    await changeAndSettle();

    expect(JSON.stringify(scripted.requests[0]?.body)).toMatch(/\$29\/mo.*\$39\/mo/);
  });

  it('does not call the LLM when nothing changed or for a delisting', async () => {
    await pollOnce();
    await pollOnce();
    stub.answer({ status: 404 });
    await pollOnce();
    await worker.idle();

    expect(await mock.callCount()).toBe(0);
    expect((await snapshots())[0]).toMatchObject({ summaryStatus: 'ready' });
  });

  describe('Daily LLM budget', () => {
    it('takes one slot for a Change that gets its Summary', async () => {
      await changeAndSettle();

      expect(await slotsUsed()).toBe(1);
    });

    it('stores budget_exhausted without calling the LLM when no slot is left', async () => {
      useLlm(mock.baseUrl, 1000, 0);

      const [latest] = await changeAndSettle();

      expect(latest).toMatchObject({
        pollStatus: 'ok',
        changed: true,
        price: '$39/mo',
        summary: null,
        summaryStatus: 'budget_exhausted',
      });
      expect(await mock.callCount()).toBe(0);
    });

    it('does not backfill a Change that found the budget exhausted', async () => {
      useLlm(mock.baseUrl, 1000, 1);
      await changeAndSettle();
      stub.answer(found({ price: { amount: 49, currency: 'USD', period: 'month' } }));
      await pollOnce();
      await worker.idle();

      const [latest, earlier] = await snapshots();
      expect(latest).toMatchObject({ summaryStatus: 'budget_exhausted', summary: null });
      expect(earlier).toMatchObject({ summaryStatus: 'ready' });
    });

    it('gives the slot back when the request never left', async () => {
      scripted = await startStubLlm({ status: 200, content: 'x' });
      const unreachable = scripted.baseUrl;
      await scripted.stop();
      useLlm(unreachable);

      const [latest] = await changeAndSettle();

      expect(latest).toMatchObject({ summary: null, summaryStatus: 'llm_failed' });
      expect(await slotsUsed()).toBe(0);
    });

    it('keeps the slot after a timeout', async () => {
      await mock.configure({ latencyMs: 600 });
      useLlm(mock.baseUrl, 100);

      const [latest] = await changeAndSettle();

      expect(latest).toMatchObject({ summaryStatus: 'llm_timeout' });
      expect(await slotsUsed()).toBe(1);
    });

    it('keeps the slot after an HTTP error', async () => {
      await mock.configure({ failNext: 1 });

      await changeAndSettle();

      expect(await slotsUsed()).toBe(1);
    });

    it('keeps the slot after unusable output', async () => {
      scripted = await startStubLlm({ status: 200, content: '   ' });
      useLlm(scripted.baseUrl);

      await changeAndSettle();

      expect(await slotsUsed()).toBe(1);
    });
  });
});
