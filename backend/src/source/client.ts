import { z } from 'zod';

// Only "is this a JSON object" is checked here. Field-level validation belongs to listing normalization,
// because a Listing with missing fields is still a Competitor the Source knows.
const listingBodySchema = z.looseObject({});

export type ListingLookup =
  { kind: 'known' } | { kind: 'unknown' } | { kind: 'unavailable'; reason: string };

export interface SourceClient {
  lookup(id: string): Promise<ListingLookup>;
}

export interface SourceClientOptions {
  baseUrl: string;
  timeoutMs: number;
}

export function createSourceClient({ baseUrl, timeoutMs }: SourceClientOptions): SourceClient {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  return {
    async lookup(id) {
      const url = new URL(`listings/${encodeURIComponent(id)}`, base);
      let response: Response;
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'TimeoutError') {
          return { kind: 'unavailable', reason: `source timed out after ${String(timeoutMs)} ms` };
        }
        return { kind: 'unavailable', reason: 'source is unreachable' };
      }

      if (response.status === 404) {
        await response.body?.cancel();
        return { kind: 'unknown' };
      }
      if (response.status !== 200) {
        await response.body?.cancel();
        const retryAfter = response.headers.get('Retry-After');
        const hint = response.status === 429 && retryAfter ? ` (retry after ${retryAfter} s)` : '';
        return {
          kind: 'unavailable',
          reason: `source answered HTTP ${String(response.status)}${hint}`,
        };
      }

      try {
        listingBodySchema.parse(await response.json());
        return { kind: 'known' };
      } catch {
        // Covers a body that is not JSON, one that is not an object, and a connection cut mid-body.
        return { kind: 'unavailable', reason: 'source returned an unusable response' };
      }
    },
  };
}
