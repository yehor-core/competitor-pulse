import {
  bigserial,
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const competitors = pgTable(
  'competitors',
  {
    id: text('id').primaryKey(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    // Set when the user removes the Competitor. Snapshots stay; adding the id again clears it.
    removedAt: timestamp('removed_at', { withTimezone: true }),
    // Why the Competitor has no first Poll yet, e.g. the Source failed when it was added. Null otherwise.
    awaitingFirstPollReason: text('awaiting_first_poll_reason'),
    // The scheduler claims Competitors whose next_poll_at has passed. Kept in the database so a restart loses nothing.
    nextPollAt: timestamp('next_poll_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('competitors_next_poll_at_idx').on(table.nextPollAt)],
);

export const snapshots = pgTable(
  'snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    competitorId: text('competitor_id')
      .notNull()
      .references(() => competitors.id),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    // 'ok' | 'failed' | 'incomplete' | 'delisted'; validated in code (see src/snapshots/model.ts).
    pollStatus: text('poll_status').notNull(),
    // Why a failed Poll failed, or which field made an incomplete Poll incomplete. Null for ok and delisted.
    failureReason: text('failure_reason'),
    // The Normalized listing. Null unless the Poll status is ok.
    title: text('title'),
    tagline: text('tagline'),
    price: text('price'),
    priceAmount: numeric('price_amount'),
    priceCurrency: text('price_currency'),
    pricePeriod: text('price_period'),
    description: text('description'),
    // Filled by change detection and the Summary pipeline; defaults describe a Poll nobody compared yet.
    changed: boolean('changed').notNull().default(false),
    summary: text('summary'),
    summaryStatus: text('summary_status').notNull().default('not_applicable'),
  },
  (table) => [
    index('snapshots_competitor_fetched_idx').on(table.competitorId, table.fetchedAt.desc()),
  ],
);

export const llmBudget = pgTable('llm_budget', {
  // The UTC day as YYYY-MM-DD. One row per day that made a call; kept in Postgres so a restart cannot reset it.
  day: text('day').primaryKey(),
  // Calls reserved that day, including ones whose outcome is still unknown.
  used: integer('used').notNull().default(0),
});
