import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { ExecutionPruningService } from '../services/execution-pruning.service';

function createMockExecutionRepo() {
  return {
    findMany: mock(() => Promise.resolve([])),
    bulkDelete: mock(() => Promise.resolve()),
  };
}

function createMockExecutionDataRepo() {
  return {
    deleteByExecutionIds: mock(() => Promise.resolve()),
  };
}

describe('ExecutionPruningService', () => {
  let service: ExecutionPruningService;
  let executionRepo: ReturnType<typeof createMockExecutionRepo>;
  let executionDataRepo: ReturnType<typeof createMockExecutionDataRepo>;

  beforeEach(() => {
    executionRepo = createMockExecutionRepo();
    executionDataRepo = createMockExecutionDataRepo();
    service = new ExecutionPruningService(
      executionRepo as never,
      executionDataRepo as never,
    );
  });

  afterEach(() => {
    service.stop();
  });

  describe('prune', () => {
    it('should return 0 when no old executions exist', async () => {
      executionRepo.findMany.mockResolvedValue([]);
      const count = await service.prune();
      expect(count).toBe(0);
    });

    it('should delete old executions and their data', async () => {
      executionRepo.findMany.mockResolvedValue([
        { id: 1, workflowId: 'wf-1', status: 'success' },
        { id: 2, workflowId: 'wf-2', status: 'error' },
      ] as never);

      const count = await service.prune();

      expect(count).toBe(2);
      expect(executionDataRepo.deleteByExecutionIds).toHaveBeenCalledWith([1, 2]);
      expect(executionRepo.bulkDelete).toHaveBeenCalledWith([1, 2]);
    });

    it('should return 0 on error', async () => {
      executionRepo.findMany.mockRejectedValue(new Error('db error'));
      const count = await service.prune();
      expect(count).toBe(0);
    });
  });

  describe('start/stop', () => {
    it('should start and stop without error', () => {
      service.start();
      service.stop();
    });

    it('should be safe to stop when not started', () => {
      service.stop();
    });
  });
});
