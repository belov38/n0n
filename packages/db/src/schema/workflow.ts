import {
  boolean,
  integer,
  jsonb,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const workflow = pgTable('workflow', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 128 }).notNull(),
  active: boolean('active').default(false).notNull(),
  nodes: jsonb('nodes').notNull().default([]),
  connections: jsonb('connections').notNull().default({}),
  settings: jsonb('settings'),
  staticData: jsonb('static_data'),
  pinData: jsonb('pin_data'),
  versionId: varchar('version_id', { length: 36 }).notNull(),
  triggerCount: integer('trigger_count').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Workflow = typeof workflow.$inferSelect;
export type NewWorkflow = typeof workflow.$inferInsert;
