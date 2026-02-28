import type { WorkflowRepo } from '@n0n/db';
import {
  ActiveWorkflows,
  ScheduledTaskManager,
  TriggersAndPollers,
  TriggerContext,
  type GetTriggerFunctions,
} from '@n0n/engine';
import type { WorkflowRunner, WorkflowExecutionData } from './workflow-runner';
import {
  Workflow,
  type INode,
  type INodeTypes,
  type INodeExecutionData,
  type ITriggerResponse,
  type IWorkflowExecuteAdditionalData,
  type IConnections,
  createRunExecutionData,
} from 'n8n-workflow';

export interface WebhookRegistrar {
  registerWebhook(data: {
    workflowId: string;
    webhookPath: string;
    method: string;
    node: string;
    webhookId?: string;
  }): Promise<unknown>;
  unregisterWorkflowWebhooks(workflowId: string): Promise<void>;
}

interface WorkflowNode {
  type: string;
  name: string;
  parameters: Record<string, unknown>;
}

const WEBHOOK_NODE_TYPES = new Set([
  'n0n-nodes.webhook',
  'n8n-nodes-base.webhook',
]);

/**
 * Manages activation/deactivation of workflows.
 * Registers webhooks, starts triggers/pollers on activation.
 * On startup, re-activates all workflows marked active in the DB.
 */
export class ActiveWorkflowManager {
  private activeWorkflowIds = new Set<string>();

  constructor(
    private workflowRepo: WorkflowRepo,
    private webhookService: WebhookRegistrar,
    private nodeTypes: INodeTypes,
    private activeWorkflows: ActiveWorkflows,
    private scheduledTaskManager: ScheduledTaskManager,
    private triggersAndPollers: TriggersAndPollers,
    private workflowRunner: WorkflowRunner,
  ) {}

  /**
   * Initialize on server startup: activate all workflows flagged active in DB.
   */
  async init(): Promise<void> {
    const activeWorkflows = await this.workflowRepo.findAllActive();
    for (const wf of activeWorkflows) {
      try {
        await this.add(wf.id);
      } catch (error) {
        console.error(`Failed to activate workflow ${wf.id}:`, error);
      }
    }
  }

  /**
   * Activate a workflow: register its webhooks, start triggers/pollers.
   */
  async add(workflowId: string): Promise<void> {
    if (this.activeWorkflowIds.has(workflowId)) return;

    const wfData = await this.workflowRepo.findById(workflowId);
    if (!wfData) throw new Error(`Workflow ${workflowId} not found`);

    const nodes = (wfData.nodes ?? []) as WorkflowNode[];

    // Register webhooks first, before Workflow constructor mutates node.parameters
    for (const node of nodes) {
      if (this.isWebhookNode(node.type)) {
        const path = (node.parameters?.path as string) || node.name;
        const method = ((node.parameters?.httpMethod as string) || 'GET').toUpperCase();
        await this.webhookService.registerWebhook({
          workflowId,
          webhookPath: path,
          method,
          node: node.name,
        });
      }
    }

    // Build a Workflow instance for trigger/poll node activation.
    // Note: the Workflow constructor mutates node.parameters via NodeHelpers.getNodeParameters().
    const workflow = new Workflow({
      id: workflowId,
      name: wfData.name,
      nodes: wfData.nodes as INode[],
      connections: wfData.connections as IConnections,
      active: wfData.active,
      nodeTypes: this.nodeTypes,
      staticData: wfData.staticData as Workflow['staticData'],
      settings: wfData.settings as Workflow['settings'],
    });

    const triggerResponses: ITriggerResponse[] = [];

    for (const node of nodes) {
      if (this.isWebhookNode(node.type)) continue;

      const nodeType = this.getNodeType(node);
      if (!nodeType) continue;

      if (this.isCronNode(node.type)) {
        const expression = (node.parameters?.cronExpression as string) || '* * * * *';
        this.scheduledTaskManager.registerCron(
          { workflowId, nodeId: node.name, expression },
          () => this.runTriggeredExecution(workflowId, wfData, node.name),
        );
      } else if (nodeType.trigger) {
        const getTriggerFunctions = this.createGetTriggerFunctions(workflowId, wfData);
        const response = await this.triggersAndPollers.runTrigger(
          workflow,
          workflow.getNode(node.name) as INode,
          getTriggerFunctions,
          'trigger',
          'activate',
        );
        if (response) {
          triggerResponses.push(response);
        }
      } else if (nodeType.poll) {
        const pollInterval = (node.parameters?.pollInterval as number) || 60_000;
        const intervalId = setInterval(() => {
          this.runTriggeredExecution(workflowId, wfData, node.name);
        }, pollInterval);
        triggerResponses.push({
          closeFunction: async () => clearInterval(intervalId),
        });
      }
    }

    if (triggerResponses.length > 0) {
      this.activeWorkflows.add(workflowId, triggerResponses);
    }

    this.activeWorkflowIds.add(workflowId);
  }

