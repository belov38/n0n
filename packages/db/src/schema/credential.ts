import { pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const credential = pgTable('credential', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 128 }).notNull(),
  type: varchar('type', { length: 128 }).notNull(),
  data: text('data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Credential = typeof credential.$inferSelect;
export type NewCredential = typeof credential.$inferInsert;
