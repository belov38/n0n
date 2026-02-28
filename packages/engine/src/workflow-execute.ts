import type {
  Workflow,
  IRunExecutionData,
  INodeExecutionData,
  ITaskData,
  IExecuteData,
  WorkflowExecuteMode,
  INode,
  IPinData,
  ITaskDataConnections,
  IDataObject,
  ExecutionStatus,
  IConnection,
  IRun,
  INodeType,
  IPairedItemData,
  ExecutionBaseError,
} from 'n8n-workflow';
import {
  NodeConnectionTypes,
  NodeHelpers,
  createRunExecutionData,
} from 'n8n-workflow';
import type { ExecutionLifecycleHooks } from './execution-lifecycle-hooks';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WorkflowExecuteOptions {
  mode: WorkflowExecuteMode;
  startNode?: string;
  destinationNode?: string;
  pinData?: IPinData;
}

interface RunNodeResponse {
  data: INodeExecutionData[][] | null | undefined;
  closeFunction?: () => Promise<void>;
}

/** Minimal additional data the engine threads through to the NodeExecutor. */
export interface EngineAdditionalData {
  executionId?: string;
  executionTimeoutTimestamp?: number;
}

/**
 * Callback injected by infrastructure to execute a single node.
 * The engine calls this instead of creating execution contexts directly.
 * This keeps the engine decoupled from node execution context implementation.
 */
export type NodeExecutor = (params: {
  workflow: Workflow;
  node: INode;
  nodeType: INodeType;
  mode: WorkflowExecuteMode;
  runExecutionData: IRunExecutionData;
  runIndex: number;
  connectionInputData: INodeExecutionData[];
  inputData: ITaskDataConnections;
  executionData: IExecuteData;
  additionalData: EngineAdditionalData;
  abortSignal: AbortSignal;
}) => Promise<RunNodeResponse>;

// ─── WorkflowExecute ────────────────────────────────────────────────────────

export class WorkflowExecute {
  private status: ExecutionStatus = 'new';
  private readonly abortController = new AbortController();
  private currentNodeExecutionIndex = 0;

  constructor(
    private readonly additionalData: EngineAdditionalData,
    private readonly mode: WorkflowExecuteMode,
    private readonly nodeExecutor: NodeExecutor,
    private runExecutionData: IRunExecutionData = createRunExecutionData(),
    private readonly hooks?: ExecutionLifecycleHooks,
  ) {}

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Start a fresh workflow execution from a given start node.
   */
  async run(
    workflow: Workflow,
    startNode?: INode,
    destinationNode?: string,
    pinData?: IPinData,
  ): Promise<IRun> {
    this.status = 'running';

    const start = startNode ?? workflow.getStartNode(destinationNode);
    if (!start) {
      throw new Error('No node to start the workflow from could be found');
    }

    let runNodeFilter: string[] | undefined;
    if (destinationNode) {
      runNodeFilter = workflow.getParentNodes(destinationNode);
      runNodeFilter.push(destinationNode);
      runNodeFilter = [...new Set(runNodeFilter)];
    }

    this.runExecutionData = createRunExecutionData({
      startData: {
        destinationNode: destinationNode
          ? { nodeName: destinationNode, mode: 'inclusive' }
          : undefined,
        runNodeFilter,
      },
      resultData: { pinData },
      executionData: {
        nodeExecutionStack: [
          {
            node: start,
            data: { main: [[{ json: {} }]] },
            source: null,
          },
        ],
      },
    });

    return this.processRunExecutionData(workflow);
  }

  /**
   * Resume execution from existing run execution data (e.g. after waiting).
   */
  async runFrom(workflow: Workflow): Promise<IRun> {
    this.status = 'running';
    return this.processRunExecutionData(workflow);
  }

  cancel(): void {
    this.status = 'canceled';
    this.abortController.abort();
  }

  getStatus(): ExecutionStatus {
    return this.status;
  }

  // ─── Main Execution Loop ─────────────────────────────────────────────────

