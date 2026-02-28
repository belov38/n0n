import { eq, and, desc, sql, inArray, isNull, lt, lte, gte, isNotNull } from 'drizzle-orm';
import type { Database } from '../connection';
import { execution } from '../schema/execution';
import type { Execution, NewExecution } from '../schema/execution';

export class ExecutionRepo {
  constructor(private db: Database) {}

  async findById(id: number): Promise<Execution | undefined> {
    const results = await this.db.select().from(execution).where(eq(execution.id, id)).limit(1);
    return results[0];
  }

  async findMany(options?: {
    workflowId?: string;
    status?: string;
    startedAfter?: Date;
    startedBefore?: Date;
    limit?: number;
    cursor?: number;
  }): Promise<Execution[]> {
    let query = this.db.select().from(execution);
    const conditions = [];

    conditions.push(isNull(execution.deletedAt));

    if (options?.workflowId) {
      conditions.push(eq(execution.workflowId, options.workflowId));
    }
    if (options?.status) {
      conditions.push(eq(execution.status, options.status));
    }
    if (options?.startedAfter) {
      conditions.push(gte(execution.startedAt, options.startedAfter));
    }
    if (options?.startedBefore) {
      conditions.push(lte(execution.startedAt, options.startedBefore));
    }
    if (options?.cursor) {
      conditions.push(lt(execution.id, options.cursor));
    }

    query = query.where(and(...conditions)) as typeof query;
    query = query.orderBy(desc(execution.id)) as typeof query;

    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }

    return query;
  }

  async create(data: NewExecution): Promise<Execution> {
    const results = await this.db.insert(execution).values(data).returning();
    return results[0];
  }

  async updateStatus(
    id: number,
    status: string,
    extra?: Partial<Pick<Execution, 'stoppedAt' | 'finished' | 'waitTill'>>,
  ): Promise<Execution | undefined> {
    const results = await this.db
      .update(execution)
      .set({ status, ...extra })
      .where(eq(execution.id, id))
      .returning();
    return results[0];
  }

  async markAsFinished(id: number, status: string): Promise<Execution | undefined> {
    return this.updateStatus(id, status, { finished: true, stoppedAt: new Date() });
  }

  async findRunning(): Promise<Execution[]> {
    return this.db
      .select()
      .from(execution)
      .where(and(eq(execution.status, 'running'), isNull(execution.deletedAt)));
  }

  async findWaiting(): Promise<Execution[]> {
    return this.db
      .select()
      .from(execution)
      .where(
        and(
          isNotNull(execution.waitTill),
          lte(execution.waitTill, new Date()),
          isNull(execution.deletedAt),
        ),
      );
  }

  async softDelete(id: number): Promise<void> {
    await this.db
      .update(execution)
      .set({ deletedAt: new Date() })
      .where(eq(execution.id, id));
  }

  async hardDelete(id: number): Promise<void> {
    await this.db.delete(execution).where(eq(execution.id, id));
  }

  async bulkDelete(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.delete(execution).where(inArray(execution.id, ids));
  }

  async countByWorkflowId(workflowId: string): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(execution)
      .where(and(eq(execution.workflowId, workflowId), isNull(execution.deletedAt)));
    return result[0].count;
  }
}
