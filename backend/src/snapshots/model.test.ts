import { describe, expect, it } from 'vitest';
import { comparableOf } from './model.js';

const row = {
  title: 'Acme',
  tagline: 'Fast',
  priceAmount: '12',
  priceCurrency: 'USD',
  pricePeriod: 'month',
  description: 'Does things',
};

describe('comparableOf', () => {
  it('rebuilds the comparable fields of a stored row', () => {
    expect(comparableOf(row)).toEqual({
      title: 'Acme',
      tagline: 'Fast',
      description: 'Does things',
      priceParts: { amount: 12, currency: 'USD', period: 'month' },
    });
  });

  it('keeps a missing period as null', () => {
    expect(comparableOf({ ...row, pricePeriod: null })?.priceParts.period).toBeNull();
  });

  it('treats a row with an unknown period as holding no listing', () => {
    expect(comparableOf({ ...row, pricePeriod: 'fortnight' })).toBeNull();
  });

  it('returns null when the row holds no listing', () => {
    expect(comparableOf({ ...row, title: null })).toBeNull();
  });
});
