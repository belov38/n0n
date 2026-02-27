# n8n Execution Engine — Deep Analysis

## Overview

n8n executes workflows using a stack-based, single-threaded (within one execution) loop. The core engine lives in `packages/core/src/execution-engine/workflow-execute.ts`. Each execution is driven by a `nodeExecutionStack` — an ordered list of `IExecuteData` items. The engine pops one item off the stack per loop iteration, runs the node, then pushes any downstream nodes onto the stack for nodes that have data to deliver.

---

## Execution Flow (Step-by-Step)

### Step 1 — Trigger

Execution begins from one of these entry points depending on context:

**Manual execution (editor UI):**
```
WorkflowExecutionService.runManualWorkflow
  → WorkflowRunner.run (packages/cli/src/workflow-runner.ts:139)
    → runMainProcess (packages/cli/src/workflow-runner.ts:217)
      → ManualExecutionService.runManually (packages/cli/src/manual-execution.service.ts:49)
        → WorkflowExecute.run() or WorkflowExecute.runPartialWorkflow2()
```

**Production trigger (webhook / polling / schedule):**
```
WorkflowExecutionService.runWorkflow
  → WorkflowRunner.run
    → runMainProcess or enqueueExecution (queue mode)
```

**Queue mode worker:**
```
JobProcessor.processJob (packages/cli/src/scaling/job-processor.ts:72)
  → WorkflowExecute.processRunExecutionData(workflow)
```

**Sub-workflow (Execute Workflow node):**
```
executeWorkflow() (packages/cli/src/workflow-execute-additional-data.ts:197)
  → startExecution()
    → WorkflowExecute.processRunExecutionData(workflow)
```

**Wait-node resume (timer expires):**
```
WaitTracker.startExecution (packages/cli/src/wait-tracker.ts:97)
  → WorkflowRunner.run (reuses existing executionData from DB)
```

### Step 2 — Registration

`ActiveExecutions.add()` is called first (`packages/cli/src/active-executions.ts:62`).

- Creates a DB record via `ExecutionPersistence.create()` — `status: 'new'`
- Reserves a concurrency slot via `ConcurrencyControlService`
- Returns `executionId`
- `ExecutionRepository.setRunning(executionId)` is called to flip `status` to `'running'`

### Step 3 — Build Workflow Object

```typescript
// packages/cli/src/workflow-runner.ts:245
const workflow = new Workflow({
  id, name, nodes, connections,
  active, nodeTypes, staticData, settings, pinData,
});
```

`Workflow` is the primary domain object from `packages/workflow`. It pre-computes:
- `workflow.connectionsBySourceNode` — outgoing connections indexed by source node name
- `workflow.connectionsByDestinationNode` — incoming connections indexed by dest node name
- `workflow.nodes` — map of node name → INode

### Step 4 — Build IRunExecutionData

For fresh runs, `WorkflowExecute.run()` is called (`packages/core/src/execution-engine/workflow-execute.ts:123`):

```typescript
const nodeExecutionStack: IExecuteData[] = [{
  node: startNode,
  data: { main: [[{ json: {} }]] },  // initial empty item
  source: null,
}];

this.runExecutionData = createRunExecutionData({
  startData: { destinationNode, runNodeFilter },
  executionData: { nodeExecutionStack },
  resultData: { pinData },
});
```

For partial re-runs, `WorkflowExecute.runPartialWorkflow2()` (`line 197`) computes the subgraph from trigger to destination node, identifies which nodes have stale data (dirty nodes), recreates the stack via `recreateNodeExecutionStack()`, and passes existing `runData` for nodes that don't need re-execution.

### Step 5 — Hooks Setup

`getLifecycleHooksForRegularMain()` is called (`packages/cli/src/execution-lifecycle/execution-lifecycle-hooks.ts:666`), which attaches callbacks for:
- DB save (`workflowExecuteAfter`)
- Push to UI (`nodeExecuteBefore`, `nodeExecuteAfter`, `workflowExecuteBefore`, `workflowExecuteAfter`)
- Progress save per node (optional, if `saveExecutionProgress` enabled)
- Statistics
- External hooks
- Event bus events

Hooks are stored in `additionalData.hooks` and passed to `WorkflowExecute`.

### Step 6 — processRunExecutionData: The Main Loop

