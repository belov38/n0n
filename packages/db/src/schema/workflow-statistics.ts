import {
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { workflow } from './workflow';

export const workflowStatistics = pgTable(
  'workflow_statistics',
  {
    id: serial('id').primaryKey(),
    workflowId: varchar('workflow_id', { length: 36 })
      .notNull()
      .references(() => workflow.id),
    name: varchar('name', { length: 128 }).notNull(),
    count: integer('count').default(0).notNull(),
    latestEvent: timestamp('latest_event', { withTimezone: true }),
  },
  (t) => [uniqueIndex('idx_workflow_statistics_workflow_name').on(t.workflowId, t.name)],
);

export type WorkflowStatistics = typeof workflowStatistics.$inferSelect;
export type NewWorkflowStatistics = typeof workflowStatistics.$inferInsert;
