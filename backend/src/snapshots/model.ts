import type { ListingFetch } from '../source/client.js';
import { normalizeListing } from '../domain/normalize.js';

export type PollStatus = 'ok' | 'failed' | 'incomplete' | 'delisted';

export interface PollOutcome {
  pollStatus: PollStatus;
  failureReason: string | null;
  listing: {
    title: string;
    tagline: string;
    price: string;
    priceAmount: string;
    priceCurrency: string | null;
    pricePeriod: string | null;
    description: string;
  } | null;
}

/** Turns what the Source answered into the outcome of one Poll. */
export function outcomeOf(fetched: ListingFetch): PollOutcome {
  if (fetched.kind === 'unavailable') {
    return { pollStatus: 'failed', failureReason: fetched.reason, listing: null };
  }
  if (fetched.kind === 'not_found') {
    return { pollStatus: 'delisted', failureReason: null, listing: null };
  }
  const normalized = normalizeListing(fetched.body);
  if (normalized.kind === 'incomplete') {
    return {
      pollStatus: 'incomplete',
      failureReason: `missing field: ${normalized.missingField}`,
      listing: null,
    };
  }
  const { title, tagline, price, priceParts, description } = normalized.listing;
  return {
    pollStatus: 'ok',
    failureReason: null,
    listing: {
      title,
      tagline,
      price,
      priceAmount: String(priceParts.amount),
      priceCurrency: priceParts.currency,
      pricePeriod: priceParts.period,
      description,
    },
  };
}
