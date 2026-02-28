import type { Job } from 'bullmq';
import type { ExecutionJob } from './scaling.service';

export interface JobProcessorDeps {
  loadExecution: (executionId: string) => Promise<{ workflowId: string; data: unknown } | null>;
  runExecution: (executionId: string, workflowId: string) => Promise<void>;
  reportResult: (executionId: string, status: 'success' | 'error', error?: string) => Promise<void>;
}

export class JobProcessor {
  constructor(private deps: JobProcessorDeps) {}

  async process(job: Job<ExecutionJob>): Promise<void> {
    const { executionId, workflowId } = job.data;

    try {
      // Load execution data from DB
      const execution = await this.deps.loadExecution(executionId);
      if (!execution) {
        throw new Error(`Execution ${executionId} not found`);
      }

      // Run the execution
      await this.deps.runExecution(executionId, workflowId);

      // Report success
      await this.deps.reportResult(executionId, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.deps.reportResult(executionId, 'error', message);
      throw error;
    }
  }
}
