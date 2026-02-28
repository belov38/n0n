import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { workflow } from './workflow';

export const execution = pgTable(
  'execution',
  {
    id: serial('id').primaryKey(),
    workflowId: varchar('workflow_id', { length: 36 })
      .notNull()
      .references(() => workflow.id),
    status: varchar('status', { length: 20 }).notNull(),
    mode: varchar('mode', { length: 20 }).notNull(),
    finished: boolean('finished').default(false).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    stoppedAt: timestamp('stopped_at', { withTimezone: true }),
    waitTill: timestamp('wait_till', { withTimezone: true }),
    retryOf: varchar('retry_of', { length: 36 }),
    retrySuccessId: varchar('retry_success_id', { length: 36 }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_execution_workflow_id').on(t.workflowId, t.id),
    index('idx_execution_wait_till').on(t.waitTill, t.id),
    index('idx_execution_finished').on(t.finished, t.id),
    index('idx_execution_workflow_finished').on(t.workflowId, t.finished, t.id),
    index('idx_execution_workflow_wait_till').on(t.workflowId, t.waitTill, t.id),
    index('idx_execution_stopped_at').on(t.stoppedAt),
  ],
);

export type Execution = typeof execution.$inferSelect;
export type NewExecution = typeof execution.$inferInsert;
