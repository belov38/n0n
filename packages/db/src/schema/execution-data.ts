import { integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { execution } from './execution';

export const executionData = pgTable('execution_data', {
  executionId: integer('execution_id')
    .primaryKey()
    .references(() => execution.id, { onDelete: 'cascade' }),
  workflowData: jsonb('workflow_data').notNull(),
  data: text('data').notNull(),
});

export type ExecutionData = typeof executionData.$inferSelect;
export type NewExecutionData = typeof executionData.$inferInsert;
