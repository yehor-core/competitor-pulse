import type { ListingFetch } from '../source/client.js';
import type { ComparableListing } from '../domain/compare.js';
import { normalizeListing, type PricePeriod } from '../domain/normalize.js';

export type PollStatus = 'ok' | 'failed' | 'incomplete' | 'delisted';

/** The Normalized listing as stored on a Snapshot row. */
export interface StoredListing {
  title: string;
  tagline: string;
  price: string;
  priceAmount: string;
  priceCurrency: string | null;
  pricePeriod: string | null;
  description: string;
}

export interface PollOutcome {
  pollStatus: PollStatus;
  failureReason: string | null;
  listing: StoredListing | null;
}

/** Rebuilds the comparable fields from a stored row; null when the row holds no listing. */
export function comparableOf(row: {
  title: string | null;
  tagline: string | null;
  priceAmount: string | null;
  priceCurrency: string | null;
  pricePeriod: string | null;
  description: string | null;
}): ComparableListing | null {
  const { title, tagline, priceAmount, description } = row;
  if (title === null || tagline === null || priceAmount === null || description === null) {
    return null;
  }
  return {
    title,
    tagline,
    description,
    priceParts: {
      amount: Number(priceAmount),
      currency: row.priceCurrency,
      period: row.pricePeriod as PricePeriod | null,
    },
  };
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
