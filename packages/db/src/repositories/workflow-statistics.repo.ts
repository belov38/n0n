import { eq, sql } from 'drizzle-orm';
import type { Database } from '../connection';
import { workflowStatistics } from '../schema/workflow-statistics';
import type { WorkflowStatistics } from '../schema/workflow-statistics';

export class WorkflowStatisticsRepo {
  constructor(private db: Database) {}

  async findByWorkflowId(workflowId: string): Promise<WorkflowStatistics[]> {
    return this.db
      .select()
      .from(workflowStatistics)
      .where(eq(workflowStatistics.workflowId, workflowId));
  }

  async increment(workflowId: string, name: string): Promise<WorkflowStatistics> {
    const results = await this.db
      .insert(workflowStatistics)
      .values({ workflowId, name, count: 1, latestEvent: new Date() })
      .onConflictDoUpdate({
        target: [workflowStatistics.workflowId, workflowStatistics.name],
        set: {
          count: sql`${workflowStatistics.count} + 1`,
          latestEvent: new Date(),
        },
      })
      .returning();
    return results[0];
  }

  async upsert(workflowId: string, name: string, count: number): Promise<WorkflowStatistics> {
    const results = await this.db
      .insert(workflowStatistics)
      .values({ workflowId, name, count })
      .onConflictDoUpdate({
        target: [workflowStatistics.workflowId, workflowStatistics.name],
        set: { count },
      })
      .returning();
    return results[0];
  }

  async deleteByWorkflowId(workflowId: string): Promise<void> {
    await this.db
      .delete(workflowStatistics)
      .where(eq(workflowStatistics.workflowId, workflowId));
  }
}
