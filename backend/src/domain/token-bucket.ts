export interface TokenBucketOptions {
  ratePerSecond: number;
  /** The largest burst. Over any window of length T, at most capacity + rate * T requests pass. */
  capacity: number;
  now: () => number;
}

export interface TokenBucket {
  /** Takes one token if there is one and the bucket is not paused. */
  tryTake(): boolean;
  /** Whole tokens that tryTake would hand out right now. */
  available(): number;
  msUntilAvailable(): number;
  /** Stops handing out tokens for the given time. The bucket is empty when the pause ends. */
  pauseFor(ms: number): void;
}

export function createTokenBucket({
  ratePerSecond,
  capacity,
  now,
}: TokenBucketOptions): TokenBucket {
  let tokens = capacity;
  let updatedAt = now();
  let pausedUntil = 0;

  function refill(): void {
    const current = now();
    if (current < pausedUntil) return;
    // Refill counts from the end of a pause, not from when it started.
    const from = Math.max(updatedAt, pausedUntil);
    tokens = Math.min(capacity, tokens + ((current - from) / 1000) * ratePerSecond);
    updatedAt = current;
  }

  return {
    tryTake() {
      refill();
      if (now() < pausedUntil || tokens < 1) return false;
      tokens -= 1;
      return true;
    },
    available() {
      refill();
      return now() < pausedUntil ? 0 : Math.floor(tokens);
    },
    msUntilAvailable() {
      refill();
      const pauseLeft = Math.max(0, pausedUntil - now());
      const missing = Math.max(0, 1 - tokens);
      return Math.ceil(pauseLeft + (missing / ratePerSecond) * 1000);
    },
    pauseFor(ms) {
      refill();
      pausedUntil = Math.max(pausedUntil, now() + ms);
      tokens = 0;
      updatedAt = pausedUntil;
    },
  };
}