`WorkflowExecute.processRunExecutionData(workflow)` is the heart of execution (`packages/core/src/execution-engine/workflow-execute.ts:1409`). It returns a `PCancelable<IRun>`.

Key sequence inside the returned PCancelable:

1. `establishExecutionContext()` — sets up context for credential resolution
2. Fire `workflowExecuteBefore` or `workflowExecuteResume` hook
3. Enter `executionLoop: while (nodeExecutionStack.length !== 0)`:

   a. Shift (pop from front) the next `IExecuteData` from stack
   b. Check timeout and cancellation
   c. Check `runNodeFilter` — skip node if not in allowed set
   d. Call `ensureInputData()` — if inputs not yet available, push back and continue
   e. Fire `nodeExecuteBefore` hook (push `nodeExecuteBefore` WS message to UI)
   f. Configure retry: `maxTries = node.retryOnFail ? min(5, max(2, node.maxTries)) : 1`
   g. For each try in retry loop:
      - Check for pinned data — if pinned, use it directly, skip execution
      - Call `this.runNode(workflow, executionData, ...)` → dispatches to right node type
      - Handle `EngineRequest` (AI sub-node requests) — push sub-nodes to stack, continue loop
      - Convert binary data
      - If node returned error output (`continueErrorOutput`), route to error branch
   h. Build `ITaskData` with `executionTime`, `executionStatus`, `data`
   i. If error and `continueOnFail=false`: push node back to stack, fire `nodeExecuteAfter`, break loop
   j. If no error: write `taskData` to `resultData.runData[nodeName]`
   k. If `waitTill` was set by node: break loop (execution enters waiting state)
   l. If destination node reached: fire `nodeExecuteAfter`, continue (skip downstream)
   m. Otherwise: iterate `connectionsBySourceNode[executionNode.name].main` — for each outgoing connection add downstream nodes via `addNodeToBeExecuted()`
   n. Fire `nodeExecuteAfter` hook

4. After loop: call `processSuccessExecution()` → sets final status, fires `workflowExecuteAfter`

### Step 7 — Node Dispatch in runNode()

`WorkflowExecute.runNode()` at line 1186 decides execution strategy:

| Node type | Method called |
|---|---|
| `node.disabled = true` | `handleDisabledNode()` — pass-through first input |
| `nodeType.execute` or `customOperation` | `executeNode()` — standard execute path |
| `nodeType.poll` | `executePollNode()` |
| `nodeType.trigger` (manual mode) | `executeTriggerNode()` → `TriggersAndPollers.runTrigger()` |
| `nodeType.trigger` (production) | Pass-through input data (trigger already fired) |
| Declarative node (test only) | `executeDeclarativeNodeInTest()` → `RoutingNode.runNode()` |
| Webhook (non-declarative) | Pass-through input data |

`executeNode()` (line 1004) creates an `ExecuteContext` (the `this` context nodes use) and calls `nodeType.execute(context)` or `customOperation.call(context)`.

### Step 8 — Completion

After the loop exits, `processSuccessExecution()` at line 2377:
- Sets `status`: `'success'`, `'error'`, `'waiting'`, or `'canceled'`
- Calls `moveNodeMetadata()` to move per-node metadata into final location
- Calls `workflowExecuteAfter` hook (saves to DB, pushes to UI, fires external hooks)
- Returns `IRun` object

---

## Data Envelope

### INodeExecutionData — the item

Every piece of data flowing between nodes is an `INodeExecutionData`:

```typescript
// packages/workflow/src/interfaces.ts:1370
interface INodeExecutionData {
  json: IDataObject;           // the primary key-value payload
  binary?: IBinaryKeyData;     // binary attachments, keyed by field name
  error?: NodeApiError | NodeOperationError;
  pairedItem?: IPairedItemData | IPairedItemData[] | number;
  metadata?: { subExecution: RelatedExecution };
  evaluationData?: Record<string, GenericValue>;
  sendMessage?: ChatNodeMessage;
}
```

### ITaskDataConnections — one node's input/output frame

```typescript
// packages/workflow/src/interfaces.ts:2704
interface ITaskDataConnections {
  // key = connection type (e.g. 'main', 'ai_tool', 'ai_memory')
  // value = array-of-arrays: [inputIndex][itemIndex]
  [key: string]: Array<INodeExecutionData[] | null>;
}
```

`main[0]` is the first input port. `main[1]` is the second input port (for Merge nodes). `null` means data not yet received.