  private async processRunExecutionData(workflow: Workflow): Promise<IRun> {
    const startedAt = new Date();
    const executionData = this.runExecutionData.executionData;
    if (!executionData) {
      throw new Error('Execution data is missing');
    }

    await this.hooks?.executeHook('workflowExecuteBefore', [
      workflow.id,
      this.mode,
    ]);

    let executionError: ExecutionBaseError | undefined;
    let closeFunction: (() => Promise<void>) | undefined;

    try {
      while (executionData.nodeExecutionStack.length > 0) {
        if (this.isCancelled) {
          break;
        }

        let nodeSuccessData: INodeExecutionData[][] | null | undefined = null;
        executionError = undefined;

        const currentExecution = executionData.nodeExecutionStack.shift()!;
        const executionNode = currentExecution.node;

        const startTime = Date.now();
        const executionIndex = this.currentNodeExecutionIndex++;

        // Update pairedItem info on input data
        currentExecution.data = this.assignInputPairedItems(
          currentExecution.data,
        );

        // Determine run index for this node
        let runIndex = 0;
        if (currentExecution.runIndex !== undefined) {
          runIndex = currentExecution.runIndex;
        } else if (this.runExecutionData.resultData.runData[executionNode.name]) {
          runIndex =
            this.runExecutionData.resultData.runData[executionNode.name].length;
        }

        // Skip nodes not in the run filter
        if (
          this.runExecutionData.startData?.runNodeFilter &&
          !this.runExecutionData.startData.runNodeFilter.includes(
            executionNode.name,
          )
        ) {
          continue;
        }

        await this.hooks?.executeHook('nodeExecuteBefore', [executionNode.name]);

        // Retry logic
        let maxTries = 1;
        let waitBetweenTries = 0;
        if (executionNode.retryOnFail === true) {
          maxTries = Math.min(5, Math.max(2, executionNode.maxTries ?? 3));
          waitBetweenTries = Math.min(
            5000,
            Math.max(0, executionNode.waitBetweenTries ?? 1000),
          );
        }

        for (let tryIndex = 0; tryIndex < maxTries; tryIndex++) {
          try {
            if (tryIndex !== 0 && waitBetweenTries > 0) {
              await sleep(waitBetweenTries);
            }

            // Check pinned data first
            const pinData = this.runExecutionData.resultData.pinData;
            if (
              pinData &&
              !executionNode.disabled &&
              pinData[executionNode.name] !== undefined
            ) {
              nodeSuccessData = [pinData[executionNode.name]];
            } else {
              const runResult = await this.runNode(
                workflow,
                currentExecution,
                this.runExecutionData,
                runIndex,
              );

              nodeSuccessData = runResult.data;
              if (runResult.closeFunction) {
                closeFunction = runResult.closeFunction;
              }

              // Handle continueErrorOutput: route error items to error output
              if (
                nodeSuccessData &&
                executionNode.onError === 'continueErrorOutput'
              ) {
                this.handleNodeErrorOutput(
                  workflow,
                  currentExecution,
                  nodeSuccessData,
                );
              }
            }

            // Auto-fix pairedItem data on output
            nodeSuccessData = this.assignPairedItems(
              nodeSuccessData,
              currentExecution,
            );

            if (nodeSuccessData) {
              this.runExecutionData.resultData.lastNodeExecuted =
                executionNode.name;
            }

            // Handle alwaysOutputData
            if (!nodeSuccessData?.[0]?.[0]) {
              if (executionNode.alwaysOutputData === true) {
                const pairedItem: IPairedItemData[] = [];
                currentExecution.data.main.forEach(
                  (inputData, inputIndex) => {
                    if (!inputData) return;
                    inputData.forEach((_item, itemIndex) => {
                      pairedItem.push({ item: itemIndex, input: inputIndex });
                    });
                  },
                );
                nodeSuccessData ??= [];
                nodeSuccessData[0] = [{ json: {}, pairedItem }];
              }
            }

            // null means node succeeded but produced no data; end this branch
            if (nodeSuccessData === null && !this.runExecutionData.waitTill) {
              break;
            }

            // Success: exit retry loop
            break;
          } catch (error) {
            this.runExecutionData.resultData.lastNodeExecuted =
              executionNode.name;
            const e = error as ExecutionBaseError;
            executionError = { ...e, message: e.message, stack: e.stack };
          }
        }

        // Record task data
        if (!this.runExecutionData.resultData.runData[executionNode.name]) {
          this.runExecutionData.resultData.runData[executionNode.name] = [];
        }

        const taskData: ITaskData = {
          startTime,
          executionIndex,
          executionTime: Date.now() - startTime,
          executionStatus: this.runExecutionData.waitTill
            ? 'waiting'
            : 'success',
          source: !currentExecution.source
            ? []
            : currentExecution.source.main,
        };

        if (executionError !== undefined) {
          taskData.error = executionError;
          taskData.executionStatus = 'error';

          if (
            executionNode.continueOnFail === true ||
            ['continueRegularOutput', 'continueErrorOutput'].includes(
              executionNode.onError ?? '',
            )
          ) {
            // Continue execution: pass input data through as output
            if (currentExecution.data.main?.[0] !== null) {
              nodeSuccessData = currentExecution.data.main[0]
                ? [currentExecution.data.main[0]]
                : null;
            }
          } else {
            // Fatal error: stop execution
            this.runExecutionData.resultData.runData[executionNode.name].push(
              taskData,
            );
            executionData.nodeExecutionStack.unshift(currentExecution);

            if (!this.isCancelled) {
              await this.hooks?.executeHook('nodeExecuteAfter', [
                executionNode.name,
                taskData,
                this.runExecutionData,
              ]);
            }
            break;
          }
        }

        // Merge $error/$json metadata into output items
        if (nodeSuccessData) {
          for (const outputItems of nodeSuccessData) {
            for (const item of outputItems) {
              if (
                item.json?.$error !== undefined &&
                item.json?.$json !== undefined
              ) {
                // Node reported error in standard format
                const errorObj = item.json.$error as { message?: string };
                item.json = { error: errorObj.message ?? 'Unknown error' };
              } else if (item.error !== undefined) {
                item.json = { error: item.error.message };
              }
            }
          }
        }

        // Store result
        taskData.data = { main: nodeSuccessData } as ITaskDataConnections;
        this.runExecutionData.resultData.runData[executionNode.name].push(
          taskData,
        );

        // Handle waitTill (Wait node pausing execution)
        if (this.runExecutionData.waitTill) {
          await this.hooks?.executeHook('nodeExecuteAfter', [
            executionNode.name,
            taskData,
            this.runExecutionData,
          ]);
          executionData.nodeExecutionStack.unshift(currentExecution);
          break;
        }

        // Stop at destination node if specified
        if (
          this.runExecutionData.startData?.destinationNode?.nodeName ===
          executionNode.name
        ) {
          await this.hooks?.executeHook('nodeExecuteAfter', [
            executionNode.name,
            taskData,
            this.runExecutionData,
          ]);
          continue;
        }

        // Enqueue downstream nodes
        if (
          nodeSuccessData &&
          workflow.connectionsBySourceNode[executionNode.name]?.main
        ) {
          const mainConnections =
            workflow.connectionsBySourceNode[executionNode.name].main;

          for (
            let outputIndex = 0;
            outputIndex < mainConnections.length;
            outputIndex++
          ) {
            for (const connectionData of mainConnections[outputIndex] ?? []) {
              if (!workflow.nodes[connectionData.node]) {
                throw new Error(
                  `Destination node "${connectionData.node}" not found from source "${executionNode.name}"`,
                );
              }

              if (
                nodeSuccessData[outputIndex] &&
                nodeSuccessData[outputIndex].length > 0
              ) {
                this.addNodeToBeExecuted(
                  workflow,
                  connectionData,
                  outputIndex,
                  executionNode.name,
                  nodeSuccessData,
                  runIndex,
                );
              }
            }
          }
        }

        await this.hooks?.executeHook('nodeExecuteAfter', [
          executionNode.name,
          taskData,
          this.runExecutionData,
        ]);

        // When stack is empty, check for waiting multi-input nodes
        if (executionData.nodeExecutionStack.length === 0) {
          this.flushWaitingNodes(workflow);
        }
      }
    } catch (error) {
      const e = error as ExecutionBaseError;
      executionError = { ...e, message: e.message, stack: e.stack };
    }

    return this.buildRunResult(startedAt, workflow, executionError, closeFunction);
  }

