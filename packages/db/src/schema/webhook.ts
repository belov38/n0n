import { integer, pgTable, primaryKey, varchar } from 'drizzle-orm/pg-core';
import { workflow } from './workflow';

export const webhook = pgTable(
  'webhook',
  {
    workflowId: varchar('workflow_id', { length: 36 })
      .notNull()
      .references(() => workflow.id),
    webhookPath: varchar('webhook_path', { length: 255 }).notNull(),
    method: varchar('method', { length: 10 }).notNull(),
    node: varchar('node', { length: 255 }).notNull(),
    webhookId: varchar('webhook_id', { length: 36 }),
    pathLength: integer('path_length'),
  },
  (t) => [primaryKey({ columns: [t.webhookPath, t.method] })],
);

export type Webhook = typeof webhook.$inferSelect;
export type NewWebhook = typeof webhook.$inferInsert;
