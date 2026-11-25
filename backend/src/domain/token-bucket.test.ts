import { describe, expect, it } from 'vitest';
import { createTokenBucket } from './token-bucket.js';

function setup(options: { ratePerSecond: number; capacity: number }) {
  let nowMs = 0;
  const bucket = createTokenBucket({ ...options, now: () => nowMs });
  return {
    bucket,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe('token bucket', () => {
  it('hands out at most its capacity at once and then refuses', () => {
    const { bucket } = setup({ ratePerSecond: 4, capacity: 2 });

    expect([bucket.tryTake(), bucket.tryTake(), bucket.tryTake()]).toEqual([true, true, false]);
  });

  it('refills at the configured rate', () => {
    const { bucket, advance } = setup({ ratePerSecond: 4, capacity: 1 });
    bucket.tryTake();

    advance(249);
    expect(bucket.tryTake()).toBe(false);
    advance(1);
    expect(bucket.tryTake()).toBe(true);
  });

  it('never holds more than its capacity however long it idles', () => {
    const { bucket, advance } = setup({ ratePerSecond: 4, capacity: 2 });

    advance(60_000);

    expect(bucket.available()).toBe(2);
  });

  it('reports how long until the next token', () => {
    const { bucket, advance } = setup({ ratePerSecond: 4, capacity: 1 });
    bucket.tryTake();
    advance(100);

    expect(bucket.msUntilAvailable()).toBe(150);
  });

  it('hands out nothing while paused, then resumes with an empty bucket', () => {
    const { bucket, advance } = setup({ ratePerSecond: 4, capacity: 2 });

    bucket.pauseFor(3000);
    advance(2999);
    expect(bucket.tryTake()).toBe(false);
    expect(bucket.available()).toBe(0);
    expect(bucket.msUntilAvailable()).toBeGreaterThanOrEqual(1);

    advance(251);
    // The bucket is empty when the pause ends, so the first request after it cannot burst.
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });

  it('keeps the longer of two overlapping pauses', () => {
    const { bucket, advance } = setup({ ratePerSecond: 4, capacity: 1 });

    bucket.pauseFor(5000);
    bucket.pauseFor(1000);
    advance(4999);

    expect(bucket.tryTake()).toBe(false);
  });
});
