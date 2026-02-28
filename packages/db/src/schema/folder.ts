import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

export const folder = pgTable('folder', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 128 }).notNull(),
  parentFolderId: varchar('parent_folder_id', { length: 36 }).references(
    (): AnyPgColumn => folder.id,
  ),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Folder = typeof folder.$inferSelect;
export type NewFolder = typeof folder.$inferInsert;
