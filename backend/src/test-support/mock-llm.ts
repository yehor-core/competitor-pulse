import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const serverPath = fileURLToPath(
  new URL('../../../files/mock-llm/mock-llm-server.py', import.meta.url),
);

const statsSchema = z.object({ callCount: z.number() });

export interface RunningMockLlm {
  /** Ends with `/v1`, like the base URL of an OpenAI-compatible provider. */
  baseUrl: string;
  callCount(): Promise<number>;
  /** Mock LLM `/control/configure`: `latencyMs` delays every answer, `failNext` makes the next N answers HTTP 500. */
  configure(settings: { latencyMs?: number; failNext?: number }): Promise<void>;
  /** Clears the call count, latency and queued failures. */
  reset(): Promise<void>;
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

/** Starts the provided mock LLM as its own process, so tests drive it over HTTP like any other instance. */
export async function startMockLlm(): Promise<RunningMockLlm> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${String(port)}`;
  const child = spawn('python3', [serverPath], {
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
  for (let attempt = 0; ; attempt += 1) {
    if (child.exitCode !== null || attempt >= 50) throw new Error('mock LLM did not start');
    try {
      if ((await fetch(`${origin}/health`)).ok) break;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return {
    baseUrl: `${origin}/v1`,
    callCount: async () =>
      statsSchema.parse(await (await fetch(`${origin}/control/stats`)).json()).callCount,
    configure: async (settings) => {
      const response = await fetch(`${origin}/control/configure`, {
        method: 'POST',
        body: JSON.stringify(settings),
      });
      if (!response.ok) throw new Error(`configure answered ${String(response.status)}`);
    },
    reset: async () => {
      const response = await fetch(`${origin}/control/reset`, { method: 'POST' });
      if (!response.ok) throw new Error(`reset answered ${String(response.status)}`);
    },
    stop: async () => {
      child.kill();
      await once(child, 'exit');
    },
  };
}
