import { z } from 'zod';
import type { ListingField, NormalizedListing } from './normalize.js';

/** A Summary is one or two sentences; anything longer is the model rambling or echoing the prompt. */
export const MAX_SUMMARY_LENGTH = 600;

const summaryTextSchema = z.string().trim().min(1).max(MAX_SUMMARY_LENGTH);

export type SummaryTextResult = { kind: 'ok'; text: string } | { kind: 'unusable' };

export function parseSummaryText(content: unknown): SummaryTextResult {
  const parsed = summaryTextSchema.safeParse(content);
  return parsed.success ? { kind: 'ok', text: parsed.data } : { kind: 'unusable' };
}

export type PromptListing = Pick<NormalizedListing, ListingField>;

/** The prompt carries only the changed fields, so the model explains the Change rather than the listing. */
export function buildSummaryPrompt(
  baseline: PromptListing,
  current: PromptListing,
  changedFields: ListingField[],
): { system: string; user: string } {
  return {
    system:
      'A competitor changed its product listing. Explain in one or two plain-English sentences what changed and why it might matter. Reply with the explanation only.',
    user: changedFields
      .map((field) => `${field}: was "${baseline[field]}", now "${current[field]}"`)
      .join('\n'),
  };
}