### IExecuteData — one stack entry

```typescript
// packages/workflow/src/interfaces.ts:449
interface IExecuteData {
  node: INode;
  data: ITaskDataConnections;      // input data for this node
  source: ITaskDataConnectionsSource | null;  // which previous node/output provided data
  runIndex?: number;               // which run this is (for nodes called multiple times)
  metadata?: ITaskMetadata;
}
```

### IRunExecutionData — the full execution state

```typescript
// packages/workflow/src/run-execution-data/run-execution-data.v1.ts:19
interface IRunExecutionDataV1 {
  version: 1;
  startData?: {
    destinationNode?: IDestinationNode;
    runNodeFilter?: string[];       // which nodes are allowed to run
    startNodes?: StartNodeData[];
  };
  resultData: {
    runData: IRunData;              // completed node outputs: { nodeName: ITaskData[] }
    pinData?: IPinData;             // pinned test data
    lastNodeExecuted?: string;
    error?: ExecutionError;
  };
  executionData?: {
    nodeExecutionStack: IExecuteData[];        // nodes waiting to run
    waitingExecution: IWaitingForExecution;    // nodes waiting for all inputs
    waitingExecutionSource: IWaitingForExecutionSource | null;
    contextData: IExecuteContextData;
    metadata: { [nodeName: string]: ITaskMetadata[] };
  };
  parentExecution?: RelatedExecution;
  waitTill?: Date;                  // when execution should resume (Wait node)
  pushRef?: string;                 // which browser tab is watching
}
```

### ITaskData — one node's completed run record

```typescript
// packages/workflow/src/interfaces.ts:2683
interface ITaskData extends ITaskStartedData {
  executionTime: number;            // ms
  executionStatus?: ExecutionStatus;
  data?: ITaskDataConnections;      // output data
  inputOverride?: ITaskDataConnections;
  error?: ExecutionError;
  metadata?: ITaskMetadata;
}
```

---

## State Machine Diagram

```
                          ┌─────────────┐
                          │     new     │  (DB record created)
                          └──────┬──────┘
                                 │ setRunning()
                                 ▼
                          ┌─────────────┐
           timeout ──────►│   running   │◄──── resumed from waiting
                          └──────┬──────┘
                                 │
               ┌─────────────────┼──────────────────┐
               │                 │                  │
               ▼                 ▼                  ▼
        ┌──────────┐      ┌──────────┐      ┌──────────────┐
        │ canceled │      │  waiting │      │   success    │
        │(timeout/ │      │(waitTill │      │  (finished)  │
        │ manual)  │      │  set)    │      └──────────────┘
        └──────────┘      └────┬─────┘
                               │ WaitTracker resumes
                               ▼
                          ┌─────────────┐
                          │   running   │ (loop resumes from DB state)
                          └──────┬──────┘
                                 │ node throws, continueOnFail=false
                                 ▼
                          ┌─────────────┐
                          │    error    │
                          └─────────────┘

Worker crash → status stays 'running' → ExecutionRecovery marks 'crashed'
```

Status values (from `packages/workflow/src/execution-status.ts`):
`new | running | waiting | success | error | canceled | crashed | unknown`

---

## Branching and Parallelism

### Sequential Execution (v1 order)

With `workflow.settings.executionOrder === 'v1'` (default for new workflows):
- After a node runs, its downstream nodes are collected, sorted by canvas position (top-left first), and pushed to the stack with `unshift` (prepend = depth-first).
- This ensures the visually "first" branch runs completely before the second branch starts.

### Legacy Execution Order

With older workflows (`executionOrder !== 'v1'`), nodes are appended to the stack (`push` = breadth-first). Both connected outputs of an IF node get pushed in order, so execution alternates.

### Multi-Input Nodes (Merge, Join)

Nodes with more than one `main` input port go through the `waitingExecution` mechanism:

- When a node with multiple inputs receives data from one parent, it is placed in `executionData.waitingExecution[nodeName][runIndex]` — a sparse array with `null` for inputs not yet received (`workflow-execute.ts:406`).
- Each parent node's output arrival updates one slot.
- When ALL slots are filled (or `requiredInputs` threshold met), the entry is moved from `waitingExecution` to `nodeExecutionStack`.