  // ─── Run Result Construction ─────────────────────────────────────────────

  private async buildRunResult(
    startedAt: Date,
    workflow: Workflow,
    executionError: ExecutionBaseError | undefined,
    closeFunction: (() => Promise<void>) | undefined,
  ): Promise<IRun> {
    const stoppedAt = new Date();

    if (executionError) {
      this.status = 'error';
    } else if (this.runExecutionData.waitTill) {
      this.status = 'waiting';
    } else if (this.status !== 'canceled') {
      this.status = 'success';
    }

    const fullRunData: IRun = {
      data: this.runExecutionData,
      mode: this.mode,
      startedAt,
      stoppedAt,
      status: this.status,
    };

    if (executionError) {
      fullRunData.data.resultData.error = executionError;
    } else if (this.runExecutionData.waitTill) {
      fullRunData.waitTill = this.runExecutionData.waitTill;
    } else {
      fullRunData.finished = true;
    }

    // Static data changes
    if (
      workflow.staticData &&
      (workflow.staticData as IDataObject & { __dataChanged?: boolean })
        .__dataChanged === true
    ) {
      // TODO: pass newStaticData to hooks when we add that capability
    }

    // Clean up trigger close function
    if (closeFunction) {
      try {
        await closeFunction();
      } catch {
        // Trigger cleanup errors are non-fatal
      }
    }

    if (!this.isCancelled) {
      await this.hooks?.executeHook('workflowExecuteAfter', [
        this.runExecutionData,
        this.hooks.executionId,
        this.status,
      ]);
    }

    return fullRunData;
  }

