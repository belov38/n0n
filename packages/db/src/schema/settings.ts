import { boolean, pgTable, text, varchar } from 'drizzle-orm/pg-core';

export const settings = pgTable('settings', {
  key: varchar('key', { length: 255 }).primaryKey(),
  value: text('value').notNull(),
  loadOnStartup: boolean('load_on_startup').default(true).notNull(),
});

export type Settings = typeof settings.$inferSelect;
export type NewSettings = typeof settings.$inferInsert;
