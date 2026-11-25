import { describe, expect, it } from 'vitest';
import { compareWithBaseline, type ComparableListing, type Observation } from './compare.js';

const baseline: ComparableListing = {
  title: 'Acme CRM',
  tagline: 'Simple CRM for small teams',
  priceParts: { amount: 29, currency: 'USD', period: 'month' },
  description: 'Track leads and deals in one place.',
};

const ok = (listing: ComparableListing): Observation => ({ pollStatus: 'ok', listing });
const state = { baseline, wasDelisted: false };
const nothing = {
  changed: false,
  changedFields: [],
  summary: null,
  summaryStatus: 'not_applicable',
};

describe('compareWithBaseline', () => {
  it('is not a Change when the listing equals the Baseline', () => {
    expect(compareWithBaseline(state, ok({ ...baseline }))).toEqual(nothing);
  });

  it('ignores case and whitespace differences', () => {
    const cosmetic = ok({
      ...baseline,
      title: '  ACME   crm ',
      description: 'track leads and\n deals in one place.',
    });

    expect(compareWithBaseline(state, cosmetic).changed).toBe(false);
  });

  it.each([
    ['title', { title: 'Acme CRM Pro' }],
    ['tagline', { tagline: 'CRM for everyone' }],
    ['description', { description: 'Now with pipelines.' }],
    ['price', { priceParts: { amount: 39, currency: 'USD', period: 'month' } }],
    ['price', { priceParts: { amount: 29, currency: 'USD', period: 'year' } }],
    ['price', { priceParts: { amount: 29, currency: 'EUR', period: 'month' } }],
    ['price', { priceParts: { amount: 0, currency: null, period: null } }],
  ] as const)('is a Change in %s, with a Summary still pending', (field, patch) => {
    const result = compareWithBaseline(state, ok({ ...baseline, ...patch }));

    expect(result).toEqual({
      changed: true,
      changedFields: [field],
      summary: null,
      summaryStatus: 'pending',
    });
  });

  it('lists every changed field', () => {
    const result = compareWithBaseline(state, ok({ ...baseline, title: 'X', tagline: 'Y' }));

    expect(result.changedFields).toEqual(['title', 'tagline']);
  });

  it('has nothing to compare for the first listing', () => {
    expect(compareWithBaseline({ baseline: null, wasDelisted: false }, ok(baseline))).toEqual(
      nothing,
    );
  });

  it('treats delisting as a Change with a fixed Summary', () => {
    expect(compareWithBaseline(state, { pollStatus: 'delisted', listing: null })).toEqual({
      changed: true,
      changedFields: [],
      summary: 'The competitor was delisted: the source no longer lists it.',
      summaryStatus: 'ready',
    });
  });

  it('does not repeat the Change while the Competitor stays delisted', () => {
    const result = compareWithBaseline(
      { baseline, wasDelisted: true },
      { pollStatus: 'delisted', listing: null },
    );

    expect(result.changed).toBe(false);
  });

  it('is not a Change when delisted before any listing was seen', () => {
    const result = compareWithBaseline(
      { baseline: null, wasDelisted: false },
      { pollStatus: 'delisted', listing: null },
    );

    expect(result.changed).toBe(false);
  });

  it('treats a return with the same content as a Change with a fixed Summary', () => {
    expect(compareWithBaseline({ baseline, wasDelisted: true }, ok({ ...baseline }))).toEqual({
      changed: true,
      changedFields: [],
      summary: 'The competitor returned: the source lists it again with unchanged content.',
      summaryStatus: 'ready',
    });
  });

  it('treats a return with different content as a Change that needs the LLM', () => {
    const result = compareWithBaseline(
      { baseline, wasDelisted: true },
      ok({ ...baseline, title: 'Acme CRM 2' }),
    );

    expect(result).toMatchObject({
      changed: true,
      changedFields: ['title'],
      summaryStatus: 'pending',
    });
  });

  it.each(['failed', 'incomplete'] as const)('never counts a %s Poll as a Change', (pollStatus) => {
    expect(compareWithBaseline(state, { pollStatus, listing: null })).toEqual(nothing);
  });
});
