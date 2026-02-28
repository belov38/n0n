import type { WorkflowRepo } from '@n0n/db';
import type { Webhook, Workflow as WorkflowEntity } from '@n0n/db';
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
import type { WebhookResult, WebhookResponseMode } from './webhook-request-handler';
import type { WebhookService } from './webhook.service';
import type { ExecutionPersistence } from '../services/execution-persistence';
import type { PushService } from '../push/push.service';
import type { ActiveExecutions } from '../services/active-executions';

export interface LiveWebhookDeps {
  webhookService: WebhookService;
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
 * Handles execution of production webhooks (activated workflows using the production URL).
 * Looks up the webhook in DB, loads the workflow, creates an execution, runs the engine,
 * and returns the result based on the configured response mode.
 */
export class LiveWebhooks {
  constructor(private deps: LiveWebhookDeps) {}

  /**
   * Find a registered webhook for the given method and path.
   */
  async findWebhook(method: string, path: string): Promise<Webhook | undefined> {
    return this.deps.webhookService.findWebhook(method, path);
  }

  /**
   * Get the allowed HTTP methods for a webhook path (for CORS).
   */
  async getWebhookMethods(path: string): Promise<string[]> {
    return this.deps.webhookService.getWebhookMethods(path);
  }

  /**
   * Execute a webhook: load the workflow, create an execution, run through the engine,
   * and return the result.
   */
  async executeWebhook(
    webhook: Webhook,
    request: Request,
    responseMode: WebhookResponseMode = 'lastNode',
  ): Promise<WebhookResult> {
    const workflowData = await this.deps.workflowRepo.findById(webhook.workflowId);
    if (!workflowData) {
      throw new Error(`Workflow "${webhook.workflowId}" not found`);
    }

    if (!workflowData.active) {
      throw new Error(`Workflow "${webhook.workflowId}" is not active`);
    }

    // Build workflow instance
    const workflow = this.createWorkflow(workflowData);

    // Find the webhook start node in the workflow
    const startNode = workflow.getNode(webhook.node);
    if (!startNode) {
      throw new Error(`Could not find node "${webhook.node}" in workflow "${webhook.workflowId}"`);
    }

    // Extract dynamic path params if the webhook has param segments
    const pathParams = webhook.webhookId
      ? this.deps.webhookService.extractPathParams(webhook.webhookPath, new URL(request.url).pathname, webhook.webhookId)
      : {};

    // Parse request body
    const body = await this.parseRequestBody(request);

    // Create execution record
    const executionId = await this.deps.executionPersistence.create(
      webhook.workflowId,
      'webhook',
    );

    // Create lifecycle hooks
    const hooks = this.deps.createHooks(executionId, webhook.workflowId, 'webhook');

    // Build webhook input data for the start node
    const webhookInput = this.buildWebhookInput(request, body, pathParams);

    // For 'onReceived' mode, we start execution asynchronously and return immediately
    if (responseMode === 'onReceived') {
      this.runWorkflowAsync(workflow, startNode, webhookInput, hooks, executionId);
      return { executionId };
    }

    // For 'lastNode' and 'responseNode' modes, run synchronously and return the result
    const run = await this.runWorkflow(workflow, startNode, webhookInput, hooks);

    return this.extractResult(run, responseMode, executionId);
  }

  private createWorkflow(workflowData: WorkflowEntity): Workflow {
    return new Workflow({
      id: workflowData.id,
      name: workflowData.name,
      nodes: workflowData.nodes as INode[],
      connections: workflowData.connections as Workflow['connectionsBySourceNode'],
      active: workflowData.active,
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
        return { data: await request.text() };
      } catch {
        return {};
      }
    }

    // For binary or unknown content types, store as raw buffer info
    return {};
  }

  private buildWebhookInput(
    request: Request,
    body: Record<string, unknown>,
    pathParams: Record<string, string>,
  ): Record<string, unknown> {
    const url = new URL(request.url);
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      method: request.method,
      headers,
      params: pathParams,
      query,
      body,
    };
  }

  private async runWorkflow(
    workflow: Workflow,
    startNode: INode,
    webhookInput: Record<string, unknown>,
    hooks: ExecutionLifecycleHooks,
  ): Promise<IRun> {
    const executor = new WorkflowExecute(
      this.deps.additionalData,
      'webhook',
      this.deps.nodeExecutor,
      undefined,
      hooks,
    );

    // Register in active executions
    this.deps.activeExecutions.add({
      id: hooks.executionId,
      workflowId: hooks.workflowId,
      mode: 'webhook',
      startedAt: new Date(),
      status: 'running',
      cancel: () => executor.cancel(),
    });

    try {
      // Provide webhook data as the initial input to the start node
      const run = await executor.run(workflow, startNode);
      return run;
    } finally {
      this.deps.activeExecutions.remove(hooks.executionId);
    }
  }

  /**
   * Fire-and-forget execution for 'onReceived' response mode.
   */
  private runWorkflowAsync(
    workflow: Workflow,
    startNode: INode,
    webhookInput: Record<string, unknown>,
    hooks: ExecutionLifecycleHooks,
    executionId: string,
  ): void {
    this.runWorkflow(workflow, startNode, webhookInput, hooks).catch((error) => {
      console.error(`Async webhook execution ${executionId} failed:`, error);
    });
  }

  /**
   * Extract the webhook response from the run result based on the response mode.
   */
  private extractResult(
    run: IRun,
    responseMode: WebhookResponseMode,
    executionId: string,
  ): WebhookResult {
    if (run.data.resultData.error) {
      return {
        executionId,
        responseCode: 500,
        responseData: {
          error: run.data.resultData.error.message ?? 'Workflow execution failed',
        },
      };
    }

    if (responseMode === 'lastNode') {
      const lastNodeName = run.data.resultData.lastNodeExecuted;
      if (lastNodeName) {
        const lastNodeRun = run.data.resultData.runData[lastNodeName];
        if (lastNodeRun?.length) {
          const lastRun = lastNodeRun[lastNodeRun.length - 1];
          const outputData = lastRun.data?.main?.[0];
          if (outputData?.length) {
            const firstItem = outputData[0];
            return {
              executionId,
              responseCode: 200,
              responseData: firstItem.json as Record<string, unknown>,
            };
          }
        }
      }
    }

    if (responseMode === 'responseNode') {
      // Look for a "Respond to Webhook" node in the run data
      for (const [nodeName, nodeRuns] of Object.entries(run.data.resultData.runData)) {
        const lastRun = nodeRuns[nodeRuns.length - 1];
        const outputData = lastRun?.data?.main?.[0];
        if (outputData?.length) {
          const firstItem = outputData[0];
          const json = firstItem.json as Record<string, unknown>;
          if (json?.respondToWebhook !== undefined) {
            return {
              executionId,
              responseCode: (json.statusCode as number) ?? 200,
              responseData: json.respondToWebhook as Record<string, unknown>,
              responseHeaders: json.headers as Record<string, string> | undefined,
            };
          }
        }
      }
    }

    // Default: return success with executionId
    return { executionId };
  }
}
