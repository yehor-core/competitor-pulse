import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

export type StubAnswer = { status: 404 } | { status: 200; body: Record<string, unknown> };

export interface StubSource {
  baseUrl: string;
  /** What every `GET /listings/:id` answers next. Lets a test script one Listing exactly. */
  answer(answer: StubAnswer): void;
  stop(): Promise<void>;
}

/** A Source whose Listing the test scripts by hand, for cases the provided Source cannot be made to produce. */
export async function startStubSource(initial: StubAnswer): Promise<StubSource> {
  let current = initial;
  const server = createServer((_request, response) => {
    if (current.status === 404) {
      response.writeHead(404).end();
      return;
    }
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify(current.body));
  });
  server.listen(0);
  await once(server, 'listening');
  return {
    baseUrl: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    answer: (answer) => {
      current = answer;
    },
    stop: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}
