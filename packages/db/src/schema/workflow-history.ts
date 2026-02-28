import { jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { workflow } from './workflow';

export const workflowHistory = pgTable('workflow_history', {
  versionId: varchar('version_id', { length: 36 }).primaryKey(),
  workflowId: varchar('workflow_id', { length: 36 })
    .notNull()
    .references(() => workflow.id),
  nodes: jsonb('nodes').notNull(),
  connections: jsonb('connections').notNull(),
  authors: varchar('authors', { length: 256 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type WorkflowHistory = typeof workflowHistory.$inferSelect;
export type NewWorkflowHistory = typeof workflowHistory.$inferInsert;
