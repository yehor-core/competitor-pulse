import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { loadConfigOrExit } from '../config.js';

// Resolved from this file so it works from both src/ (tsx) and dist/ (node) in the image.
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { databaseUrl } = loadConfigOrExit(process.env);
  await runMigrations(databaseUrl);
  process.stdout.write('migrations applied\n');
}