  // ─── Node Execution ──────────────────────────────────────────────────────

  /**
   * Execute a single node based on its type (disabled, execute, poll, trigger, webhook).
   */
  private async runNode(
    workflow: Workflow,
    executionData: IExecuteData,
    runExecutionData: IRunExecutionData,
    runIndex: number,
  ): Promise<RunNodeResponse> {
    const { node } = executionData;
    const inputData = executionData.data;

    // Disabled nodes pass data through
    if (node.disabled === true) {
      return this.handleDisabledNode(inputData);
    }

    const nodeType = workflow.nodeTypes.getByNameAndVersion(
      node.type,
      node.typeVersion,
    );

    // Determine connection input data (first non-empty main input)
    const connectionInputData = this.getConnectionInputData(
      nodeType,
      inputData,
    );
    if (connectionInputData === null) {
      return { data: undefined };
    }

    // Handle executeOnce: limit to first input item
    const finalInputData = node.executeOnce
      ? this.limitToFirstItem(inputData)
      : inputData;

    // Delegate to injected node executor for execute/poll/trigger nodes.
    // The executor creates the appropriate context (ExecuteContext, PollContext, etc.)
    // and calls the node type's execute/poll/trigger method.
    if (nodeType.execute || nodeType.poll || nodeType.trigger) {
      return this.nodeExecutor({
        workflow,
        node,
        nodeType,
        mode: this.mode,
        runExecutionData,
        runIndex,
        connectionInputData,
        inputData: finalInputData,
        executionData,
        additionalData: this.additionalData,
        abortSignal: this.abortController.signal,
      });
    }

    // Webhook nodes: pass data through (webhook handler already ran)
    if (nodeType.webhook) {
      return { data: inputData.main as INodeExecutionData[][] };
    }

    throw new Error(
      `Node type "${node.type}" has no execute, poll, trigger, or webhook method`,
    );
  }

  private handleDisabledNode(
    inputData: ITaskDataConnections,
  ): RunNodeResponse {
    if (inputData.main?.length > 0 && inputData.main[0] !== null) {
      return { data: [inputData.main[0]] };
    }
    return { data: undefined };
  }

