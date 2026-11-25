import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const competitors = pgTable('competitors', {
  id: text('id').primaryKey(),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  // Set when the user removes the Competitor. Snapshots stay; adding the id again clears it.
  removedAt: timestamp('removed_at', { withTimezone: true }),
  // Why the Competitor has no first Poll yet, e.g. the Source failed when it was added. Null otherwise.
  awaitingFirstPollReason: text('awaiting_first_poll_reason'),
});
