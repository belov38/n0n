import { eq } from 'drizzle-orm';
import type { Database } from '../connection';
import { executionMetadata } from '../schema/execution-metadata';
import type { ExecutionMetadata } from '../schema/execution-metadata';

export class ExecutionMetadataRepo {
  constructor(private db: Database) {}

  async findByExecutionId(executionId: number): Promise<ExecutionMetadata[]> {
    return this.db
      .select()
      .from(executionMetadata)
      .where(eq(executionMetadata.executionId, executionId));
  }

  async create(executionId: number, key: string, value: string): Promise<ExecutionMetadata> {
    const results = await this.db
      .insert(executionMetadata)
      .values({ executionId, key, value })
      .returning();
    return results[0];
  }

  async createMany(
    executionId: number,
    entries: Array<{ key: string; value: string }>,
  ): Promise<ExecutionMetadata[]> {
    if (entries.length === 0) return [];
    const values = entries.map((entry) => ({ executionId, key: entry.key, value: entry.value }));
    return this.db.insert(executionMetadata).values(values).returning();
  }

  async deleteByExecutionId(executionId: number): Promise<void> {
    await this.db.delete(executionMetadata).where(eq(executionMetadata.executionId, executionId));
  }
}
