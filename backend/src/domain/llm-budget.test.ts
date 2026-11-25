import { describe, expect, it } from 'vitest';
import { allowedUsedAt, utcDayOf } from './llm-budget.js';

const at = (iso: string) => new Date(iso);

describe('utcDayOf', () => {
  it('names the UTC day, not the local one', () => {
    expect(utcDayOf(at('2026-03-04T23:59:59.999Z'))).toBe('2026-03-04');
    expect(utcDayOf(at('2026-03-05T00:00:00.000Z'))).toBe('2026-03-05');
  });
});

describe('allowedUsedAt', () => {
  const policy = { dailyCap: 2000, windowsPerDay: 24 };

  it('opens about a 24th of the cap in the first hour', () => {
    expect(allowedUsedAt(at('2026-03-04T00:00:00Z'), policy)).toBe(84);
  });

  it('lets unused allowance carry over, so the total grows hour by hour', () => {
    expect(allowedUsedAt(at('2026-03-04T01:30:00Z'), policy)).toBe(167);
    expect(allowedUsedAt(at('2026-03-04T11:59:59Z'), policy)).toBe(1000);
  });

  it('never allows more than the daily cap', () => {
    expect(allowedUsedAt(at('2026-03-04T23:59:59Z'), policy)).toBe(2000);
  });

  it('allows the whole cap at once when there is a single window', () => {
    expect(allowedUsedAt(at('2026-03-04T00:00:01Z'), { dailyCap: 5, windowsPerDay: 1 })).toBe(5);
  });

  it('allows nothing when the cap is zero', () => {
    expect(allowedUsedAt(at('2026-03-04T12:00:00Z'), { dailyCap: 0, windowsPerDay: 24 })).toBe(0);
  });
});
