import { eq, and, like, desc, sql } from 'drizzle-orm';
import type { Database } from '../connection';
import { workflow } from '../schema/workflow';
import type { Workflow, NewWorkflow } from '../schema/workflow';

export class WorkflowRepo {
  constructor(private db: Database) {}

  async findById(id: string): Promise<Workflow | undefined> {
    const results = await this.db.select().from(workflow).where(eq(workflow.id, id)).limit(1);
    return results[0];
  }

  async findMany(options?: {
    active?: boolean;
    name?: string;
    limit?: number;
    offset?: number;
  }): Promise<Workflow[]> {
    let query = this.db.select().from(workflow);
    const conditions = [];

    if (options?.active !== undefined) {
      conditions.push(eq(workflow.active, options.active));
    }
    if (options?.name) {
      conditions.push(like(workflow.name, `%${options.name}%`));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    query = query.orderBy(desc(workflow.updatedAt)) as typeof query;

    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }
    if (options?.offset) {
      query = query.offset(options.offset) as typeof query;
    }

    return query;
  }

  async create(data: NewWorkflow): Promise<Workflow> {
    const results = await this.db.insert(workflow).values(data).returning();
    return results[0];
  }

  async update(id: string, data: Partial<NewWorkflow>): Promise<Workflow | undefined> {
    const results = await this.db
      .update(workflow)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(workflow.id, id))
      .returning();
    return results[0];
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(workflow).where(eq(workflow.id, id));
  }

  async activate(id: string): Promise<Workflow | undefined> {
    return this.update(id, { active: true });
  }

  async deactivate(id: string): Promise<Workflow | undefined> {
    return this.update(id, { active: false });
  }

  async findAllActive(): Promise<Workflow[]> {
    return this.db.select().from(workflow).where(eq(workflow.active, true));
  }

  async count(): Promise<number> {
    const result = await this.db.select({ count: sql<number>`count(*)` }).from(workflow);
    return result[0].count;
  }
}
