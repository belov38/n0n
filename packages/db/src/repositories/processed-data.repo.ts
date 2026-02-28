import { eq, and } from 'drizzle-orm';
import type { Database } from '../connection';
import { processedData } from '../schema/processed-data';
import type { ProcessedData } from '../schema/processed-data';

export class ProcessedDataRepo {
  constructor(private db: Database) {}

  async findByWorkflowAndContext(
    workflowId: string,
    context: string,
  ): Promise<ProcessedData | undefined> {
    const results = await this.db
      .select()
      .from(processedData)
      .where(and(eq(processedData.workflowId, workflowId), eq(processedData.context, context)))
      .limit(1);
    return results[0];
  }

  async upsert(workflowId: string, context: string, value: string): Promise<ProcessedData> {
    const results = await this.db
      .insert(processedData)
      .values({ workflowId, context, value })
      .onConflictDoUpdate({
        target: [processedData.workflowId, processedData.context],
        set: { value },
      })
      .returning();
    return results[0];
  }

  async deleteByWorkflowId(workflowId: string): Promise<void> {
    await this.db.delete(processedData).where(eq(processedData.workflowId, workflowId));
  }
}
