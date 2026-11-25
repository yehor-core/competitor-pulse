import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const competitors = pgTable('competitors', {
  id: text('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
