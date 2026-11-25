import { describe, expect, it } from 'vitest';
import { MAX_SUMMARY_LENGTH, buildSummaryPrompt, parseSummaryText } from './summary-text.js';

describe('parseSummaryText', () => {
  it('accepts text and trims it', () => {
    expect(parseSummaryText('  The price went up.\n')).toEqual({
      kind: 'ok',
      text: 'The price went up.',
    });
  });

  it.each([[''], ['   \n'], [null], [42]])('rejects %j as unusable', (value) => {
    expect(parseSummaryText(value).kind).toBe('unusable');
  });

  it('rejects text longer than the limit', () => {
    expect(parseSummaryText('x'.repeat(MAX_SUMMARY_LENGTH)).kind).toBe('ok');
    expect(parseSummaryText('x'.repeat(MAX_SUMMARY_LENGTH + 1)).kind).toBe('unusable');
  });
});

describe('buildSummaryPrompt', () => {
  const before = {
    title: 'Acme CRM',
    tagline: 'Simple CRM',
    price: '$29/mo',
    description: 'Track leads.',
  };

  it('names the changed fields with their old and new values and omits the others', () => {
    const { user } = buildSummaryPrompt(before, { ...before, price: '$39/mo' }, ['price']);

    expect(user).toBe('price: was "$29/mo", now "$39/mo"');
  });
});
