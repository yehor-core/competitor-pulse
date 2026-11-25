import { drizzle } from 'drizzle-orm/node-postgres';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { runMigrations } from './db/migrate.js';
import { createScheduler } from './scheduler/scheduler.js';
import { createSourceClient } from './source/client.js';
import { startSource, type RunningSource } from './test-support/source.js';
import { startStubSource, type StubSource } from './test-support/stub-source.js';

// Real Postgres; the provided Source for versions, a scripted stub where the exact Listing matters.
const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl) || Boolean(process.env.CI);

interface SnapshotJson {
  title: string | null;
  tagline: string | null;
  description: string | null;
  price: string | null;
  priceParts: { amount: number; currency: string | null; period: string | null } | null;
  changed: boolean;
  summary: string | null;
  summaryStatus: string;
  pollStatus: string;
}

interface CompetitorJson {
  id: string;
  lastChangedAt: string | null;
  changedInLast24h: boolean;
  lastPolledAt: string | null;
  lastPollStatus: string | null;
}

const listing = {
  title: 'Acme CRM',
  tagline: 'Simple CRM for small teams',
  price: { amount: 29, currency: 'USD', period: 'month' },
  description: 'Track leads and deals in one place.',
};
const found = (patch: Record<string, unknown> = {}) =>
  ({ status: 200, body: { ...listing, ...patch } }) as const;

