import { z } from 'zod';

// Only "is this a JSON object" is checked here. Field-level validation belongs to listing normalization,
// because a Listing with missing fields is still a Competitor the Source knows.
const listingBodySchema = z.looseObject({});

export type ListingLookup =
  | { kind: 'known' }
  | { kind: 'unknown' }
  | { kind: 'unavailable'; reason: string; retryAfterSeconds?: number };

/** A 404 means the Source does not know the id or has delisted it; the caller knows which. */
export type ListingFetch =
  | { kind: 'listing'; body: Record<string, unknown> }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; reason: string; retryAfterSeconds?: number };

export interface SourceClient {
  lookup(id: string): Promise<ListingLookup>;
  fetchListing(id: string): Promise<ListingFetch>;
}

export interface SourceClientOptions {
  baseUrl: string;
  timeoutMs: number;
  /** Told about every request's outcome: an HTTP status, or timeout, unreachable, unusable. */
  onResponse?: (outcome: string) => void;
}

export function createSourceClient({
  baseUrl,
  timeoutMs,
  onResponse,
}: SourceClientOptions): SourceClient {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  async function fetchListing(id: string): Promise<ListingFetch> {
    const url = new URL(`listings/${encodeURIComponent(id)}`, base);
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        onResponse?.('timeout');
        return { kind: 'unavailable', reason: `source timed out after ${String(timeoutMs)} ms` };
      }
      onResponse?.('unreachable');
      return { kind: 'unavailable', reason: 'source is unreachable' };
    }
    onResponse?.(String(response.status));

    if (response.status === 404) {
      await response.body?.cancel();
      return { kind: 'not_found' };
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      const retryAfter = response.headers.get('Retry-After');
      const hint = response.status === 429 && retryAfter ? ` (retry after ${retryAfter} s)` : '';
      const retryAfterSeconds = Number(retryAfter);
      return {
        kind: 'unavailable',
        reason: `source answered HTTP ${String(response.status)}${hint}`,
        // Number(null) is 0, so a missing header must be excluded explicitly.
        ...(response.status === 429 && retryAfter !== null && retryAfterSeconds >= 0
          ? { retryAfterSeconds }
          : {}),
      };
    }

    try {
      return { kind: 'listing', body: listingBodySchema.parse(await response.json()) };
    } catch (error) {
      // Covers a body that is not JSON, one that is not an object, and a connection cut mid-body.
      // The body read is covered by the same timeout signal, so a stalled body ends up here too.
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        onResponse?.('timeout');
        return { kind: 'unavailable', reason: `source timed out after ${String(timeoutMs)} ms` };
      }
      onResponse?.('unusable');
      return { kind: 'unavailable', reason: 'source returned an unusable response' };
    }
  }

  return {
    fetchListing,
    async lookup(id) {
      const result = await fetchListing(id);
      if (result.kind === 'listing') return { kind: 'known' };
      if (result.kind === 'not_found') return { kind: 'unknown' };
      return result;
    },
  };
}
