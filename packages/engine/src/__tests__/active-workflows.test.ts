import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { ActiveWorkflows } from '../active-workflows';
import type { ITriggerResponse } from 'n8n-workflow';

describe('ActiveWorkflows', () => {
  let activeWorkflows: ActiveWorkflows;

  beforeEach(() => {
    activeWorkflows = new ActiveWorkflows();
  });

  describe('isActive', () => {
    it('should return false for unknown workflow', () => {
      expect(activeWorkflows.isActive('wf-1')).toBe(false);
    });

    it('should return true after adding a workflow', () => {
      activeWorkflows.add('wf-1', []);
      expect(activeWorkflows.isActive('wf-1')).toBe(true);
    });
  });

  describe('allActiveWorkflowIds', () => {
    it('should return empty array when no workflows are active', () => {
      expect(activeWorkflows.allActiveWorkflowIds()).toEqual([]);
    });

    it('should return all active workflow IDs', () => {
      activeWorkflows.add('wf-1', []);
      activeWorkflows.add('wf-2', []);
      const ids = activeWorkflows.allActiveWorkflowIds();
      expect(ids).toContain('wf-1');
      expect(ids).toContain('wf-2');
      expect(ids).toHaveLength(2);
    });
  });

  describe('get', () => {
    it('should return undefined for unknown workflow', () => {
      expect(activeWorkflows.get('wf-1')).toBeUndefined();
    });

    it('should return workflow data after adding', () => {
      const responses: ITriggerResponse[] = [];
      activeWorkflows.add('wf-1', responses);
      const data = activeWorkflows.get('wf-1');
      expect(data).toBeDefined();
      expect(data!.triggerResponses).toBe(responses);
    });
  });

  describe('add', () => {
    it('should store trigger responses', () => {
      const closeFunction = mock(() => Promise.resolve());
      const responses: ITriggerResponse[] = [{ closeFunction }];

      activeWorkflows.add('wf-1', responses);
      expect(activeWorkflows.isActive('wf-1')).toBe(true);
      expect(activeWorkflows.get('wf-1')!.triggerResponses).toHaveLength(1);
    });
  });

  describe('remove', () => {
    it('should return false for unknown workflow', async () => {
      expect(await activeWorkflows.remove('wf-1')).toBe(false);
    });

    it('should remove the workflow and return true', async () => {
      activeWorkflows.add('wf-1', []);
      expect(await activeWorkflows.remove('wf-1')).toBe(true);
      expect(activeWorkflows.isActive('wf-1')).toBe(false);
    });

    it('should call closeFunction on each trigger response', async () => {
      const close1 = mock(() => Promise.resolve());
      const close2 = mock(() => Promise.resolve());
      const responses: ITriggerResponse[] = [
        { closeFunction: close1 },
        { closeFunction: close2 },
      ];

      activeWorkflows.add('wf-1', responses);
      await activeWorkflows.remove('wf-1');

      expect(close1).toHaveBeenCalledTimes(1);
      expect(close2).toHaveBeenCalledTimes(1);
    });

    it('should not throw if closeFunction errors', async () => {
      const closeFunction = mock(() => Promise.reject(new Error('close error')));
      activeWorkflows.add('wf-1', [{ closeFunction }]);

      // Should not throw
      await activeWorkflows.remove('wf-1');
      expect(activeWorkflows.isActive('wf-1')).toBe(false);
    });
  });

  describe('removeAll', () => {
    it('should remove all active workflows', async () => {
      const close1 = mock(() => Promise.resolve());
      const close2 = mock(() => Promise.resolve());

      activeWorkflows.add('wf-1', [{ closeFunction: close1 }]);
      activeWorkflows.add('wf-2', [{ closeFunction: close2 }]);

      await activeWorkflows.removeAll();

      expect(activeWorkflows.allActiveWorkflowIds()).toEqual([]);
      expect(close1).toHaveBeenCalledTimes(1);
      expect(close2).toHaveBeenCalledTimes(1);
    });
  });
});