At the end of each main loop iteration, the engine checks if the stack is empty but `waitingExecution` is non-empty, and releases any partially-satisfied waiting node that does not require all inputs (`workflow-execute.ts:2087`).

### Parallel Branches

True parallelism between branches is NOT implemented. Everything runs in the same async event loop on one JS thread per execution. However, n8n achieves apparent concurrency at the execution level via:
- Multiple worker processes in queue mode
- Concurrency limits per mode (`production`, `evaluation`) managed by `ConcurrencyControlService`

---

## Pinned Data

Pinned data (`IPinData`) is stored as `resultData.pinData` on the execution data object. During execution, before calling `runNode()`, the engine checks:

```typescript
// workflow-execute.ts:1638
if (pinData && !executionNode.disabled && pinData[executionNode.name] !== undefined) {
  nodeSuccessData = [nodePinData]; // always zeroth runIndex
}
```

Pinned nodes are still "executed" in the engine loop but their output is replaced by the stored data. This is the mechanism for partial execution — re-running from a node without re-triggering upstream nodes.

---

## Wait/Sleep Nodes

When a node calls `context.putExecutionToWait(resumeDate)`:
1. `runExecutionData.waitTill` is set to the resume date.
2. The execution loop detects `waitTill` is set, writes `taskData` with `executionStatus: 'waiting'`, fires `nodeExecuteAfter`, pushes the current node back to the stack, and breaks the loop.
3. `processSuccessExecution()` sees `waitTill` and sets `status = 'waiting'`.
4. The `workflowExecuteAfter` hook saves the full `IRunExecutionData` to DB with `waitTill` set.
5. `WaitTracker` polls the DB every 60 seconds for executions with `waitTill` in the past (`packages/cli/src/wait-tracker.ts:43`).
6. When the timer fires, `WaitTracker.startExecution()` calls `WorkflowRunner.run()` with `restartExecutionId`, reloading state from DB.
7. `handleWaitingState()` (line 1291) clears `waitTill`, disables the node that put execution into wait, and removes its last run entry so it won't appear to have run twice.

---

## Sub-Workflow Execution

When an "Execute Workflow" node fires, it calls `additionalData.executeWorkflow()`:

```typescript
// packages/cli/src/workflow-execute-additional-data.ts:197
async function executeWorkflow(workflowInfo, additionalData, options): Promise<ExecuteWorkflowData>
```

This function:
1. Loads sub-workflow data (draft for manual runs, published version for production — `lines 206-220`)
2. Calls `ActiveExecutions.add()` — creates a DB record for the sub-execution
3. Calls `startExecution()` which creates a NEW `WorkflowExecute` instance with its own `IRunExecutionData`
4. The sub-execution runs synchronously in the same process/thread
5. Returns `{ executionId, data: lastNode.data.main, waitTill? }`
6. Parent node receives the sub-workflow's last node output as its output

Sub-workflows are always run in the current process (not queued separately). They share the parent's timeout budget. Binary data is duplicated to the parent's execution storage via `duplicateBinaryDataToParent()` (line 343 in execution-lifecycle-hooks.ts).

`RelatedExecution` metadata links parent ↔ child executions in the DB.

If `doNotWaitToFinish: true`, the sub-workflow is started but the parent does not wait for it — useful for fire-and-forget patterns.

---

## Error Handling and Retries

### Node-level retry

Configured per node with `node.retryOnFail`, `node.maxTries`, `node.waitBetweenTries`:

```typescript
// workflow-execute.ts:1606
let maxTries = 1;
if (executionData.node.retryOnFail === true) {
  maxTries = Math.min(5, Math.max(2, executionData.node.maxTries || 3));
}
```

The retry loop (lines 1621-1814) catches thrown errors and waits `waitBetweenTries` ms before retrying. After all tries exhausted, `executionError` is set.

The engine also handles "error as data" — when a node returns `{ json: { $error, $json } }` in its output, the error is extracted and the item is transformed (lines 1907-1922).

### Error output routing

If `node.onError === 'continueErrorOutput'`, the engine calls `handleNodeErrorOutput()` which routes failed items to the node's error output port instead of stopping execution.

If `node.continueOnFail === true` OR `node.onError` is `'continueRegularOutput'` or `'continueErrorOutput'`: execution continues using the input data passed through.

### Workflow-level error workflow

When a production workflow fails, `executeErrorWorkflow()` is called from the `workflowExecuteAfter` hook. It starts a separate "Error Workflow" execution with information about the failed workflow.

