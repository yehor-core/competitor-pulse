import { describe, expect, it } from 'vitest';
import { createTokenBucket } from '../domain/token-bucket.js';
import type { ListingFetch, SourceClient } from './client.js';
import { rateLimitSource } from './rate-limited.js';

function setup(responses: ListingFetch[] = []) {
  let nowMs = 0;
  const bucket = createTokenBucket({ ratePerSecond: 4, capacity: 1, now: () => nowMs });
  const requestTimes: number[] = [];
  const inner: SourceClient = {
    fetchListing() {
      requestTimes.push(nowMs);
      return Promise.resolve(responses.shift() ?? { kind: 'listing', body: {} });
    },
    lookup() {
      requestTimes.push(nowMs);
      return Promise.resolve({ kind: 'known' });
    },
  };
  const limited = rateLimitSource(inner, bucket, (ms) => {
    nowMs += ms;
    return Promise.resolve();
  });
  return { limited, bucket, requestTimes };
}

describe('rate limited source', () => {
  it('spaces requests so they never exceed the configured rate, lookups included', async () => {
    const { limited, requestTimes } = setup();

    await limited.fetchListing('a');
    await limited.lookup('b');
    await limited.fetchListing('c');
    await limited.fetchListing('d');

    expect(requestTimes).toEqual([0, 250, 500, 750]);
  });

  it('pauses every later request for the Retry-After of a 429, then refills from empty', async () => {
    const { limited, requestTimes } = setup([
      { kind: 'unavailable', reason: 'source answered HTTP 429', retryAfterSeconds: 3 },
    ]);

    await limited.fetchListing('a');
    await limited.fetchListing('b');

    expect(requestTimes).toEqual([0, 3250]);
  });

  it('returns the inner answer unchanged', async () => {
    const answer: ListingFetch = { kind: 'unavailable', reason: 'x', retryAfterSeconds: 1 };
    const { limited } = setup([answer]);

    expect(await limited.fetchListing('a')).toEqual(answer);
  });
});
