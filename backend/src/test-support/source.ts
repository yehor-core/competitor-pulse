import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const serverPath = fileURLToPath(
  new URL('../../../files/listing-source/listing-source-server.mjs', import.meta.url),
);

const statsSchema = z.object({ versions: z.record(z.string(), z.unknown()) });

export interface RunningSource {
  baseUrl: string;
  /** An id the Source knows, discovered over HTTP so tests do not depend on fixture content. */
  knownId: string;
  configure(settings: Record<string, unknown>): Promise<void>;
  /** Moves one competitor to its next version, as the Source itself does on a timer. */
  advance(id: string): Promise<void>;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0);
  await once(server, 'listening');
  const address = server.address();
  server.close();
  if (address === null || typeof address === 'string') throw new Error('no free port');
  return address.port;
}

async function waitUntilHealthy(baseUrl: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error('listing source exited during startup');
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('listing source did not become healthy');
}

export async function startSource(): Promise<RunningSource> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${String(port)}`;
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
  await waitUntilHealthy(baseUrl, child);

  const post = async (path: string, body: Record<string, unknown>): Promise<void> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${path} answered ${String(response.status)}`);
  };
  await post('/control/configure', {
    errorRate: 0,
    timeoutRate: 0,
    slowRate: 0,
    partialRate: 0,
    latencyMinMs: 0,
    latencyMaxMs: 5,
    versionIntervalSeconds: 0,
  });

  const stats = statsSchema.parse(await (await fetch(`${baseUrl}/control/stats`)).json());
  const knownId = Object.keys(stats.versions)[0];
  if (knownId === undefined) throw new Error('listing source knows no competitors');

  return {
    baseUrl,
    knownId,
    configure: (settings) => post('/control/configure', settings),
    advance: (id) => post('/control/advance', { id, steps: 1 }),
    stop: async () => {
      child.kill();
      await once(child, 'exit');
    },
  };
}
