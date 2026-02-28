import { pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

export const tag = pgTable(
  'tag',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    name: varchar('name', { length: 24 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('tag_name_idx').on(t.name)],
);

export type Tag = typeof tag.$inferSelect;
export type NewTag = typeof tag.$inferInsert;
