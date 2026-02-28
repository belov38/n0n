import type { ExecutionRepo, ExecutionDataRepo } from '@n0n/db';
import type { Execution } from '@n0n/db';
import { WorkflowExecute } from '@n0n/engine';
import type { NodeExecutor, ExecutionLifecycleHooks } from '@n0n/engine';
import type {
  INode,
  INodeTypes,
  IDataObject,
  IRunExecutionData,
  WorkflowExecuteMode,
  IRun,
} from 'n8n-workflow';
import { Workflow } from 'n8n-workflow';
import type { EngineAdditionalData } from '@n0n/engine';
import type { PushService } from '../push/push.service';
import type { ActiveExecutions } from '../services/active-executions';

export interface WaitingWebhookDeps {
  executionRepo: ExecutionRepo;
  executionDataRepo: ExecutionDataRepo;
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

interface ExecutionWithData {
  execution: Execution;
  runData: IRunExecutionData;
  workflowData: {
    id: string;
    name: string;
    nodes: INode[];
    connections: Record<string, unknown>;
    settings?: Record<string, unknown>;
    staticData?: Record<string, unknown>;
  };
}

/**
 * Handles webhook requests that resume a paused (waiting) execution.
 *
 * When a Wait node pauses an execution, the execution enters 'waiting' status
 * and records a waitTill timestamp. When the corresponding webhook is called
 * (or the wait time expires via WaitTracker), this service resumes the execution
 * from where it left off.
 */
export class WaitingWebhooks {
  constructor(private deps: WaitingWebhookDeps) {}

  /**
   * Handle an incoming request to resume a waiting execution.
   * The path parameter is the execution ID (set by the router).
   */
  async handleRequest(
    executionId: string,
    request: Request,
  ): Promise<Response> {
    // Load and validate the execution
    const executionWithData = await this.loadExecution(executionId);
    const { execution, runData, workflowData } = executionWithData;

    // Build the workflow from stored data
    const workflow = this.createWorkflow(workflowData);

    // Find the node that initiated the wait
    const lastNodeName = runData.resultData.lastNodeExecuted;
    if (!lastNodeName) {
      return this.errorResponse(500, 'Cannot determine last executed node');
    }

    const resumeNode = workflow.getNode(lastNodeName);
    if (!resumeNode) {
      return this.errorResponse(404, `Node "${lastNodeName}" not found in workflow`);
    }

    // Parse incoming request data to inject as webhook data
    const body = await this.parseRequestBody(request);
    const webhookInput = this.buildWebhookInput(request, body);

    // Prepare run execution data for resumption:
    // - Clear waitTill so execution continues
    // - Disable the waiting node so it doesn't wait again
    // - Pop the last run data entry so the node re-executes
    runData.waitTill = undefined;

    const nodeStack = runData.executionData?.nodeExecutionStack;
    if (nodeStack?.[0]) {
      nodeStack[0].node.disabled = true;
    }

    // Pop the last run data for the waiting node to prevent double execution
    const lastNodeRunData = runData.resultData.runData[lastNodeName];
    if (lastNodeRunData?.length) {
      lastNodeRunData.pop();
    }

    // Create lifecycle hooks
    const hooks = this.deps.createHooks(
      executionId,
      workflowData.id,
      execution.mode as WorkflowExecuteMode,
    );

    // Resume execution
    const executor = new WorkflowExecute(
      this.deps.additionalData,
      execution.mode as WorkflowExecuteMode,
      this.deps.nodeExecutor,
      runData,
      hooks,
    );

    // Track in active executions
    this.deps.activeExecutions.add({
      id: executionId,
      workflowId: workflowData.id,
      mode: execution.mode as WorkflowExecuteMode,
      startedAt: new Date(),
      status: 'running',
      cancel: () => executor.cancel(),
    });

    try {
      const run = await executor.runFrom(workflow);
      return this.buildSuccessResponse(run, executionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Execution resumption failed';
      return this.errorResponse(500, message);
    } finally {
      this.deps.activeExecutions.remove(executionId);
    }
  }

  /**
   * Load an execution and validate it can be resumed.
   */
  private async loadExecution(executionId: string): Promise<ExecutionWithData> {
    const numericId = Number(executionId);
    if (Number.isNaN(numericId)) {
      throw new WaitingWebhookError(400, `Invalid execution ID: "${executionId}"`);
    }

    const execution = await this.deps.executionRepo.findById(numericId);
    if (!execution) {
      throw new WaitingWebhookError(404, `Execution "${executionId}" not found`);
    }

    // Validate execution state
    if (execution.status === 'running') {
      throw new WaitingWebhookError(409, `Execution "${executionId}" is already running`);
    }

    if (execution.finished) {
      throw new WaitingWebhookError(409, `Execution "${executionId}" has already finished`);
    }

    if (execution.status !== 'waiting') {
      throw new WaitingWebhookError(
        409,
        `Execution "${executionId}" is in "${execution.status}" status, expected "waiting"`,
      );
    }

    // Load execution data
    const executionData = await this.deps.executionDataRepo.findByExecutionId(numericId);
    if (!executionData) {
      throw new WaitingWebhookError(404, `Execution data for "${executionId}" not found`);
    }

    let runData: IRunExecutionData;
    try {
      runData = JSON.parse(executionData.data) as IRunExecutionData;
    } catch {
      throw new WaitingWebhookError(500, `Failed to parse execution data for "${executionId}"`);
    }

    if (runData.resultData?.error) {
      throw new WaitingWebhookError(
        409,
        `Execution "${executionId}" finished with an error`,
      );
    }

    const workflowData = executionData.workflowData as ExecutionWithData['workflowData'];
    if (!workflowData) {
      throw new WaitingWebhookError(500, `No workflow data stored for execution "${executionId}"`);
    }

    return { execution, runData, workflowData };
  }

  private createWorkflow(
    workflowData: ExecutionWithData['workflowData'],
  ): Workflow {
    return new Workflow({
      id: workflowData.id,
      name: workflowData.name,
      nodes: workflowData.nodes,
      connections: workflowData.connections as Workflow['connectionsBySourceNode'],
      active: true,
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

    return {};
  }

  private buildWebhookInput(
    request: Request,
    body: Record<string, unknown>,
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
      query,
      body,
    };
  }

  private buildSuccessResponse(run: IRun, executionId: string): Response {
    if (run.data.resultData.error) {
      return this.jsonResponse(500, {
        error: run.data.resultData.error.message ?? 'Execution failed after resume',
        executionId,
      });
    }

    // Try to return data from the last executed node
    const lastNodeName = run.data.resultData.lastNodeExecuted;
    if (lastNodeName) {
      const lastNodeRun = run.data.resultData.runData[lastNodeName];
      if (lastNodeRun?.length) {
        const lastRun = lastNodeRun[lastNodeRun.length - 1];
        const outputData = lastRun.data?.main?.[0];
        if (outputData?.length) {
          return this.jsonResponse(200, {
            executionId,
            data: outputData[0].json,
          });
        }
      }
    }

    return this.jsonResponse(200, {
      executionId,
      resumed: true,
      status: run.status,
    });
  }

  private jsonResponse(status: number, data: Record<string, unknown>): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  private errorResponse(status: number, message: string): Response {
    return this.jsonResponse(status, { error: message });
  }
}

/**
 * Typed error for waiting webhook validation failures.
 * Carries an HTTP status code for direct response mapping.
 */
export class WaitingWebhookError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'WaitingWebhookError';
  }
}
