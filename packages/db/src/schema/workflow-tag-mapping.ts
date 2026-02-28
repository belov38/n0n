import { pgTable, primaryKey, varchar } from 'drizzle-orm/pg-core';
import { tag } from './tag';
import { workflow } from './workflow';

export const workflowTagMapping = pgTable(
  'workflow_tag_mapping',
  {
    workflowId: varchar('workflow_id', { length: 36 })
      .notNull()
      .references(() => workflow.id),
    tagId: varchar('tag_id', { length: 36 })
      .notNull()
      .references(() => tag.id),
  },
  (t) => [primaryKey({ columns: [t.workflowId, t.tagId] })],
);

export type WorkflowTagMapping = typeof workflowTagMapping.$inferSelect;
export type NewWorkflowTagMapping = typeof workflowTagMapping.$inferInsert;
