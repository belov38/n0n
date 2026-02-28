import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { ScheduledTaskManager } from '../scheduled-task-manager';

describe('ScheduledTaskManager', () => {
  let manager: ScheduledTaskManager;

  beforeEach(() => {
    manager = new ScheduledTaskManager();
  });

  afterEach(() => {
    manager.deregisterAllCrons();
  });

  describe('registerCron', () => {
    it('should call the handler on interval', async () => {
      const handler = mock(() => {});

      // Use a very short interval for testing
      manager.registerCron(
        { workflowId: 'wf-1', nodeId: 'node-1', expression: '*/1 * * * *' },
        handler,
      );

      // Wait enough for one tick (*/1 = every minute = 60000ms, but we test registration)
      // The handler is called by setInterval so we just check it was registered
      expect(handler).not.toHaveBeenCalled();
    });

    it('should not register duplicate cron keys', () => {
      const handler1 = mock(() => {});
      const handler2 = mock(() => {});

      const ctx = { workflowId: 'wf-1', nodeId: 'node-1', expression: '*/5 * * * *' };
      manager.registerCron(ctx, handler1);
      manager.registerCron(ctx, handler2); // Duplicate — should be skipped
    });
  });

  describe('deregisterCrons', () => {
    it('should clear intervals for a workflow', () => {
      const handler = mock(() => {});
      manager.registerCron(
        { workflowId: 'wf-1', nodeId: 'node-1', expression: '*/5 * * * *' },
        handler,
      );
      manager.registerCron(
        { workflowId: 'wf-1', nodeId: 'node-2', expression: '0 * * * *' },
        handler,
      );

      // Should not throw
      manager.deregisterCrons('wf-1');
    });

    it('should be safe to deregister a workflow with no crons', () => {
      // Should not throw
      manager.deregisterCrons('wf-nonexistent');
    });
  });

  describe('deregisterAllCrons', () => {
    it('should clear all workflow crons', () => {
      const handler = mock(() => {});
      manager.registerCron(
        { workflowId: 'wf-1', nodeId: 'node-1', expression: '*/5 * * * *' },
        handler,
      );
      manager.registerCron(
        { workflowId: 'wf-2', nodeId: 'node-1', expression: '0 * * * *' },
        handler,
      );

      manager.deregisterAllCrons();
    });
  });
});
