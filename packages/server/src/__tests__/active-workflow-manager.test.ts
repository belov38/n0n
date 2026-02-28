import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { ActiveWorkflowManager } from '../active-workflow-manager';
import { ActiveWorkflows, ScheduledTaskManager, TriggersAndPollers } from '@n0n/engine';
import type { INodeTypes, INodeType, ITriggerResponse } from 'n8n-workflow';

function createMockWorkflowRepo() {
  return {
    findById: mock((_id: string) => Promise.resolve(undefined)),
    findAllActive: mock(() => Promise.resolve([])),
    findMany: mock(() => Promise.resolve([])),
    create: mock(() => Promise.resolve({} as Record<string, unknown>)),
    update: mock((_id: string, _data: Record<string, unknown>) => Promise.resolve(undefined)),
    delete: mock((_id: string) => Promise.resolve()),
    activate: mock((_id: string) => Promise.resolve(undefined)),
    deactivate: mock((_id: string) => Promise.resolve(undefined)),
    count: mock(() => Promise.resolve(0)),
  };
}

function createMockWebhookService() {
  return {
    registerWebhook: mock(() => Promise.resolve()),
    unregisterWorkflowWebhooks: mock(() => Promise.resolve()),
  };
}

function createMockNodeTypes(): INodeTypes {
  return {
    getByNameAndVersion: mock((_type: string, _version?: number): INodeType => {
      return { description: { properties: [], displayName: '', name: '', description: '', group: [], version: 1, defaults: {}, inputs: [], outputs: [] } };
    }),
    getKnownTypes: mock(() => ({})),
  } as unknown as INodeTypes;
}

function createMockWorkflowRunner() {
  return {
    run: mock(() => Promise.resolve('exec-1')),
  };
}

