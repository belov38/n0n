import { eq, inArray } from 'drizzle-orm';
import type { Database } from '../connection';
import { executionData } from '../schema/execution-data';
import type { ExecutionData, NewExecutionData } from '../schema/execution-data';

export class ExecutionDataRepo {
  constructor(private db: Database) {}

  async findByExecutionId(executionId: number): Promise<ExecutionData | undefined> {
    const results = await this.db
      .select()
      .from(executionData)
      .where(eq(executionData.executionId, executionId))
      .limit(1);
    return results[0];
  }

  async create(data: NewExecutionData): Promise<ExecutionData> {
    const results = await this.db.insert(executionData).values(data).returning();
    return results[0];
  }

  async update(
    executionId: number,
    data: Partial<Pick<ExecutionData, 'workflowData' | 'data'>>,
  ): Promise<ExecutionData | undefined> {
    const results = await this.db
      .update(executionData)
      .set(data)
      .where(eq(executionData.executionId, executionId))
      .returning();
    return results[0];
  }

  async deleteByExecutionId(executionId: number): Promise<void> {
    await this.db.delete(executionData).where(eq(executionData.executionId, executionId));
  }

  async deleteByExecutionIds(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.delete(executionData).where(inArray(executionData.executionId, ids));
  }
}
