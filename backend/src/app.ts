import { drizzle } from 'drizzle-orm/node-postgres';
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { registerCompetitorRoutes } from './competitors/routes.js';
import { registerSnapshotRoutes } from './snapshots/routes.js';
import type { Config } from './config.js';
import type { SourceClient } from './source/client.js';

export function buildApp(
  config: Pick<Config, 'logLevel'>,
  pool: pg.Pool,
  source: SourceClient,
): FastifyInstance {
  const app = Fastify({ logger: { level: config.logLevel } });

  app.get('/health', async (request, reply) => {
    try {
      await pool.query('select 1');
      return { status: 'ok' };
    } catch (error) {
      request.log.error({ err: error }, 'health check: database unreachable');
      return reply.code(503).send({ status: 'unavailable', reason: 'database unreachable' });
    }
  });

  const db = drizzle(pool);
  registerCompetitorRoutes(app, db, source);
  registerSnapshotRoutes(app, db);

  return app;
}