describe('ActiveWorkflowManager', () => {
  let manager: ActiveWorkflowManager;
  let workflowRepo: ReturnType<typeof createMockWorkflowRepo>;
  let webhookService: ReturnType<typeof createMockWebhookService>;
  let nodeTypes: ReturnType<typeof createMockNodeTypes>;
  let activeWorkflows: ActiveWorkflows;
  let scheduledTaskManager: ScheduledTaskManager;
  let triggersAndPollers: TriggersAndPollers;
  let workflowRunner: ReturnType<typeof createMockWorkflowRunner>;

  beforeEach(() => {
    workflowRepo = createMockWorkflowRepo();
    webhookService = createMockWebhookService();
    nodeTypes = createMockNodeTypes();
    activeWorkflows = new ActiveWorkflows();
    scheduledTaskManager = new ScheduledTaskManager();
    triggersAndPollers = new TriggersAndPollers();
    workflowRunner = createMockWorkflowRunner();
    manager = new ActiveWorkflowManager(
      workflowRepo as never,
      webhookService,
      nodeTypes,
      activeWorkflows,
      scheduledTaskManager,
      triggersAndPollers,
      workflowRunner as never,
    );
  });

  describe('init', () => {
    it('should activate all active workflows from DB', async () => {
      workflowRepo.findAllActive.mockResolvedValue([
        { id: 'wf-1', nodes: [], active: true },
        { id: 'wf-2', nodes: [], active: true },
      ] as never);
      workflowRepo.findById.mockImplementation((id: string) =>
        Promise.resolve({ id, nodes: [], connections: {}, active: true, name: 'test', settings: null, staticData: null } as never),
      );

      await manager.init();

      expect(manager.isActive('wf-1')).toBe(true);
      expect(manager.isActive('wf-2')).toBe(true);
    });

    it('should continue if one workflow fails to activate', async () => {
      workflowRepo.findAllActive.mockResolvedValue([
        { id: 'wf-fail', nodes: [], active: true },
        { id: 'wf-ok', nodes: [], active: true },
      ] as never);
      workflowRepo.findById.mockImplementation((id: string) => {
        if (id === 'wf-fail') return Promise.resolve(undefined);
        return Promise.resolve({ id, nodes: [], connections: {}, active: true, name: 'test', settings: null, staticData: null } as never);
      });

      await manager.init();

      expect(manager.isActive('wf-fail')).toBe(false);
      expect(manager.isActive('wf-ok')).toBe(true);
    });
  });

  describe('add', () => {
    it('should register webhook nodes', async () => {
      workflowRepo.findById.mockResolvedValue({
        id: 'wf-1',
        active: true,
        name: 'Test',
        connections: {},
        settings: null,
        staticData: null,
        nodes: [
          {
            type: 'n0n-nodes.webhook',
            name: 'Webhook',
            parameters: { path: '/my-hook', httpMethod: 'POST' },
          },
        ],
      } as never);

      await manager.add('wf-1');

      expect(webhookService.registerWebhook).toHaveBeenCalledWith({
        workflowId: 'wf-1',
        webhookPath: '/my-hook',
        method: 'POST',
        node: 'Webhook',
      });
      expect(manager.isActive('wf-1')).toBe(true);
    });

    it('should default to GET method and node name as path', async () => {
      workflowRepo.findById.mockResolvedValue({
        id: 'wf-1',
        active: true,
        name: 'Test',
        connections: {},
        settings: null,
        staticData: null,
        nodes: [
          {
            type: 'n8n-nodes-base.webhook',
            name: 'MyWebhook',
            parameters: {},
          },
        ],
      } as never);

      await manager.add('wf-1');

      expect(webhookService.registerWebhook).toHaveBeenCalledWith({
        workflowId: 'wf-1',
        webhookPath: 'MyWebhook',
        method: 'GET',
        node: 'MyWebhook',
      });
    });

    it('should skip if already active', async () => {
      workflowRepo.findById.mockResolvedValue({
        id: 'wf-1',
        nodes: [],
        connections: {},
        active: true,
        name: 'test',
        settings: null,
        staticData: null,
      } as never);

      await manager.add('wf-1');
      await manager.add('wf-1'); // Second call — should skip

      expect(workflowRepo.findById).toHaveBeenCalledTimes(1);
    });

    it('should throw if workflow not found', async () => {
      workflowRepo.findById.mockResolvedValue(undefined);
      await expect(manager.add('wf-missing')).rejects.toThrow('not found');
    });

    it('should register cron nodes via scheduledTaskManager', async () => {
      workflowRepo.findById.mockResolvedValue({
        id: 'wf-1',
        active: true,
        name: 'Cron WF',
        connections: {},
        settings: null,
        staticData: null,
        nodes: [
          {
            type: 'n0n-nodes.cronTrigger',
            name: 'CronNode',
            parameters: { cronExpression: '*/5 * * * *' },
          },
        ],
      } as never);

      await manager.add('wf-1');

      expect(manager.isActive('wf-1')).toBe(true);
    });

    it('should start trigger nodes and collect responses', async () => {
      const closeFn = mock(() => Promise.resolve());
      const triggerResponse: ITriggerResponse = { closeFunction: closeFn };

      (nodeTypes.getByNameAndVersion as ReturnType<typeof mock>).mockReturnValue({
        trigger: mock(() => Promise.resolve(triggerResponse)),
        description: { properties: [], displayName: '', name: 'customTrigger', group: [], version: 1, defaults: {}, inputs: [], outputs: [] },
      });

      workflowRepo.findById.mockResolvedValue({
        id: 'wf-1',
        active: true,
        name: 'Trigger WF',
        connections: {},
        settings: null,
        staticData: null,
        nodes: [
          {
            type: 'n0n-nodes.customTrigger',
            name: 'MyTrigger',
            typeVersion: 1,
            position: [0, 0],
            parameters: {},
          },
        ],
      } as never);

      await manager.add('wf-1');

      expect(manager.isActive('wf-1')).toBe(true);
      expect(activeWorkflows.isActive('wf-1')).toBe(true);
    });
  });

  describe('remove', () => {
    it('should unregister webhooks, stop triggers, and deregister crons', async () => {
      workflowRepo.findById.mockResolvedValue({
        id: 'wf-1',
        nodes: [],
        connections: {},
        active: true,
        name: 'test',
        settings: null,
        staticData: null,
      } as never);

      await manager.add('wf-1');
      await manager.remove('wf-1');

      expect(webhookService.unregisterWorkflowWebhooks).toHaveBeenCalledWith('wf-1');
      expect(manager.isActive('wf-1')).toBe(false);
    });

    it('should be a no-op for inactive workflow', async () => {
      await manager.remove('wf-nonexistent');
      expect(webhookService.unregisterWorkflowWebhooks).not.toHaveBeenCalled();
    });

    it('should call activeWorkflows.remove to invoke close functions', async () => {
      const closeFn = mock(() => Promise.resolve());
      activeWorkflows.add('wf-1', [{ closeFunction: closeFn }]);

      workflowRepo.findById.mockResolvedValue({
        id: 'wf-1',
        nodes: [],
        connections: {},
        active: true,
        name: 'test',
        settings: null,
        staticData: null,
      } as never);

      await manager.add('wf-1');
      await manager.remove('wf-1');

      expect(closeFn).toHaveBeenCalled();
      expect(activeWorkflows.isActive('wf-1')).toBe(false);
    });
  });

  describe('getActiveIds', () => {
    it('should return all active workflow IDs', async () => {
      workflowRepo.findById.mockImplementation((id: string) =>
        Promise.resolve({ id, nodes: [], connections: {}, active: true, name: 'test', settings: null, staticData: null } as never),
      );

      await manager.add('wf-1');
      await manager.add('wf-2');

      const ids = manager.getActiveIds();
      expect(ids).toContain('wf-1');
      expect(ids).toContain('wf-2');
      expect(ids).toHaveLength(2);
    });
  });
});