### Worker crash recovery

`ExecutionRecoveryService` (`packages/cli/src/executions/execution-recovery.service.ts`) is responsible for:
- Detecting stuck executions (status `running` but process gone)
- Marking them as `crashed`
- Auto-deactivating workflows with too many consecutive `crashed` executions (configurable threshold)

---

## Concurrency Model

### Per-execution: single threaded

Each execution runs in one async event loop. Within a single execution, nodes run sequentially (one after another). Async operations (HTTP requests, DB queries) yield the event loop but the execution's own logic is not parallelized.

### Cross-execution: concurrency limits

`ConcurrencyControlService` (`packages/cli/src/concurrency/concurrency-control.service.ts`) maintains in-memory queues per mode:
- `production` queue — configurable limit (defaults from `GlobalConfig.executions.concurrency`)
- `evaluation` queue — separate configurable limit
- Manual executions bypass concurrency limits

### Queue mode (horizontal scaling)

With `EXECUTIONS_MODE=queue`, new executions are enqueued into BullMQ (`packages/cli/src/scaling/scaling.service.ts`). Workers pick up jobs via `JobProcessor.processJob()`. In queue mode:
- Main process: registers execution, pushes job to Redis queue, waits for job to complete
- Worker process: fetches execution data from DB, runs `WorkflowExecute`, saves result to DB, notifies main via job progress messages

Sub-workflows always run in the current worker (not re-enqueued).

---

## Partial Execution (Editor "Test" Mode)

When a user clicks "Execute" on a node in the editor with existing run data:

1. Frontend sends `runData` (previous node outputs) + `destinationNode` + `dirtyNodeNames` (nodes whose params changed since last run)
2. `WorkflowExecute.runPartialWorkflow2()` is called (`packages/core/src/execution-engine/workflow-execute.ts:197`)
3. It performs:
   - `findTriggerForPartialExecution()` — find trigger that can seed execution
   - `DirectedGraph.fromWorkflow()` + `findSubgraph()` — build minimal subgraph from trigger to destination
   - `filterDisabledNodes()` — remove disabled nodes from graph
   - `cleanRunData()` — remove stale run data for dirty nodes
   - `findStartNodes()` — determine which nodes need to re-run
   - `handleCycles()` — detect and handle loop nodes
   - `recreateNodeExecutionStack()` — build the initial stack and `waitingExecution` state
4. The rest proceeds via `processRunExecutionData()`

This allows re-running only the minimal subgraph without triggering the trigger node again.

---

## Execution Record — What Gets Saved

### On execution start

- `ExecutionEntity` row: `{ status: 'new', mode, workflowId, createdAt }`
- `ExecutionData` row: `{ data: serialized IRunExecutionData, workflowData }`

`ExecutionPersistence.create()` handles the initial write.

### On status change to running

`ExecutionRepository.setRunning(executionId)` sets `status = 'running'`, `startedAt = now`.

### Per node (optional)

If `saveExecutionProgress` is enabled, `nodeExecuteAfter` hook calls `saveExecutionProgress()` (`packages/cli/src/execution-lifecycle/save-execution-progress.ts`), which writes the full `IRunExecutionData` (including `resultData.runData` for all completed nodes) to the DB. This enables resume-after-crash for long-running workflows.

### On completion

`workflowExecuteAfter` hook fires `updateExistingExecution()` with:
- `finished: true/false`
- `status: ExecutionStatus`
- `stoppedAt: Date`
- Full `data: IRunExecutionData` (all node outputs, errors)

### Soft delete (unsaved manual executions)

If `saveSettings.manual === false` and not waiting, `executionRepository.softDelete()` sets `deletedAt`. Binary data remains accessible until the next pruning cycle.

### Granularity

- Output stored per-node per-run-index in `resultData.runData[nodeName][runIndex].data.main`
- Each array is `INodeExecutionData[][]` — outer array = output ports, inner array = items
- Binary data stored externally (filesystem or S3), referenced by ID in `INodeExecutionData.binary`

---

## Execution Modes (WorkflowExecuteMode)

Defined at `packages/workflow/src/execution-context.ts:33`:

