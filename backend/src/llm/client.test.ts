import { afterEach, describe, expect, it } from 'vitest';
import { startStubLlm, type StubLlm } from '../test-support/stub-llm.js';
import { createLlmClient } from './client.js';

const prompt = { system: 'be brief', user: 'explain' };

describe('LLM client', () => {
  let llm: StubLlm | undefined;
  afterEach(async () => {
    await llm?.stop();
    llm = undefined;
  });

  const clientFor = async (reply: Parameters<typeof startStubLlm>[0], timeoutMs = 500) => {
    llm = await startStubLlm(reply);
    return createLlmClient({
      baseUrl: llm.baseUrl,
      apiKey: 'secret',
      model: 'test-model',
      timeoutMs,
    });
  };

  it('sends an OpenAI Chat Completions request and returns the message text', async () => {
    const client = await clientFor({ status: 200, content: 'Price went up.' });

    expect(await client.complete(prompt)).toEqual({ kind: 'ok', text: 'Price went up.' });

    expect(llm?.requests).toHaveLength(1);
    expect(llm?.requests[0]).toMatchObject({
      path: '/v1/chat/completions',
      authorization: 'Bearer secret',
      body: {
        model: 'test-model',
        messages: [
          { role: 'system', content: 'be brief' },
          { role: 'user', content: 'explain' },
        ],
      },
    });
  });

  it('reports a response slower than the timeout as a timeout', async () => {
    const client = await clientFor({ status: 200, content: 'late', delayMs: 300 }, 50);

    expect(await client.complete(prompt)).toEqual({ kind: 'timeout' });
  });

  it('reports an HTTP error as failed without retrying', async () => {
    const client = await clientFor({ status: 500, content: '' });

    expect(await client.complete(prompt)).toMatchObject({ kind: 'failed' });
    expect(llm?.requests).toHaveLength(1);
  });

  it('reports an unreachable endpoint as failed', async () => {
    const client = createLlmClient({
      baseUrl: 'http://127.0.0.1:1/v1',
      apiKey: 'k',
      model: 'm',
      timeoutMs: 500,
    });

    expect(await client.complete(prompt)).toMatchObject({ kind: 'failed' });
  });

  it.each([
    ['empty text', ''],
    ['blank text', '   '],
    ['text over the limit', 'x'.repeat(5000)],
  ])('reports %s as unusable', async (_name, content) => {
    const client = await clientFor({ status: 200, content });

    expect(await client.complete(prompt)).toEqual({ kind: 'unusable' });
  });

  it('reports a body that is not a chat completion as unusable', async () => {
    const client = await clientFor({ status: 200, raw: '{"hello":"world"}' });

    expect(await client.complete(prompt)).toEqual({ kind: 'unusable' });
  });

  it('reports a body that is not JSON as unusable', async () => {
    const client = await clientFor({ status: 200, raw: 'not json' });

    expect(await client.complete(prompt)).toEqual({ kind: 'unusable' });
  });
});
