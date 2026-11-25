import type { ListingField, NormalizedListing } from './normalize.js';
import type { PollStatus } from '../snapshots/model.js';

export type ComparableListing = Pick<
  NormalizedListing,
  'title' | 'tagline' | 'priceParts' | 'description'
>;

export interface BaselineState {
  /** The Baseline: the last `ok` Poll's listing, or null before the first one. */
  baseline: ComparableListing | null;
  /** Whether the latest `ok` or `delisted` Poll was a delisting. Failed and incomplete Polls say nothing about it. */
  wasDelisted: boolean;
}

export interface Observation {
  pollStatus: PollStatus;
  listing: ComparableListing | null;
}

export type ComparisonSummaryStatus = 'ready' | 'pending' | 'not_applicable';

export interface Comparison {
  changed: boolean;
  changedFields: ListingField[];
  /** Set only for the Changes that have fixed text; the LLM writes the others. */
  summary: string | null;
  summaryStatus: ComparisonSummaryStatus;
}

export const DELISTED_SUMMARY = 'The competitor was delisted: the source no longer lists it.';
export const RETURNED_SUMMARY =
  'The competitor returned: the source lists it again with unchanged content.';

const NO_CHANGE: Comparison = {
  changed: false,
  changedFields: [],
  summary: null,
  summaryStatus: 'not_applicable',
};

// Case and whitespace differences are cosmetic, so they never make a Change.
const text = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase();

function changedFieldsOf(baseline: ComparableListing, current: ComparableListing): ListingField[] {
  const fields: ListingField[] = [];
  if (text(baseline.title) !== text(current.title)) fields.push('title');
  if (text(baseline.tagline) !== text(current.tagline)) fields.push('tagline');
  const a = baseline.priceParts;
  const b = current.priceParts;
  if (a.amount !== b.amount || a.currency !== b.currency || a.period !== b.period) {
    fields.push('price');
  }
  if (text(baseline.description) !== text(current.description)) fields.push('description');
  return fields;
}

/** Decides whether a Poll is a Change relative to the Baseline. Pure: knows nothing of HTTP or storage. */
export function compareWithBaseline(state: BaselineState, observed: Observation): Comparison {
  const { baseline, wasDelisted } = state;

  if (observed.pollStatus === 'delisted') {
    if (baseline === null || wasDelisted) return NO_CHANGE;
    return { changed: true, changedFields: [], summary: DELISTED_SUMMARY, summaryStatus: 'ready' };
  }
  if (observed.pollStatus !== 'ok' || observed.listing === null || baseline === null) {
    return NO_CHANGE;
  }

  const changedFields = changedFieldsOf(baseline, observed.listing);
  if (changedFields.length > 0) {
    return { changed: true, changedFields, summary: null, summaryStatus: 'pending' };
  }
  if (wasDelisted) {
    return { changed: true, changedFields, summary: RETURNED_SUMMARY, summaryStatus: 'ready' };
  }
  return NO_CHANGE;
}
