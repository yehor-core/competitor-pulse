import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { runMigrations } from './db/migrate.js';
import { createSourceClient } from './source/client.js';
import { startSource, type RunningSource } from './test-support/source.js';

// Real Postgres and the provided Source, as the project rules require.
const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl) || Boolean(process.env.CI);

describe.skipIf(!enabled)('competitors API', () => {
  let pool: pg.Pool;
  let source: RunningSource;

  const app = () =>
    buildApp(
      { logLevel: 'silent' },
      pool,
      createSourceClient({ baseUrl: source.baseUrl, timeoutMs: 500 }),
    );

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
    await runMigrations(databaseUrl);
    pool = new pg.Pool({ connectionString: databaseUrl });
    source = await startSource();
  });

  afterAll(async () => {
    await source.stop();
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('truncate competitors');
    await source.configure({ failNext: 0, timeoutNext: 0 });
  });

  it('adds a competitor the Source knows and lists it', async () => {
    const server = app();

    const added = await server.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: { id: source.knownId },
    });
    const listed = await server.inject({ method: 'GET', url: '/api/competitors' });

    expect(added.statusCode).toBe(201);
    expect(listed.json()).toEqual([{ id: source.knownId, awaitingFirstPollReason: null }]);
  });

  it('rejects an id the Source does not know with 422 and stores nothing', async () => {
    const server = app();

    const added = await server.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: { id: 'no-such-competitor' },
    });
    const listed = await server.inject({ method: 'GET', url: '/api/competitors' });

    expect(added.statusCode).toBe(422);
    expect(listed.json()).toEqual([]);
  });

  it('rejects a malformed id with 400', async () => {
    const added = await app().inject({
      method: 'POST',
      url: '/api/competitors',
      payload: { id: '../etc?x=1' },
    });

    expect(added.statusCode).toBe(400);
  });

  it('stores the competitor as waiting for its first Poll, with the reason, when the Source fails', async () => {
    await source.configure({ failNext: 1 });
    const server = app();

    const added = await server.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: { id: 'acme-crm' },
    });
    const listed = await server.inject({ method: 'GET', url: '/api/competitors' });

    expect(added.statusCode).toBe(201);
    expect(added.json<{ awaitingFirstPollReason: string }>().awaitingFirstPollReason).toContain(
      '5',
    );
    expect(listed.json()).toEqual([added.json()]);
  });

  it('stores the competitor as waiting when the Source does not answer in time', async () => {
    await source.configure({ timeoutNext: 1 });

    const added = await app().inject({
      method: 'POST',
      url: '/api/competitors',
      payload: { id: 'acme-crm' },
    });

    expect(added.statusCode).toBe(201);
    expect(added.json<{ awaitingFirstPollReason: string }>().awaitingFirstPollReason).toMatch(
      /timed out/i,
    );
  });

  it('removing hides the competitor; adding it again restores it without asking the Source', async () => {
    const server = app();
    await server.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: { id: source.knownId },
    });

    const removed = await server.inject({
      method: 'DELETE',
      url: `/api/competitors/${source.knownId}`,
    });
    const afterRemove = await server.inject({ method: 'GET', url: '/api/competitors' });
    await source.configure({ failNext: 1 });
    const readded = await server.inject({
      method: 'POST',
      url: '/api/competitors',
      payload: { id: source.knownId },
    });
    const afterReadd = await server.inject({ method: 'GET', url: '/api/competitors' });

    expect(removed.statusCode).toBe(204);
    expect(afterRemove.json()).toEqual([]);
    expect(readded.statusCode).toBe(201);
    expect(afterReadd.json()).toEqual([{ id: source.knownId, awaitingFirstPollReason: null }]);
  });

  it('answers 404 when removing a competitor that was never tracked', async () => {
    const removed = await app().inject({ method: 'DELETE', url: '/api/competitors/never-added' });

    expect(removed.statusCode).toBe(404);
  });
});
