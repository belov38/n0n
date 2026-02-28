import { pgTable, serial, text, varchar } from 'drizzle-orm/pg-core';

export const variable = pgTable('variable', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 255 }).notNull().unique(),
  value: text('value').notNull(),
  type: varchar('type', { length: 32 }).notNull().default('string'),
});

export type Variable = typeof variable.$inferSelect;
export type NewVariable = typeof variable.$inferInsert;
