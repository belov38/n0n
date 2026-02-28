import type { WorkflowRepo } from '@n0n/db';
import type { Workflow as WorkflowEntity } from '@n0n/db';
import { WorkflowExecute } from '@n0n/engine';
import type { NodeExecutor, ExecutionLifecycleHooks } from '@n0n/engine';
import type {
  INode,
  INodeTypes,
  IDataObject,
  WorkflowExecuteMode,
  IRun,
} from 'n8n-workflow';
import { Workflow } from 'n8n-workflow';
import type { EngineAdditionalData } from '@n0n/engine';
import type { WebhookResult } from './webhook-request-handler';
import type { ExecutionPersistence } from '../services/execution-persistence';
import type { PushService } from '../push/push.service';
import type { ActiveExecutions } from '../services/active-executions';

export interface TestWebhookRegistration {
  workflowId: string;
  nodeName: string;
  path: string;
  method: string;
  pushRef?: string;
  registeredAt: Date;
  timeout: ReturnType<typeof setTimeout>;
  /** Snapshot of the workflow data at registration time */
  workflowData: WorkflowEntity;
}

export interface TestWebhookDeps {
  workflowRepo: WorkflowRepo;
  executionPersistence: ExecutionPersistence;
  pushService: PushService;
  activeExecutions: ActiveExecutions;
  nodeExecutor: NodeExecutor;
  nodeTypes: INodeTypes;
  createHooks: (
    executionId: string,
    workflowId: string,
    mode: WorkflowExecuteMode,
  ) => ExecutionLifecycleHooks;
  additionalData: EngineAdditionalData;
}

/**
 * Manages ephemeral test webhooks used in the editor's "Listen for Test Event" feature.
 *
 * When a user clicks "Listen for Test Event", a temporary webhook is registered.
 * On the first matching HTTP request, the webhook fires: the workflow executes in
 * manual mode, the result is pushed to the editor via WebSocket, and the registration
 * is removed. Registrations automatically expire after the TTL.
 */
export class TestWebhooks {
  private registrations = new Map<string, TestWebhookRegistration>();
  private readonly TTL_MS = 2 * 60 * 1000; // 2 minutes

  constructor(private deps: TestWebhookDeps) {}

  /**
   * Register a test webhook. Returns the registration key.
   * Called from the workflow execution API when the user triggers a manual test.
   */
  register(
    workflowId: string,
    nodeName: string,
    path: string,
    method: string,
    pushRef?: string,
    workflowData?: WorkflowEntity,
  ): string {
    const key = this.toKey(method, path);

    // Clear existing registration for the same key
    this.unregister(key);

    const timeout = setTimeout(() => {
      const reg = this.registrations.get(key);
      if (reg) {
        this.registrations.delete(key);
        // Notify editor that the test webhook expired
        if (reg.pushRef) {
          this.deps.pushService.sendTo(reg.pushRef, {
            type: 'testWebhookDeleted',
            data: { workflowId },
          });
        }
      }
    }, this.TTL_MS);

    this.registrations.set(key, {
      workflowId,
      nodeName,
      path,
      method: method.toUpperCase(),
      pushRef,
      registeredAt: new Date(),
      timeout,
      workflowData: workflowData!,
    });

    return key;
  }

  /**
   * Check if the workflow needs a test webhook registered before it can run.
   * Registers all webhook nodes and returns true if any were registered.
   */
  async needsWebhook(
    workflowId: string,
    pushRef?: string,
  ): Promise<boolean> {
    const workflowData = await this.deps.workflowRepo.findById(workflowId);
    if (!workflowData) {
      throw new Error(`Workflow "${workflowId}" not found`);
    }

    const nodes = (workflowData.nodes ?? []) as INode[];
    const webhookNodes = nodes.filter(
      (node) => !node.disabled && this.isWebhookNode(node.type),
    );

    if (webhookNodes.length === 0) return false;

    for (const node of webhookNodes) {
      const path = (node.parameters?.path as string) || node.name;
      const method = ((node.parameters?.httpMethod as string) || 'GET').toUpperCase();
      this.register(workflowId, node.name, path, method, pushRef, workflowData);
    }

    return true;
  }

  /**
   * Find a test webhook registration matching the given method and path.
   */
  find(method: string, path: string): TestWebhookRegistration | undefined {
    return this.registrations.get(this.toKey(method, path));
  }

