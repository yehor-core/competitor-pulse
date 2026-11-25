import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { buildApp } from './app.js';
import { loadConfigOrExit } from './config.js';
import { createScheduler } from './scheduler/scheduler.js';
import { createSourceClient } from './source/client.js';

const config = loadConfigOrExit(process.env);
const pool = new pg.Pool({ connectionString: config.databaseUrl });
const source = createSourceClient({
  baseUrl: config.sourceBaseUrl,
  timeoutMs: config.sourceTimeoutMs,
});
const app = buildApp(config, pool, source);
const scheduler = createScheduler({
  db: drizzle(pool),
  source,
  log: app.log,
  intervalSeconds: config.pollIntervalSeconds,
  tickMs: config.schedulerTickMs,
  maxInFlight: config.pollMaxInFlight,
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void scheduler
      .stop()
      .then(() => app.close())
      .then(() => pool.end());
  });
}

await app.listen({ port: config.port, host: '0.0.0.0' });
scheduler.start();
