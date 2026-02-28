import type { Job } from 'bullmq';
import type { ExecutionJob } from './scaling.service';

export class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientError';
  }
}

export interface JobProcessorDeps {
  loadExecution: (executionId: string) => Promise<{ workflowId: string; data: unknown } | null>;
  runExecution: (executionId: string, workflowId: string) => Promise<void>;
  reportResult: (executionId: string, status: 'success' | 'error', error?: string) => Promise<void>;
}

const MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class JobProcessor {
  constructor(
    private deps: JobProcessorDeps,
    private timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async process(job: Job<ExecutionJob>): Promise<void> {
    const { executionId, workflowId } = job.data;
    const attempt = job.attemptsMade + 1;

    console.log(`[JobProcessor] Starting execution ${executionId} (attempt ${attempt}/${MAX_ATTEMPTS}, job ${job.id})`);

    if (job.attemptsMade >= MAX_ATTEMPTS) {
      console.error(`[JobProcessor] Execution ${executionId} exceeded max attempts (${MAX_ATTEMPTS}), marking permanently failed`);
      await this.deps.reportResult(executionId, 'error', `Permanently failed after ${MAX_ATTEMPTS} attempts`);
      return;
    }

    if (attempt > 1) {
      console.log(`[JobProcessor] Retrying execution ${executionId}, attempt ${attempt}`);
    }

    try {
      await job.updateProgress(10);
      const execution = await this.deps.loadExecution(executionId);
      if (!execution) {
        throw new Error(`Execution ${executionId} not found`);
      }
      console.log(`[JobProcessor] Loaded execution ${executionId} for workflow ${workflowId}`);

      await job.updateProgress(30);
      await this.withTimeout(
        this.deps.runExecution(executionId, workflowId),
        executionId,
      );
      console.log(`[JobProcessor] Execution ${executionId} completed`);

      await job.updateProgress(90);
      await this.deps.reportResult(executionId, 'success');
      console.log(`[JobProcessor] Reported success for execution ${executionId}`);

      await job.updateProgress(100);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const isRetryable = this.isRetryableError(error);

      console.error(`[JobProcessor] Execution ${executionId} failed: ${message} (retryable: ${isRetryable})`);

      await this.deps.reportResult(executionId, 'error', message);

      if (!isRetryable) {
        console.error(`[JobProcessor] Permanent failure for execution ${executionId}, will not retry`);
        return;
      }

      throw error;
    }
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof TransientError) return true;

    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('not found')) return false;
      if (msg.includes('invalid')) return false;
      if (msg.includes('timeout')) return true;
      if (msg.includes('econnrefused') || msg.includes('econnreset')) return true;
    }

    return false;
  }

  private withTimeout(promise: Promise<void>, executionId: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new TransientError(`Execution ${executionId} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      promise.then(resolve, reject).finally(() => clearTimeout(timer));
    });
  }
}
