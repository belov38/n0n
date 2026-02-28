import { pgTable, serial, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { workflow } from './workflow';

export const processedData = pgTable(
  'processed_data',
  {
    id: serial('id').primaryKey(),
    workflowId: varchar('workflow_id', { length: 36 })
      .notNull()
      .references(() => workflow.id),
    context: varchar('context', { length: 255 }).notNull(),
    value: text('value').notNull(),
  },
  (t) => [uniqueIndex('idx_processed_data_workflow_context').on(t.workflowId, t.context)],
);

export type ProcessedData = typeof processedData.$inferSelect;
export type NewProcessedData = typeof processedData.$inferInsert;
