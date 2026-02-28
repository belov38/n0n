import { eq, desc } from 'drizzle-orm';
import type { Database } from '../connection';
import { workflowHistory } from '../schema/workflow-history';
import type { WorkflowHistory, NewWorkflowHistory } from '../schema/workflow-history';

export class WorkflowHistoryRepo {
  constructor(private db: Database) {}

  async findByWorkflowId(
    workflowId: string,
    options?: { limit?: number },
  ): Promise<WorkflowHistory[]> {
    let query = this.db
      .select()
      .from(workflowHistory)
      .where(eq(workflowHistory.workflowId, workflowId))
      .orderBy(desc(workflowHistory.createdAt));

    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }

    return query;
  }

  async findByVersionId(versionId: string): Promise<WorkflowHistory | undefined> {
    const results = await this.db
      .select()
      .from(workflowHistory)
      .where(eq(workflowHistory.versionId, versionId))
      .limit(1);
    return results[0];
  }

  async create(data: NewWorkflowHistory): Promise<WorkflowHistory> {
    const results = await this.db.insert(workflowHistory).values(data).returning();
    return results[0];
  }

  async deleteByWorkflowId(workflowId: string): Promise<void> {
    await this.db.delete(workflowHistory).where(eq(workflowHistory.workflowId, workflowId));
  }
}
