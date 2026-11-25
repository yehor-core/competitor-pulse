export type PricePeriod = 'month' | 'year' | 'seat_month';

export interface PriceParts {
  amount: number;
  currency: string | null;
  period: PricePeriod | null;
}

export interface NormalizedListing {
  title: string;
  tagline: string;
  /** Display text built from `priceParts`, e.g. "$29/mo". Identical for every Source format of one price. */
  price: string;
  priceParts: PriceParts;
  description: string;
}

export type ListingField = 'title' | 'tagline' | 'price' | 'description';

export type NormalizeResult =
  { kind: 'ok'; listing: NormalizedListing } | { kind: 'incomplete'; missingField: ListingField };

const SYMBOL_TO_CURRENCY: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP' };
const CURRENCY_TO_SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
const PERIOD_SUFFIX: Record<PricePeriod, string> = {
  month: '/mo',
  year: '/yr',
  seat_month: '/seat/mo',
};
// Keys are period text with all whitespace removed and lower-cased.
const PERIOD_TEXT: Record<string, PricePeriod> = {
  '/mo': 'month',
  '/month': 'month',
  permonth: 'month',
  '/yr': 'year',
  '/year': 'year',
  peryear: 'year',
  '/seat/mo': 'seat_month',
  '/seat/month': 'seat_month',
  perseatpermonth: 'seat_month',
};

const FREE: PriceParts = { amount: 0, currency: null, period: null };

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const decoded = value
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  const collapsed = decoded.replace(/\s+/g, ' ').trim();
  return collapsed === '' ? null : collapsed;
}

function parsePriceText(text: string): PriceParts | null {
  if (/^free\b/i.test(text)) return FREE;
  const match = /^(?:([$€£])|([A-Za-z]{3})\s)\s*(\d[\d,]*(?:\.\d+)?)\s*(.+)$/.exec(text);
  if (!match) return null;
  const [, symbol, code, amountText, periodText] = match;
  if (amountText === undefined || periodText === undefined) return null;
  const currency = symbol !== undefined ? SYMBOL_TO_CURRENCY[symbol] : code?.toUpperCase();
  const period = PERIOD_TEXT[periodText.replace(/\s+/g, '').toLowerCase()];
  const amount = Number(amountText.replace(/,/g, ''));
  if (currency === undefined || period === undefined || !Number.isFinite(amount)) return null;
  return amount === 0 ? FREE : { amount, currency, period };
}

function parsePriceObject(value: object): PriceParts | null {
  const { amount, currency, period } = value as Record<string, unknown>;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null;
  if (amount === 0) return FREE;
  if (typeof currency !== 'string' || currency === '') return null;
  if (period !== 'month' && period !== 'year' && period !== 'seat_month') return null;
  return { amount, currency: currency.toUpperCase(), period };
}

function parsePrice(value: unknown): PriceParts | null {
  if (typeof value === 'string') {
    const text = cleanText(value);
    return text === null ? null : parsePriceText(text);
  }
  if (typeof value === 'object' && value !== null) return parsePriceObject(value);
  return null;
}

function formatPrice({ amount, currency, period }: PriceParts): string {
  if (currency === null || period === null) return 'Free';
  const symbol = CURRENCY_TO_SYMBOL[currency];
  const number = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return `${symbol ?? `${currency} `}${number}${PERIOD_SUFFIX[period]}`;
}

/** Reduces a Source response body to a Normalized listing, or names the first field that is unusable. */
export function normalizeListing(body: unknown): NormalizeResult {
  const source: Record<string, unknown> =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

  const title = cleanText(source.title);
  if (title === null) return { kind: 'incomplete', missingField: 'title' };
  const tagline = cleanText(source.tagline);
  if (tagline === null) return { kind: 'incomplete', missingField: 'tagline' };
  const priceParts = parsePrice(source.price);
  if (priceParts === null) return { kind: 'incomplete', missingField: 'price' };
  const description = cleanText(source.description);
  if (description === null) return { kind: 'incomplete', missingField: 'description' };

  return {
    kind: 'ok',
    listing: { title, tagline, price: formatPrice(priceParts), priceParts, description },
  };
}
