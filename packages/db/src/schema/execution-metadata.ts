import { integer, pgTable, serial, text, varchar } from 'drizzle-orm/pg-core';
import { execution } from './execution';

export const executionMetadata = pgTable('execution_metadata', {
  id: serial('id').primaryKey(),
  executionId: integer('execution_id')
    .notNull()
    .references(() => execution.id, { onDelete: 'cascade' }),
  key: varchar('key', { length: 255 }).notNull(),
  value: text('value').notNull(),
});

export type ExecutionMetadata = typeof executionMetadata.$inferSelect;
export type NewExecutionMetadata = typeof executionMetadata.$inferInsert;
