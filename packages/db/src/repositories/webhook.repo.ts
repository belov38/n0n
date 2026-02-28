import { eq, and, isNotNull } from 'drizzle-orm';
import type { Database } from '../connection';
import { webhook } from '../schema/webhook';
import type { Webhook, NewWebhook } from '../schema/webhook';

export class WebhookRepo {
  constructor(private db: Database) {}

  async findByPath(method: string, path: string): Promise<Webhook | undefined> {
    const results = await this.db
      .select()
      .from(webhook)
      .where(and(eq(webhook.method, method), eq(webhook.webhookPath, path)))
      .limit(1);
    return results[0];
  }

  async findAllByPath(path: string): Promise<Webhook[]> {
    return this.db
      .select()
      .from(webhook)
      .where(eq(webhook.webhookPath, path));
  }

  async findByMethod(method: string): Promise<Webhook[]> {
    return this.db
      .select()
      .from(webhook)
      .where(and(eq(webhook.method, method), isNotNull(webhook.webhookId)));
  }

  async findByWorkflowId(workflowId: string): Promise<Webhook[]> {
    return this.db.select().from(webhook).where(eq(webhook.workflowId, workflowId));
  }

  async create(data: NewWebhook): Promise<Webhook> {
    const results = await this.db.insert(webhook).values(data).returning();
    return results[0];
  }

  async deleteByWorkflowId(workflowId: string): Promise<void> {
    await this.db.delete(webhook).where(eq(webhook.workflowId, workflowId));
  }

  async deleteAll(): Promise<void> {
    await this.db.delete(webhook);
  }
}
