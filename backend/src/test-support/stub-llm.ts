import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface StubLlmReply {
  status: number;
  /** Message text of a well-formed chat completion. */
  content?: string;
  /** A body sent as is, for replies that are not a chat completion. */
  raw?: string;
  delayMs?: number;
}

export interface StubLlmRequest {
  path: string;
  authorization: string | undefined;
  body: unknown;
}

export interface StubLlm {
  /** Ends with `/v1`, like the base URL of an OpenAI-compatible provider. */
  baseUrl: string;
  requests: StubLlmRequest[];
  reply(reply: StubLlmReply): void;
  stop(): Promise<void>;
}

/** An LLM whose answer the test scripts by hand, for outputs the mock LLM cannot be made to produce. */
export async function startStubLlm(initial: StubLlmReply): Promise<StubLlm> {
  let current = initial;
  const requests: StubLlmRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        body = undefined;
      }
      requests.push({
        path: request.url ?? '',
        authorization: request.headers.authorization,
        body,
      });
      const reply = current;
      setTimeout(() => {
        const payload =
          reply.raw ??
          JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply.content } }] });
        response.writeHead(reply.status, { 'content-type': 'application/json' }).end(payload);
      }, reply.delayMs ?? 0);
    });
  });
  server.listen(0);
  await once(server, 'listening');
  return {
    baseUrl: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/v1`,
    requests,
    reply: (reply) => {
      current = reply;
    },
    stop: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
}
