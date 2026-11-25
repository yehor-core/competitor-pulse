import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { runMigrations } from '../db/migrate.js';
import { createSourceClient, type SourceClient } from '../source/client.js';
import { startSource, type RunningSource } from '../test-support/source.js';
import { createScheduler } from './scheduler.js';

// Real Postgres and the provided Source, as the project rules require.
const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl) || Boolean(process.env.CI);

interface SnapshotJson {
  fetchedAt: string;
  title: string | null;
  tagline: string | null;
  price: string | null;
  description: string | null;
  changed: boolean;
  summary: string | null;
  pollStatus: string;
  failureReason: string | null;
}

describe.skipIf(!enabled)('scheduled polling', () => {
  let pool: pg.Pool;
  let source: RunningSource;
  let sourceClient: SourceClient;
  let app: FastifyInstance;

  const scheduler = (client: SourceClient = sourceClient, intervalSeconds = 3600) =>
    createScheduler({
      db: drizzle(pool),
      source: client,
      log: app.log,
      intervalSeconds,
      tickMs: 1000,
      maxInFlight: 4,
    });

  async function add(id: string) {
    const response = await app.inject({ method: 'POST', url: '/api/competitors', payload: { id } });
    expect(response.statusCode).toBe(201);
  }

  async function snapshotsOf(id: string): Promise<SnapshotJson[]> {
    const response = await app.inject({ method: 'GET', url: `/api/competitors/${id}/snapshots` });
    expect(response.statusCode).toBe(200);
    return response.json<SnapshotJson[]>();
  }

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
    await runMigrations(databaseUrl);
    pool = new pg.Pool({ connectionString: databaseUrl });
    source = await startSource();
    sourceClient = createSourceClient({ baseUrl: source.baseUrl, timeoutMs: 500 });
    app = buildApp({ logLevel: 'silent' }, pool, sourceClient);
  });

  afterAll(async () => {
    await app.close();
    await source.stop();
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('truncate snapshots, competitors cascade');
    await source.configure({
      failNext: 0,
      timeoutNext: 0,
      partialNext: 0,
      rateLimitPerSecond: 1000,
    });
  });

  it('stores an ok Snapshot with the Normalized listing for a due Competitor', async () => {
    await add(source.knownId);

    await scheduler().tick();

    const [snapshot, ...rest] = await snapshotsOf(source.knownId);
    expect(rest).toEqual([]);
    expect(snapshot).toMatchObject({
      pollStatus: 'ok',
      failureReason: null,
      changed: false,
      summary: null,
    });
    expect(snapshot?.title).toBeTruthy();
    expect(snapshot?.price).toMatch(/^(Free|\S+\d)/);
    expect(Number.isNaN(Date.parse(snapshot?.fetchedAt ?? ''))).toBe(false);
  });

  it('does not poll a Competitor again before its next_poll_at, even after a restart', async () => {
    await add(source.knownId);
    await scheduler().tick();

    await scheduler().tick();

    expect(await snapshotsOf(source.knownId)).toHaveLength(1);
  });

  it('polls again once next_poll_at has passed and lists Snapshots newest first', async () => {
    await add(source.knownId);
    await scheduler().tick();
    await pool.query("update competitors set next_poll_at = now() - interval '1 second'");

    await scheduler().tick();

    const snapshots = await snapshotsOf(source.knownId);
    expect(snapshots).toHaveLength(2);
    expect(Date.parse(snapshots[0]?.fetchedAt ?? '')).toBeGreaterThan(
      Date.parse(snapshots[1]?.fetchedAt ?? ''),
    );
  });

  it('schedules the next Poll one interval after the claim', async () => {
    await add(source.knownId);

    await scheduler(sourceClient, 600).tick();

    const { rows } = await pool.query<{ seconds: number }>(
      'select extract(epoch from next_poll_at - now()) as seconds from competitors',
    );
    expect(Number(rows[0]?.seconds)).toBeGreaterThan(590);
    expect(Number(rows[0]?.seconds)).toBeLessThanOrEqual(600);
  });

  it('does not poll a Removed competitor', async () => {
    await add(source.knownId);
    await app.inject({ method: 'DELETE', url: `/api/competitors/${source.knownId}` });

    await scheduler().tick();

    expect(await snapshotsOf(source.knownId)).toEqual([]);
  });

  it('stores a failed Snapshot with the reason when the Source errors', async () => {
    await add(source.knownId);
    await source.configure({ failNext: 1 });

    await scheduler().tick();

    const [snapshot] = await snapshotsOf(source.knownId);
    expect(snapshot?.pollStatus).toBe('failed');
    expect(snapshot?.failureReason).toMatch(/source/i);
    expect(snapshot?.title).toBeNull();
  });

  it('stores a failed Snapshot when the Source does not answer in time', async () => {
    await add(source.knownId);
    await source.configure({ timeoutNext: 1 });

    await scheduler().tick();

    const [snapshot] = await snapshotsOf(source.knownId);
    expect(snapshot?.pollStatus).toBe('failed');
    expect(snapshot?.failureReason).toMatch(/timed out/);
  });

  it('stores an incomplete Snapshot that names the missing field and has no listing', async () => {
    await add(source.knownId);
    await source.configure({ partialNext: 1 });

    await scheduler().tick();

    const [snapshot] = await snapshotsOf(source.knownId);
    expect(snapshot?.pollStatus).toBe('incomplete');
    expect(snapshot?.failureReason).toMatch(/^missing field: (title|tagline|price|description)$/);
    expect(snapshot).toMatchObject({
      title: null,
      tagline: null,
      price: null,
      description: null,
    });
  });

  it('clears awaitingFirstPollReason after the first Poll', async () => {
    await pool.query('insert into competitors (id, awaiting_first_poll_reason) values ($1, $2)', [
      source.knownId,
      'source is unreachable',
    ]);

    await scheduler().tick();

    const { rows } = await pool.query<{ reason: string | null }>(
      'select awaiting_first_poll_reason as reason from competitors',
    );
    expect(rows[0]?.reason).toBeNull();
  });

  it('stores a delisted Snapshot when the Source answers 404 for a tracked Competitor', async () => {
    await pool.query("insert into competitors (id) values ('gone')");
    const server = createServer((_request, response) => {
      response.writeHead(404).end();
    });
    server.listen(0);
    await once(server, 'listening');
    try {
      await scheduler(
        createSourceClient({
          baseUrl: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
          timeoutMs: 500,
        }),
      ).tick();
    } finally {
      await closeServer(server);
    }

    const [snapshot] = await snapshotsOf('gone');
    expect(snapshot).toMatchObject({ pollStatus: 'delisted', failureReason: null, title: null });
  });

  it('answers 404 for the snapshots of a Competitor that was never tracked', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/competitors/nobody/snapshots' });

    expect(response.statusCode).toBe(404);
  });
});

async function closeServer(server: Server): Promise<void> {
  server.close();
  await once(server, 'close');
}