  private getConnectionInputData(
    nodeType: INodeType,
    inputData: ITaskDataConnections,
  ): INodeExecutionData[] | null {
    if (
      nodeType.execute ||
      (!nodeType.poll && !nodeType.trigger && !nodeType.webhook)
    ) {
      if (!inputData.main?.length) return null;

      const connectionInputData = inputData.main[0];
      if (!connectionInputData || connectionInputData.length === 0) {
        return null;
      }
      return connectionInputData;
    }

    // Poll, trigger, webhook nodes don't need processed input
    return [];
  }

  private limitToFirstItem(
    inputData: ITaskDataConnections,
  ): ITaskDataConnections {
    const result: ITaskDataConnections = {};
    for (const connectionType of Object.keys(inputData)) {
      result[connectionType] = inputData[connectionType].map((input) =>
        input ? input.slice(0, 1) : input,
      );
    }
    return result;
  }

  // ─── Multi-Input Node Scheduling ─────────────────────────────────────────

  /**
   * Determines whether a downstream node should be added to the execution stack
   * immediately or placed in the waiting queue (for multi-input nodes like Merge).
   */
  private addNodeToBeExecuted(
    workflow: Workflow,
    connectionData: IConnection,
    outputIndex: number,
    parentNodeName: string,
    nodeSuccessData: INodeExecutionData[][],
    runIndex: number,
  ): void {
    const execData = this.runExecutionData.executionData!;

    // Check number of inputs to determine if this is a multi-input node
    const numberOfInputs =
      workflow.connectionsByDestinationNode[connectionData.node]?.main
        ?.length ?? 0;

    if (numberOfInputs > 1) {
      this.addMultiInputNodeToWaiting(
        workflow,
        connectionData,
        outputIndex,
        parentNodeName,
        nodeSuccessData,
        runIndex,
      );
      return;
    }

    // Single input node: add directly to the stack
    const connectionDataArray: Array<INodeExecutionData[] | null> = [];
    for (let i = connectionData.index; i >= 0; i--) {
      connectionDataArray[i] = null;
    }
    connectionDataArray[connectionData.index] =
      nodeSuccessData[outputIndex] ?? null;

    execData.nodeExecutionStack.unshift({
      node: workflow.nodes[connectionData.node],
      data: { main: connectionDataArray },
      source: {
        main: [
          {
            previousNode: parentNodeName,
            previousNodeOutput: outputIndex,
            previousNodeRun: runIndex,
          },
        ],
      },
    });
  }

  /**
   * Handle multi-input nodes: store data in waitingExecution until all inputs are ready.
   */
  private addMultiInputNodeToWaiting(
    workflow: Workflow,
    connectionData: IConnection,
    outputIndex: number,
    parentNodeName: string,
    nodeSuccessData: INodeExecutionData[][],
    runIndex: number,
  ): void {
    const execData = this.runExecutionData.executionData!;
    execData.waitingExecution ??= {};
    execData.waitingExecutionSource ??= {};

    const nodeName = connectionData.node;
    const numberOfInputs =
      workflow.connectionsByDestinationNode[nodeName].main.length;

    // Find or create waiting entry
    if (!execData.waitingExecution[nodeName]) {
      execData.waitingExecution[nodeName] = {};
      execData.waitingExecutionSource![nodeName] = {};
    }

    // Find a waiting entry that doesn't already have data for this input
    let waitingIndex: number | undefined;
    for (const idx of Object.keys(execData.waitingExecution[nodeName])) {
      const numIdx = parseInt(idx);
      if (
        !execData.waitingExecution[nodeName][numIdx].main[connectionData.index]
      ) {
        waitingIndex = numIdx;
        break;
      }
    }

    if (waitingIndex === undefined) {
      waitingIndex = Object.keys(execData.waitingExecution[nodeName]).length;
    }

    // Initialize empty slots if needed
    if (!execData.waitingExecution[nodeName][waitingIndex]) {
      this.initWaitingSlots(nodeName, numberOfInputs, waitingIndex);
    }

    // Store the data for this input
    execData.waitingExecution[nodeName][waitingIndex].main[
      connectionData.index
    ] = nodeSuccessData[outputIndex] ?? null;

    execData.waitingExecutionSource![nodeName][waitingIndex].main[
      connectionData.index
    ] = {
      previousNode: parentNodeName,
      previousNodeOutput: outputIndex,
      previousNodeRun: runIndex,
    };

    // Check if all inputs have data
    const waitingData =
      execData.waitingExecution[nodeName][waitingIndex].main;
    const allDataReady = waitingData.every((data) => data !== null);

    if (allDataReady) {
      // All inputs have data: move to execution stack
      execData.nodeExecutionStack.unshift({
        node: workflow.nodes[nodeName],
        data: execData.waitingExecution[nodeName][waitingIndex],
        source: execData.waitingExecutionSource![nodeName][waitingIndex],
      } as IExecuteData);

      // Clean up waiting data
      delete execData.waitingExecution[nodeName][waitingIndex];
      delete execData.waitingExecutionSource![nodeName][waitingIndex];

      if (Object.keys(execData.waitingExecution[nodeName]).length === 0) {
        delete execData.waitingExecution[nodeName];
        delete execData.waitingExecutionSource![nodeName];
      }
    }
  }

