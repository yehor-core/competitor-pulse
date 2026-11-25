import { drizzle } from 'drizzle-orm/node-postgres';
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { registerCompetitorRoutes } from './competitors/routes.js';
import { registerSnapshotRoutes } from './snapshots/routes.js';
import { pollLagSeconds } from './scheduler/poll-lag.js';
import { createMetrics, type Metrics } from './metrics/metrics.js';
import type { Config } from './config.js';
import type { LlmBudget } from './llm/budget.js';
import type { SourceClient } from './source/client.js';

export function buildApp(
  config: Pick<Config, 'logLevel'>,
  pool: pg.Pool,
  source: SourceClient,
  budget: LlmBudget,
  // The server passes the Metrics it also hands to the scheduler, source client, and summary worker.
  metrics?: Metrics,
): FastifyInstance {
  const app = Fastify({ logger: { level: config.logLevel } });

  const db = drizzle(pool);
  const exposed = metrics ?? createMetrics({ db, budget });

  // /health is kept for container health checks; /api/health is the documented operator endpoint.
  for (const url of ['/health', '/api/health']) {
    app.get(url, async (request, reply) => {
      try {
        return {
          status: 'ok',
          pollLagSeconds: await pollLagSeconds(db),
          llmBudget: await budget.status(),
        };
      } catch (error) {
        request.log.error({ err: error }, 'health check: database unreachable');
        return reply.code(503).send({ status: 'unavailable', reason: 'database unreachable' });
      }
    });
  }

  app.get('/metrics', async (request, reply) => {
    try {
      return await reply.type(exposed.contentType).send(await exposed.render());
    } catch (error) {
      request.log.error({ err: error }, 'metrics: could not be collected');
      return reply.code(503).send({ status: 'unavailable', reason: 'database unreachable' });
    }
  });

  registerCompetitorRoutes(app, db, source);
  registerSnapshotRoutes(app, db);

  return app;
}
