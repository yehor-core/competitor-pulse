import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Config } from './config.js';

export function buildApp(config: Pick<Config, 'logLevel'>, pool: pg.Pool): FastifyInstance {
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

  return app;
}