  /**
   * Execute the test webhook: run the workflow and push the result to the editor.
   * Single-use: the registration is removed after execution starts.
   */
  async executeWebhook(
    registration: TestWebhookRegistration,
    request: Request,
  ): Promise<WebhookResult> {
    const key = this.toKey(registration.method, registration.path);

    // Single-use: unregister immediately so duplicates don't fire
    this.unregister(key);

    const workflowData = registration.workflowData
      ?? await this.deps.workflowRepo.findById(registration.workflowId);

    if (!workflowData) {
      throw new Error(`Workflow "${registration.workflowId}" not found`);
    }

    const workflow = this.createWorkflow(workflowData);

    const startNode = workflow.getNode(registration.nodeName);
    if (!startNode) {
      throw new Error(
        `Could not find node "${registration.nodeName}" in workflow "${registration.workflowId}"`,
      );
    }

    // Parse request body
    const body = await this.parseRequestBody(request);

    // Create execution record in manual mode
    const executionId = await this.deps.executionPersistence.create(
      registration.workflowId,
      'manual',
    );

    const hooks = this.deps.createHooks(executionId, registration.workflowId, 'manual');

    const executor = new WorkflowExecute(
      this.deps.additionalData,
      'manual',
      this.deps.nodeExecutor,
      undefined,
      hooks,
    );

    // Track in active executions
    this.deps.activeExecutions.add({
      id: executionId,
      workflowId: registration.workflowId,
      mode: 'manual',
      startedAt: new Date(),
      status: 'running',
      cancel: () => executor.cancel(),
    });

    try {
      const run = await executor.run(workflow, startNode);

      // Push the result to the editor
      if (registration.pushRef) {
        this.deps.pushService.sendTo(registration.pushRef, {
          type: 'testWebhookReceived',
          data: {
            workflowId: registration.workflowId,
            executionId,
          },
        });
      }

      // Also clean up any remaining registrations for this workflow
      this.unregisterByWorkflowId(registration.workflowId);

      return this.extractResult(run, executionId);
    } finally {
      this.deps.activeExecutions.remove(executionId);
    }
  }

  /**
   * Unregister a specific webhook by key.
   */
  unregister(key: string): void {
    const reg = this.registrations.get(key);
    if (reg) {
      clearTimeout(reg.timeout);
      this.registrations.delete(key);
    }
  }

  /**
   * Unregister all webhooks for a given workflow.
   * Called when the user stops listening or navigates away.
   */
  unregisterByWorkflowId(workflowId: string): void {
    for (const [key, reg] of this.registrations) {
      if (reg.workflowId === workflowId) {
        this.unregister(key);
      }
    }
  }

  /**
   * Cancel a test webhook for a workflow, notify the editor.
   */
  cancelWebhook(workflowId: string): boolean {
    let found = false;
    for (const [key, reg] of this.registrations) {
      if (reg.workflowId === workflowId) {
        if (reg.pushRef) {
          this.deps.pushService.sendTo(reg.pushRef, {
            type: 'testWebhookDeleted',
            data: { workflowId },
          });
        }
        this.unregister(key);
        found = true;
      }
    }
    return found;
  }

  /**
   * Get all active registrations.
   */
  getAll(): TestWebhookRegistration[] {
    return Array.from(this.registrations.values());
  }

  /**
   * Check if there are active test webhook registrations for a workflow.
   */
  hasRegistrations(workflowId: string): boolean {
    for (const reg of this.registrations.values()) {
      if (reg.workflowId === workflowId) return true;
    }
    return false;
  }

  toKey(method: string, path: string): string {
    return `${method.toUpperCase()}:${path}`;
  }

  private isWebhookNode(nodeType: string): boolean {
    return nodeType === 'n0n-nodes.webhook' || nodeType === 'n8n-nodes-base.webhook';
  }

  private createWorkflow(workflowData: WorkflowEntity): Workflow {
    return new Workflow({
      id: workflowData.id,
      name: workflowData.name,
      nodes: workflowData.nodes as INode[],
      connections: workflowData.connections as Workflow['connectionsBySourceNode'],
      active: false, // test webhooks run against inactive workflows
      nodeTypes: this.deps.nodeTypes,
      staticData: workflowData.staticData as IDataObject,
      settings: workflowData.settings as IDataObject,
    });
  }

  private async parseRequestBody(request: Request): Promise<IDataObject> {
    const contentType = request.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      try {
        return (await request.json()) as IDataObject;
      } catch {
        return {};
      }
    }

    if (contentType.includes('application/x-www-form-urlencoded')) {
      try {
        const text = await request.text();
        const params = new URLSearchParams(text);
        const result: IDataObject = {};
        params.forEach((value, key) => {
          result[key] = value;
        });
        return result;
      } catch {
        return {};
      }
    }

    if (contentType.includes('text/')) {
      try {
        return { data: await request.text() } as IDataObject;
      } catch {
        return {};
      }
    }

    return {};
  }

  private extractResult(run: IRun, executionId: string): WebhookResult {
    if (run.data.resultData.error) {
      return {
        executionId,
        responseCode: 500,
        responseData: {
          error: run.data.resultData.error.message ?? 'Test execution failed',
        },
      };
    }

    const lastNodeName = run.data.resultData.lastNodeExecuted;
    if (lastNodeName) {
      const lastNodeRun = run.data.resultData.runData[lastNodeName];
      if (lastNodeRun?.length) {
        const lastRun = lastNodeRun[lastNodeRun.length - 1];
        const outputData = lastRun.data?.main?.[0];
        if (outputData?.length) {
          return {
            executionId,
            responseCode: 200,
            responseData: outputData[0].json as Record<string, unknown>,
          };
        }
      }
    }

    return { executionId };
  }
}