| Mode | Description |
|---|---|
| `manual` | User triggered via editor UI |
| `trigger` | Triggered by an active trigger node (webhook, schedule, etc.) |
| `webhook` | HTTP webhook hit |
| `error` | Error workflow invoked from another workflow's failure |
| `retry` | Retry of a failed execution |
| `integrated` | Sub-workflow called by Execute Workflow node |
| `cli` | Triggered via CLI command |
| `internal` | Internal system calls |
| `evaluation` | Test evaluation framework |
| `chat` | Chat trigger |

Mode affects: which hooks run, whether pinData applies, whether to use draft or published sub-workflows, concurrency queue selection.

---

## Key Files

| File | Description |
|---|---|
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/workflow-execute.ts` | **The execution engine.** `WorkflowExecute` class — `run()`, `runPartialWorkflow2()`, `processRunExecutionData()` (main loop), `runNode()`, `addNodeToBeExecuted()`. The single most important file. |
| `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/interfaces.ts` | All core TypeScript interfaces: `INodeExecutionData` (line 1370), `IExecuteData` (449), `IRunData` (2612), `ITaskData` (2683), `ITaskDataConnections` (2704), `IRun` (2576), `IWorkflowExecutionDataProcess` (2786). |
| `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/run-execution-data/run-execution-data.v1.ts` | `IRunExecutionDataV1` — the full execution state struct stored in DB and passed between services. Contains `nodeExecutionStack`, `waitingExecution`, `resultData`. |
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/execution-lifecycle-hooks.ts` | `ExecutionLifecycleHooks` class — hook registry with `addHandler()` and `runHook()`. Defines all lifecycle event types. |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/execution-lifecycle/execution-lifecycle-hooks.ts` | Hook factories: `getLifecycleHooksForRegularMain`, `getLifecycleHooksForScalingWorker`, `getLifecycleHooksForScalingMain`, `getLifecycleHooksForSubExecutions`. Wires DB save, UI push, statistics, external hooks. |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/workflow-runner.ts` | `WorkflowRunner` — top-level coordinator that decides between direct execution and queue enqueue, manages timeout, registers with `ActiveExecutions`. |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/manual-execution.service.ts` | `ManualExecutionService.runManually()` — decides between full run, partial re-run, and trigger-start-from for manual editor executions. |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/workflow-execute-additional-data.ts` | `executeWorkflow()` — sub-workflow execution entry point. Also `getBase()` — builds `IWorkflowExecuteAdditionalData` with all injected dependencies. |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/active-executions.ts` | `ActiveExecutions` — in-process registry of running executions. Manages lifecycle, concurrency reservation, response promises, and `PCancelable` attachment. |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/wait-tracker.ts` | `WaitTracker` — polls DB every 60s for waiting executions, schedules timers, resumes executions via `WorkflowRunner.run()`. |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/job-processor.ts` | `JobProcessor.processJob()` — BullMQ worker job handler. Loads execution from DB, builds `WorkflowExecute`, and drives the execution on a worker node. |
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/partial-execution-utils/recreate-node-execution-stack.ts` | `recreateNodeExecutionStack()` — core algorithm for partial executions. Rebuilds `nodeExecutionStack` and `waitingExecution` from a subgraph and existing runData. |
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/partial-execution-utils/directed-graph.ts` | `DirectedGraph` — typed graph representation used for subgraph computation, cycle detection, and graph traversal. |
| `/Users/ib/prj-other/n0n/n8n/packages/@n8n/db/src/entities/execution-entity.ts` | TypeORM entity for `execution` table — `status`, `mode`, `waitTill`, `stoppedAt`, `storedAt`, FK to `ExecutionData`. |
| `/Users/ib/prj-other/n0n/n8n/packages/@n8n/db/src/entities/execution-data.ts` | TypeORM entity for `execution_data` table — stores serialized `IRunExecutionData` as text and `workflowData` as JSON. |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/execution-lifecycle/save-execution-progress.ts` | `saveExecutionProgress()` — writes full execution state to DB after each node (if progress saving is enabled). Enables resume-after-crash. |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/executions/execution-recovery.service.ts` | `ExecutionRecoveryService` — detects crashed executions, marks them, auto-deactivates workflows with too many consecutive crashes. |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/concurrency/concurrency-control.service.ts` | `ConcurrencyControlService` — per-mode concurrency limits with in-memory `ConcurrencyQueue`. Blocks new executions when capacity is full. |
| `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/execution-status.ts` | `ExecutionStatus` type — the 8 possible execution states. |