  /**
   * Initialize empty slots in the waiting execution data for a multi-input node.
   */
  private initWaitingSlots(
    nodeName: string,
    numberOfInputs: number,
    waitingIndex: number,
  ): void {
    const execData = this.runExecutionData.executionData!;

    execData.waitingExecution[nodeName][waitingIndex] = { main: [] };
    execData.waitingExecutionSource![nodeName][waitingIndex] = { main: [] };

    for (let i = 0; i < numberOfInputs; i++) {
      execData.waitingExecution[nodeName][waitingIndex].main.push(null);
      execData.waitingExecutionSource![nodeName][waitingIndex].main.push(null);
    }
  }

  /**
   * When the execution stack is empty, check for multi-input nodes that can
   * execute with partial data (nodes without requiredInputs).
   */
  private flushWaitingNodes(workflow: Workflow): void {
    const execData = this.runExecutionData.executionData!;
    let waitingNodes = Object.keys(execData.waitingExecution);
    if (waitingNodes.length === 0) return;

    for (let i = 0; i < waitingNodes.length; i++) {
      const nodeName = waitingNodes[i];
      const checkNode = workflow.getNode(nodeName);
      if (!checkNode) continue;

      const nodeType = workflow.nodeTypes.getByNameAndVersion(
        checkNode.type,
        checkNode.typeVersion,
      );

      // Check requiredInputs: if all inputs are required, skip
      const requiredInputs = nodeType.description.requiredInputs;
      if (
        requiredInputs !== undefined &&
        requiredInputs === nodeType.description.inputs.length
      ) {
        continue;
      }

      // Check if any parent is also waiting (dependency ordering)
      const parentNodes = workflow.getParentNodes(nodeName);
      if (parentNodes.some((p) => waitingNodes.includes(p))) {
        continue;
      }

      const runIndexes = Object.keys(
        execData.waitingExecution[nodeName],
      ).sort();
      if (runIndexes.length === 0) continue;
      const firstRunIndex = parseInt(runIndexes[0]);

      const taskDataMain = execData.waitingExecution[nodeName][
        firstRunIndex
      ].main.map((data) => (data === null ? [] : data));

      if (taskDataMain.some((data) => data.length > 0)) {
        // Pad inputs to match expected count
        while (taskDataMain.length < nodeType.description.inputs.length) {
          taskDataMain.push([]);
        }

        execData.nodeExecutionStack.push({
          node: workflow.nodes[nodeName],
          data: { main: taskDataMain },
          source: execData.waitingExecutionSource![nodeName][firstRunIndex],
        });
      }

      // Clean up
      delete execData.waitingExecution[nodeName][firstRunIndex];
      delete execData.waitingExecutionSource![nodeName][firstRunIndex];

      if (Object.keys(execData.waitingExecution[nodeName]).length === 0) {
        delete execData.waitingExecution[nodeName];
        delete execData.waitingExecutionSource![nodeName];
      }

      if (taskDataMain.some((data) => data.length > 0)) {
        break; // Found a node to execute
      }

      // No data found, refresh waiting list and search again
      waitingNodes = Object.keys(execData.waitingExecution);
      i = -1;
    }
  }