  /**
   * Deactivate a workflow: remove webhooks, stop triggers/pollers.
   */
  async remove(workflowId: string): Promise<void> {
    if (!this.activeWorkflowIds.has(workflowId)) return;

    await this.webhookService.unregisterWorkflowWebhooks(workflowId);
    await this.activeWorkflows.remove(workflowId);
    this.scheduledTaskManager.deregisterCrons(workflowId);

    this.activeWorkflowIds.delete(workflowId);
  }

  isActive(workflowId: string): boolean {
    return this.activeWorkflowIds.has(workflowId);
  }

  getActiveIds(): string[] {
    return Array.from(this.activeWorkflowIds);
  }

  private isWebhookNode(nodeType: string): boolean {
    return WEBHOOK_NODE_TYPES.has(nodeType);
  }

  private isCronNode(nodeType: string): boolean {
    return (
      nodeType.includes('scheduleTrigger') ||
      nodeType.includes('cronTrigger') ||
      nodeType.includes('cron')
    );
  }

  private getNodeType(node: WorkflowNode) {
    try {
      return this.nodeTypes.getByNameAndVersion(node.type);
    } catch {
      return undefined;
    }
  }

  private createGetTriggerFunctions(
    workflowId: string,
    wfData: { name: string; nodes: unknown; connections: unknown; active: boolean; settings: unknown; staticData: unknown },
  ): GetTriggerFunctions {
    return (workflow, node, mode, activation) => {
      const additionalData = {
        executionId: undefined,
        restApiUrl: '',
        instanceBaseUrl: '',
        credentialsHelper: { getDecrypted: () => Promise.resolve({}) },
      } as unknown as IWorkflowExecuteAdditionalData;

      const ctx = new TriggerContext({
        workflow,
        node,
        additionalData,
        mode,
        runExecutionData: null,
        runIndex: 0,
        connectionInputData: [],
        inputData: {},
        activation,
        emit: (data: INodeExecutionData[][]) => {
          const executionData = createRunExecutionData();
          executionData.resultData.runData[node.name] = [
            {
              startTime: Date.now(),
              executionTime: 0,
              executionIndex: 0,
              source: [],
              executionStatus: 'success',
              data: { main: data },
            },
          ];

          const execData: WorkflowExecutionData = {
            executionMode: 'trigger',
            workflowData: {
              id: workflowId,
              name: wfData.name,
              nodes: wfData.nodes as INode[],
              connections: wfData.connections as IConnections,
              active: wfData.active,
              settings: wfData.settings as Workflow['settings'],
              staticData: wfData.staticData as Workflow['staticData'],
            } as WorkflowExecutionData['workflowData'],
            executionData,
          };

          this.workflowRunner.run(execData).catch((err) => {
            console.error(`Trigger execution failed for workflow ${workflowId}:`, err);
          });
        },
      });

      return ctx as unknown as import('n8n-workflow').ITriggerFunctions;
    };
  }

  private runTriggeredExecution(
    workflowId: string,
    wfData: { name: string; nodes: unknown; connections: unknown; active: boolean; settings: unknown; staticData: unknown },
    startNode: string,
  ): void {
    const execData: WorkflowExecutionData = {
      executionMode: 'trigger',
      workflowData: {
        id: workflowId,
        name: wfData.name,
        nodes: wfData.nodes as INode[],
        connections: wfData.connections as IConnections,
        active: wfData.active,
        settings: wfData.settings as Workflow['settings'],
        staticData: wfData.staticData as Workflow['staticData'],
      } as WorkflowExecutionData['workflowData'],
      startNode,
    };

    this.workflowRunner.run(execData).catch((err) => {
      console.error(`Scheduled execution failed for workflow ${workflowId}:`, err);
    });
  }
}
