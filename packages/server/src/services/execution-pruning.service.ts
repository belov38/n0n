import type { ExecutionRepo, ExecutionDataRepo } from '@n0n/db';

/**
 * Periodically prunes old completed/failed executions.
 * Intended to run on the leader instance only.
 */
export class ExecutionPruningService {
  private intervalId?: ReturnType<typeof setInterval>;
  private readonly PRUNE_INTERVAL = 60 * 60 * 1000; // 1 hour

  constructor(
    private executionRepo: ExecutionRepo,
    private executionDataRepo: ExecutionDataRepo,
    private maxAgeHours: number = 336, // 14 days
  ) {}

  start(): void {
    this.intervalId = setInterval(() => this.prune(), this.PRUNE_INTERVAL);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  async prune(): Promise<number> {
    const cutoff = new Date(Date.now() - this.maxAgeHours * 60 * 60 * 1000);

    try {
      const oldExecutions = await this.executionRepo.findMany({
        startedBefore: cutoff,
        limit: 100,
      });

      if (oldExecutions.length === 0) return 0;

      const ids = oldExecutions.map((e) => e.id);
      await this.executionDataRepo.deleteByExecutionIds(ids);
      await this.executionRepo.bulkDelete(ids);

      return ids.length;
    } catch (error) {
      console.error('Error pruning executions:', error);
      return 0;
    }
  }
}