  // ─── Error Output Handling ───────────────────────────────────────────────

  /**
   * For nodes with onError='continueErrorOutput': route error items to the
   * last (error) output and success items to regular outputs.
   */
  private handleNodeErrorOutput(
    workflow: Workflow,
    executionData: IExecuteData,
    nodeSuccessData: INodeExecutionData[][],
  ): void {
    const nodeType = workflow.nodeTypes.getByNameAndVersion(
      executionData.node.type,
      executionData.node.typeVersion,
    );

    const outputs = NodeHelpers.getNodeOutputs(
      workflow,
      executionData.node,
      nodeType.description,
    );
    const outputTypes = NodeHelpers.getConnectionTypes(outputs);
    const mainOutputCount = outputTypes.filter(
      (o) => o === NodeConnectionTypes.Main,
    ).length;

    if (mainOutputCount < 2) return;

    const errorItems: INodeExecutionData[] = [];
    const errorOutputIndex = mainOutputCount - 1;

    for (
      let outputIndex = 0;
      outputIndex < mainOutputCount - 1;
      outputIndex++
    ) {
      const items = nodeSuccessData[outputIndex] ?? [];
      const successItems: INodeExecutionData[] = [];

      for (const item of items) {
        const hasError =
          item.error ||
          (item.json?.error && Object.keys(item.json).length <= 2);
        if (hasError) {
          errorItems.push(item);
        } else {
          successItems.push(item);
        }
      }

      nodeSuccessData[outputIndex] = successItems;
    }

    nodeSuccessData[errorOutputIndex] = errorItems;
  }

  // ─── Paired Item Management ──────────────────────────────────────────────

  /**
   * Add pairedItem metadata to input data so nodes can track item lineage.
   */
  private assignInputPairedItems(
    data: ITaskDataConnections,
  ): ITaskDataConnections {
    const result: ITaskDataConnections = {};
    for (const connectionType of Object.keys(data)) {
      result[connectionType] = data[connectionType].map(
        (input, inputIndex) => {
          if (input === null) return input;
          return input.map((item, itemIndex) => ({
            ...item,
            pairedItem: {
              item: itemIndex,
              input: inputIndex || undefined,
            },
          }));
        },
      );
    }
    return result;
  }

  /**
   * Auto-fix missing pairedItem data on node output when possible.
   */
  private assignPairedItems(
    nodeSuccessData: INodeExecutionData[][] | null | undefined,
    executionData: IExecuteData,
  ): INodeExecutionData[][] | null | undefined {
    if (!nodeSuccessData?.length) return nodeSuccessData;

    const isSingleInputAndOutput =
      executionData.data.main.length === 1 &&
      executionData.data.main[0]?.length === 1;

    const isSameNumberOfItems =
      nodeSuccessData.length === 1 &&
      executionData.data.main.length === 1 &&
      executionData.data.main[0]?.length === nodeSuccessData[0].length;

    const isSingleOutput =
      nodeSuccessData.length === 1 &&
      nodeSuccessData[0]?.length === 1 &&
      executionData.data.main.length === 1 &&
      (executionData.data.main[0]?.length ?? 0) > 1;

    for (const outputData of nodeSuccessData) {
      if (outputData === null) continue;
      for (const [index, item] of outputData.entries()) {
        if (item.pairedItem === undefined) {
          if (isSingleInputAndOutput) {
            item.pairedItem = { item: 0 };
          } else if (isSameNumberOfItems) {
            item.pairedItem = { item: index };
          } else if (isSingleOutput) {
            item.pairedItem = { item: 0 };
          } else {
            // Cannot auto-fix
            return nodeSuccessData;
          }
        }
      }
    }

    return nodeSuccessData;
  }

  // ─── Utilities ───────────────────────────────────────────────────────────

  private get isCancelled(): boolean {
    return this.abortController.signal.aborted;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
