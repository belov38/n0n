import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { WaitTracker } from '../wait-tracker';

function createMockExecutionRepo() {
  return {
    findWaiting: mock(() => Promise.resolve([])),
  };
}

describe('WaitTracker', () => {
  let tracker: WaitTracker;
  let executionRepo: ReturnType<typeof createMockExecutionRepo>;
  let onResume: ReturnType<typeof mock>;

  beforeEach(() => {
    executionRepo = createMockExecutionRepo();
    onResume = mock(() => Promise.resolve());
    tracker = new WaitTracker(executionRepo as never, onResume);
  });

  afterEach(() => {
    tracker.stop();
  });

  describe('start', () => {
    it('should immediately check for waiting executions', async () => {
      executionRepo.findWaiting.mockResolvedValue([
        { id: 1, workflowId: 'wf-1', status: 'waiting' },
      ] as never);

      tracker.start();

      // Give it a tick to process the immediate check
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(executionRepo.findWaiting).toHaveBeenCalled();
      expect(onResume).toHaveBeenCalledWith('1');
    });

    it('should resume multiple waiting executions', async () => {
      executionRepo.findWaiting.mockResolvedValue([
        { id: 1, workflowId: 'wf-1', status: 'waiting' },
        { id: 2, workflowId: 'wf-2', status: 'waiting' },
      ] as never);

      tracker.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(onResume).toHaveBeenCalledTimes(2);
      expect(onResume).toHaveBeenCalledWith('1');
      expect(onResume).toHaveBeenCalledWith('2');
    });

    it('should not throw if onResume fails for one execution', async () => {
      onResume
        .mockRejectedValueOnce(new Error('resume failed'))
        .mockResolvedValueOnce(undefined);

      executionRepo.findWaiting.mockResolvedValue([
        { id: 1, workflowId: 'wf-1', status: 'waiting' },
        { id: 2, workflowId: 'wf-2', status: 'waiting' },
      ] as never);

      tracker.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Both should have been attempted
      expect(onResume).toHaveBeenCalledTimes(2);
    });
  });

  describe('stop', () => {
    it('should be safe to call when not started', () => {
      tracker.stop();
    });

    it('should be safe to call multiple times', () => {
      tracker.start();
      tracker.stop();
      tracker.stop();
    });
  });
});
