import { describe, expect, it } from 'vitest';
import { normalizeListing } from './normalize.js';

const raw = {
  id: 'acme-crm',
  title: 'Acme CRM',
  tagline: 'Simple CRM for small teams',
  price: '$29/mo',
  description: 'Track leads and deals in one place.',
};

function ok(input: unknown) {
  const result = normalizeListing(input);
  if (result.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result.listing;
}

describe('normalizeListing', () => {
  it('keeps the four compared fields and drops noise', () => {
    const listing = ok({
      ...raw,
      renderedAt: '2026-09-10T12:00:00Z',
      requestId: 'abc',
      promoBanner: 'Spring sale',
      viewerCount: 12,
      cache: { hit: true, ageSeconds: 3 },
    });

    expect(listing).toEqual({
      title: 'Acme CRM',
      tagline: 'Simple CRM for small teams',
      price: '$29/mo',
      priceParts: { amount: 29, currency: 'USD', period: 'month' },
      description: 'Track leads and deals in one place.',
    });
  });

  it('collapses whitespace and decodes HTML entities in text fields', () => {
    const listing = ok({
      ...raw,
      title: '  Acme CRM \n',
      tagline: 'Simple  CRM &amp; more',
      description: 'Track&nbsp;leads  and deals',
    });

    expect(listing.title).toBe('Acme CRM');
    expect(listing.tagline).toBe('Simple CRM & more');
    expect(listing.description).toBe('Track leads and deals');
  });

  it.each([
    ['$29/mo', { amount: 29, currency: 'USD', period: 'month' }],
    ['$29 / month', { amount: 29, currency: 'USD', period: 'month' }],
    ['USD 29 per month', { amount: 29, currency: 'USD', period: 'month' }],
    ['$29.00/mo', { amount: 29, currency: 'USD', period: 'month' }],
    ['€1,290.50/yr', { amount: 1290.5, currency: 'EUR', period: 'year' }],
    ['£8 / seat / month', { amount: 8, currency: 'GBP', period: 'seat_month' }],
    ['EUR 8 per seat per month', { amount: 8, currency: 'EUR', period: 'seat_month' }],
    ['Free', { amount: 0, currency: null, period: null }],
    ['Free forever', { amount: 0, currency: null, period: null }],
    ['$0/mo', { amount: 0, currency: null, period: null }],
  ])('reads the price %j in any Source format', (price, priceParts) => {
    expect(ok({ ...raw, price }).priceParts).toEqual(priceParts);
  });

  it('gives the same price text for every format of the same price', () => {
    const texts = ['$29/mo', '$29 / month', 'USD 29 per month', '$29.00/mo'].map(
      (price) => ok({ ...raw, price }).price,
    );

    expect(new Set(texts)).toEqual(new Set(['$29/mo']));
  });

  it('accepts a structured price object', () => {
    const listing = ok({ ...raw, price: { amount: 39, currency: 'USD', period: 'month' } });

    expect(listing.price).toBe('$39/mo');
    expect(listing.priceParts).toEqual({ amount: 39, currency: 'USD', period: 'month' });
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['blank', '   '],
  ])('reports a %s field as incomplete and names it', (_label, value) => {
    for (const field of ['title', 'tagline', 'price', 'description']) {
      const { [field as keyof typeof raw]: _removed, ...withoutField } = raw;
      const input = value === undefined ? withoutField : { ...raw, [field]: value };

      expect(normalizeListing(input)).toEqual({ kind: 'incomplete', missingField: field });
    }
  });

  it('reports a price it cannot read as incomplete', () => {
    expect(normalizeListing({ ...raw, price: 'call us' })).toEqual({
      kind: 'incomplete',
      missingField: 'price',
    });
  });

  it('reports a body that is not an object as incomplete', () => {
    expect(normalizeListing('oops')).toEqual({ kind: 'incomplete', missingField: 'title' });
  });
});
