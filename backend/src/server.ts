import pg from 'pg';
import { buildApp } from './app.js';
import { loadConfigOrExit } from './config.js';

const config = loadConfigOrExit(process.env);
const pool = new pg.Pool({ connectionString: config.databaseUrl });
const app = buildApp(config, pool);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => pool.end());
  });
}

await app.listen({ port: config.port, host: '0.0.0.0' });
