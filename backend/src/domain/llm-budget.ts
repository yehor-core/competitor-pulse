export interface BudgetPolicy {
  /** The hard limit of LLM calls per UTC day. */
  dailyCap: number;
  /** How many equal windows the UTC day is split into; 24 gives the Hourly allowance, 1 turns spreading off. */
  windowsPerDay: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function utcDayOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * How many calls the UTC day may have used by `now`. Each window adds its share of the cap, and what an
 * earlier window left unused stays available, so the value is cumulative and never exceeds the cap.
 */
export function allowedUsedAt(now: Date, { dailyCap, windowsPerDay }: BudgetPolicy): number {
  const sinceMidnight = now.getTime() - Date.parse(`${utcDayOf(now)}T00:00:00Z`);
  const window = Math.floor((sinceMidnight * windowsPerDay) / DAY_MS);
  return Math.min(dailyCap, Math.ceil((dailyCap * (window + 1)) / windowsPerDay));
}
