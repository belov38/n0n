import type { ExecutionRepo } from '@n0n/db';

/**
 * Periodically polls the DB for executions whose waitTill has expired,
 * then resumes them via the provided callback.
 */
export class WaitTracker {
  private intervalId?: ReturnType<typeof setInterval>;
  private readonly POLL_INTERVAL = 60_000; // 60 seconds

  constructor(
    private executionRepo: ExecutionRepo,
    private onResume: (executionId: string) => Promise<void>,
  ) {}

  start(): void {
    this.intervalId = setInterval(() => this.checkWaiting(), this.POLL_INTERVAL);
    // Check immediately on start
    this.checkWaiting();
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  private async checkWaiting(): Promise<void> {
    try {
      const waitingExecutions = await this.executionRepo.findWaiting();
      for (const execution of waitingExecutions) {
        try {
          await this.onResume(String(execution.id));
        } catch (error) {
          console.error(`Failed to resume execution ${execution.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Error checking waiting executions:', error);
    }
  }
}
