import type { TokenBucket } from '../domain/token-bucket.js';
import type { ListingFetch, ListingLookup, SourceClient } from './client.js';

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Every request to the Source, including the lookup when a Competitor is added, shares one Rate limit,
 * so the wait for a token sits in front of the client rather than in the scheduler.
 */
export function rateLimitSource(
  source: SourceClient,
  bucket: TokenBucket,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): SourceClient {
  async function acquire(): Promise<void> {
    while (!bucket.tryTake()) await sleep(Math.max(1, bucket.msUntilAvailable()));
  }

  function pauseOn429(result: ListingFetch | ListingLookup): void {
    if (result.kind === 'unavailable' && result.retryAfterSeconds !== undefined) {
      bucket.pauseFor(result.retryAfterSeconds * 1000);
    }
  }

  return {
    async fetchListing(id) {
      await acquire();
      const result = await source.fetchListing(id);
      pauseOn429(result);
      return result;
    },
    async lookup(id) {
      await acquire();
      const result = await source.lookup(id);
      pauseOn429(result);
      return result;
    },
  };
}