describe.skipIf(!enabled)('change detection', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let stub: StubSource;
  let source: RunningSource;

  const scheduler = (baseUrl: string) =>
    createScheduler({
      db: drizzle(pool),
      source: createSourceClient({ baseUrl, timeoutMs: 500 }),
      log: app.log,
      intervalSeconds: 3600,
      tickMs: 1000,
      maxInFlight: 4,
      budget: { available: () => 4 },
    });

  async function pollOnce(baseUrl = stub.baseUrl): Promise<void> {
    await pool.query("update competitors set next_poll_at = now() - interval '1 second'");
    await scheduler(baseUrl).tick();
  }

  async function snapshotsOf(id: string): Promise<SnapshotJson[]> {
    const response = await app.inject({ method: 'GET', url: `/api/competitors/${id}/snapshots` });
    return response.json<SnapshotJson[]>();
  }

  async function add(id: string): Promise<void> {
    await pool.query('insert into competitors (id) values ($1)', [id]);
  }

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
    await runMigrations(databaseUrl);
    pool = new pg.Pool({ connectionString: databaseUrl });
    source = await startSource();
    app = buildApp(
      { logLevel: 'silent' },
      pool,
      createSourceClient({ baseUrl: source.baseUrl, timeoutMs: 500 }),
    );
  });

  afterAll(async () => {
    await app.close();
    await source.stop();
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('truncate snapshots, competitors cascade');
    stub = await startStubSource(found());
  });

  afterEach(async () => {
    await stub.stop();
  });

  it('has nothing to compare for the first Snapshot and exposes priceParts', async () => {
    await add('acme');
    await pollOnce();

    const [first] = await snapshotsOf('acme');

    expect(first).toMatchObject({
      changed: false,
      summary: null,
      summaryStatus: 'not_applicable',
      priceParts: { amount: 29, currency: 'USD', period: 'month' },
    });
  });

  it('marks a content change as a Change whose Summary is pending', async () => {
    await add('acme');
    await pollOnce();
    stub.answer(found({ price: { amount: 39, currency: 'USD', period: 'month' } }));
    await pollOnce();

    const [latest, first] = await snapshotsOf('acme');

    expect(first?.changed).toBe(false);
    expect(latest).toMatchObject({
      changed: true,
      summary: null,
      summaryStatus: 'pending',
      price: '$39/mo',
    });
  });

  it('does not count a cosmetic difference as a Change', async () => {
    await add('acme');
    await pollOnce();
    stub.answer(found({ title: '  ACME  crm ', price: '$29/month' }));
    await pollOnce();

    const [latest] = await snapshotsOf('acme');

    expect(latest?.changed).toBe(false);
  });

  it('compares with the Baseline, which failed and incomplete Polls never replace', async () => {
    await add('acme');
    await pollOnce();
    stub.answer(found({ tagline: null }));
    await pollOnce();
    stub.answer({ status: 200, body: { ...listing, title: 'Acme CRM 2' } });
    await pollOnce();
    stub.answer(found());
    await pollOnce();

    const [back, changed, incomplete] = await snapshotsOf('acme');

    expect(incomplete).toMatchObject({ pollStatus: 'incomplete', changed: false });
    expect(changed?.changed).toBe(true);
    // The Baseline is now the changed listing, so the original listing is a Change again.
    expect(back).toMatchObject({ pollStatus: 'ok', changed: true });
  });

  it('treats delisting as a Change with fixed text, once, and a return as a Change', async () => {
    await add('acme');
    await pollOnce();
    stub.answer({ status: 404 });
    await pollOnce();
    await pollOnce();
    stub.answer(found());
    await pollOnce();

    const [returned, stillGone, delisted] = await snapshotsOf('acme');

    expect(delisted).toMatchObject({
      pollStatus: 'delisted',
      changed: true,
      summaryStatus: 'ready',
    });
    expect(delisted?.summary).toMatch(/delisted/);
    expect(stillGone).toMatchObject({ pollStatus: 'delisted', changed: false });
    expect(returned).toMatchObject({ pollStatus: 'ok', changed: true, summaryStatus: 'ready' });
    expect(returned?.summary).toMatch(/returned/);
  });

  it('compares a return with the last ok Snapshot, so changed content needs the LLM', async () => {
    await add('acme');
    await pollOnce();
    stub.answer({ status: 404 });
    await pollOnce();
    stub.answer(found({ title: 'Acme CRM 2' }));
    await pollOnce();

    const [returned] = await snapshotsOf('acme');

    expect(returned).toMatchObject({ changed: true, summary: null, summaryStatus: 'pending' });
  });

  it('lists lastChangedAt, changedInLast24h, lastPolledAt and lastPollStatus', async () => {
    await add('acme');
    await add('quiet');
    await pollOnce();
    stub.answer(found({ title: 'Acme CRM 2' }));
    await pool.query("update competitors set next_poll_at = now() - interval '1 second'");
    await scheduler(stub.baseUrl).tick();
    stub.answer({ status: 404 });
    await pool.query(
      "update competitors set next_poll_at = now() + interval '1 hour' where id = 'quiet'",
    );
    await pool.query(
      "update competitors set next_poll_at = now() - interval '1 second' where id = 'acme'",
    );
    await scheduler(stub.baseUrl).tick();

    const response = await app.inject({ method: 'GET', url: '/api/competitors' });
    const [acme, quiet] = response.json<CompetitorJson[]>();

    expect(acme).toMatchObject({ id: 'acme', changedInLast24h: true, lastPollStatus: 'delisted' });
    expect(Number.isNaN(Date.parse(acme?.lastChangedAt ?? ''))).toBe(false);
    expect(Number.isNaN(Date.parse(acme?.lastPolledAt ?? ''))).toBe(false);
    expect(quiet).toMatchObject({ id: 'quiet' });
  });

  it('reports no recent change for a Competitor that was never polled or changed', async () => {
    await add('quiet');

    const response = await app.inject({ method: 'GET', url: '/api/competitors' });

    expect(response.json()).toEqual([
      expect.objectContaining({
        id: 'quiet',
        lastChangedAt: null,
        changedInLast24h: false,
        lastPolledAt: null,
        lastPollStatus: null,
      }),
    ]);
  });

  it('does not count an old Change as changed in the last 24 hours', async () => {
    await add('acme');
    await pollOnce();
    stub.answer(found({ title: 'Acme CRM 2' }));
    await pollOnce();
    await pool.query("update snapshots set fetched_at = fetched_at - interval '25 hours'");

    const [acme] = (await app.inject({ method: 'GET', url: '/api/competitors' })).json<
      CompetitorJson[]
    >();

    expect(acme?.changedInLast24h).toBe(false);
    expect(acme?.lastChangedAt).not.toBeNull();
  });

  it('agrees with the content differences between Snapshots of the provided Source', async () => {
    await add(source.knownId);
    await pollOnce(source.baseUrl);
    await pollOnce(source.baseUrl);
    await source.advance(source.knownId);
    await pollOnce(source.baseUrl);

    const [after, repeat, first] = await snapshotsOf(source.knownId);

    // Noise and format variants of one version must not look like a Change.
    expect(first?.changed).toBe(false);
    expect(repeat?.changed).toBe(false);
    const content = (s: SnapshotJson | undefined) =>
      [s?.title, s?.tagline, s?.price, s?.description].join('|').toLowerCase();
    expect(after?.pollStatus).toBe('ok');
    expect(after?.changed).toBe(content(after) !== content(repeat));
  });
});
