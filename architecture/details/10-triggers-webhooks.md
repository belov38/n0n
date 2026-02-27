# n8n Triggers and Webhooks Architecture

Analysis of how workflows are started in n8n: trigger types, webhook URL lifecycle, scheduler architecture, and the activation system.

---

## Trigger Type Matrix

| Trigger Type | Implementation | How it fires | Key config options | Special behavior |
|---|---|---|---|---|
| **Manual** | `ManualTrigger` node, `ITriggerResponse.manualTriggerFunction` | User clicks "Execute workflow" in UI | None — single-use, test only | The only trigger that fires immediately in `executionMode: 'manual'`; emits one empty item `[{}]` |
| **Schedule/Cron** | `ScheduleTrigger` node, `ScheduledTaskManager` + `cron` library | CronJob fires on leader instance | `rule.interval[]`: seconds/minutes/hours/days/weeks/months/cronExpression + timezone | Polled via cron expression; does not run in `manual` mode (returns `manualTriggerFunction` instead); minimum 1-minute interval for poll triggers |
| **Webhook (production)** | `Webhook` node + `LiveWebhooks` service | External HTTP request to `/webhook/:path` | HTTP method, path, auth, response mode | Registered in DB `webhook_entity` table on workflow activation; persists across restarts |
| **Webhook (test)** | `Webhook` node + `TestWebhooks` service | External HTTP request to `/webhook-test/:path` | Same as production | Registered ephemerally in Redis cache; single-use per "listen" click; auto-expires after 2 minutes |
| **Form Trigger** | `FormTrigger` node | HTTP POST to `/form/:path` | Form fields, response mode | Handled by same `LiveWebhooks` manager; supports multi-page forms and `formPage` response mode |
| **Waiting Webhook** | `Wait` node | HTTP call to `/webhook-waiting/:executionId` | Resume mode (webhook, form, etc.) | Resumes a paused execution; URL includes `executionId`; requires HMAC token for signed calls |
| **Polling** | Nodes implementing `poll()` (e.g. Gmail Trigger, RSS Trigger) | CronJob on leader fires `poll()` | `pollTimes.item[]` with intervals | On activation, runs immediately once to validate; deduplication is node-specific via `getWorkflowStaticData` |
| **Event-based (Trigger nodes)** | Nodes implementing `trigger()` (e.g. MQTT, RabbitMQ, N8nTrigger) | External event pushed from node's `emit()` | Node-specific (e.g. topic, queue name) | Node keeps a long-running connection; `closeFunction` in `ITriggerResponse` tears it down on deactivation |
| **MCP Trigger** | `@n8n/n8n-nodes-langchain.mcpTrigger` | HTTP to `/mcp/:path` (or `/mcp-test/:path`) | SSE transport, session IDs | Routed through `LiveWebhooks`; special pub/sub relay in queue mode for list-tools requests |
| **Chat Trigger** | `@n8n/n8n-nodes-langchain.chatTrigger` | HTTP POST to webhook path + `/chat` | Public/private, response mode | Uses session-based path in test mode (`workflowId/sessionId`); supports `hostedChat` response mode |
| **Error Trigger** | `n8n-nodes-base.errorTrigger` | Another workflow's execution fails | Target workflow ID | Auto-invoked by `executeErrorWorkflow()` in the active workflow manager |
| **Execute Workflow Trigger** | `n8n-nodes-base.executeWorkflowTrigger` | Parent workflow calls sub-workflow | None | Excluded from trigger count; used for sub-workflow entry points |

---

## Webhook URL Lifecycle

### URL Path Format

Production webhook path construction (`getNodeWebhookPath`):

```
# Static path (node has user-configured path, no dynamic segments)
/webhook/{workflowId}/{encodedNodeName}/{userPath}

# Dynamic path (node has `:param` segments, node has a webhookId UUID)
/webhook/{node.webhookId}/{userPath}   e.g. /webhook/abc-uuid/user/:id/posts

# Full-path override (isFullPath=true in webhookDescription)
/webhook/{userPath}   or   /webhook/{node.webhookId}
```

`node.webhookId` is a UUID stored on the node definition itself (persists across workflow saves), used to keep the URL stable even if the workflow or node is renamed.

Reference: `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/node-helpers.ts:1047`

### URL Prefixes by Endpoint Type

All configurable via environment variables (`EndpointsConfig`):

| URL Prefix | Default | Purpose | env var |
|---|---|---|---|
| `/webhook/*` | `/webhook` | Production webhooks and form triggers | `N8N_ENDPOINT_WEBHOOK` |
| `/webhook-test/*` | `/webhook-test` | Test webhooks | `N8N_ENDPOINT_WEBHOOK_TEST` |
| `/webhook-waiting/:executionId` | `/webhook-waiting` | Wait-node resume URLs | `N8N_ENDPOINT_WEBHOOK_WAIT` |
| `/form/*` | `/form` | Production form triggers | `N8N_ENDPOINT_FORM` |
| `/form-test/*` | `/form-test` | Test form triggers | `N8N_ENDPOINT_FORM_TEST` |
| `/form-waiting/:executionId` | `/form-waiting` | Form wait-node resume | `N8N_ENDPOINT_FORM_WAIT` |
| `/mcp/*` | `/mcp` | Production MCP (AI tools) | `N8N_ENDPOINT_MCP` |
| `/mcp-test/*` | `/mcp-test` | Test MCP | `N8N_ENDPOINT_MCP_TEST` |

Reference: `/Users/ib/prj-other/n0n/n8n/packages/@n8n/config/src/configs/endpoints.config.ts:81`

### Production Webhook: Step-by-step Lifecycle

**Registration (workflow activation):**

1. User clicks "Activate" toggle in UI, or API call `PATCH /workflows/:id` sets `active: true`.
2. `WorkflowService.update()` calls `ActiveWorkflowManager.add(workflowId, 'update')`.
3. `ActiveWorkflowManager.add()` calls `addWebhooks()` which iterates all webhook-capable nodes.
4. For each webhook node, `WebhookService.getNodeWebhooks()` computes the path from the node's `webhookDescription`.
5. A `WebhookEntity` row is upserted into the `webhook_entity` table: `{workflowId, webhookPath, method, node, webhookId?, pathLength?}`.
6. `WebhookService.createWebhookIfNotExists()` calls the node's `webhookMethods.checkExists` then `webhookMethods.create` (for nodes that register at third-party services, e.g. Stripe, GitHub).
7. The result is also cached in Redis (key: `webhook:{METHOD}-{path}`).

Reference: `/Users/ib/prj-other/n0n/n8n/packages/cli/src/active-workflow-manager.ts:150`

**Incoming HTTP request handling:**

1. Express route `app.all('/webhook/*path', liveWebhooksRequestHandler)` catches the request.
2. `WebhookRequestHandler.handleRequest()` handles CORS preflight, then calls `LiveWebhooks.executeWebhook()`.
3. `LiveWebhooks` calls `WebhookService.findWebhook(method, path)` — checks Redis cache first, then DB (static match, then dynamic/parameterized match).
4. Loads workflow data from DB (the `activeVersion` — published snapshot, not draft).
5. Calls `WebhookHelpers.executeWebhook()` which:
   a. Parses request body (JSON, form-data, XML, raw based on content-type and node version).
   b. Calls `WebhookService.runWebhook()` which invokes `nodeType.webhook(context)` on the trigger node.
   c. Evaluates `responseMode`: `onReceived`, `lastNode`, `responseNode`, `formPage`, `streaming`, `hostedChat`.
   d. Starts the workflow via `WorkflowRunner.run()`.
   e. Returns HTTP response per the configured mode.

Reference: `/Users/ib/prj-other/n0n/n8n/packages/cli/src/abstract-server.ts:225`
Reference: `/Users/ib/prj-other/n0n/n8n/packages/cli/src/webhooks/live-webhooks.ts:71`
Reference: `/Users/ib/prj-other/n0n/n8n/packages/cli/src/webhooks/webhook-helpers.ts:412`

**Response modes:**

- `onReceived` — immediately returns 200 with optional custom body; workflow runs asynchronously.
- `lastNode` — waits for workflow to finish, returns last node's output data as JSON.
- `responseNode` — waits for a "Respond to Webhook" node in the flow to call `responsePromise.resolve()`.
- `formPage` — returns `{formWaitingUrl}` so the browser redirects to a waiting form URL.
- `streaming` — passes `res` directly to workflow so a node can stream data.
- `hostedChat` — returns `{executionStarted, executionId}` immediately for hosted chat widgets.

**Deregistration (workflow deactivation):**

1. `ActiveWorkflowManager.remove(workflowId)` is called.
2. `clearWebhooks(workflowId)` calls `WebhookService.deleteWebhook()` for each webhook (invokes `webhookMethods.delete` to remove registrations at third-party services).
3. `WebhookService.deleteWorkflowWebhooks(workflowId)` removes rows from `webhook_entity` and purges Redis cache entries.

Reference: `/Users/ib/prj-other/n0n/n8n/packages/cli/src/active-workflow-manager.ts:240`

### Test Webhook: Step-by-step Lifecycle

1. User opens editor and clicks "Listen for test event" (or "Execute workflow" for webhook-based workflows).
2. Frontend sends `POST /rest/workflows/:id/run` with execution payload.
3. `WorkflowExecutionService.executeManually()` detects a webhook-capable trigger without pinned data and calls `TestWebhooks.needsWebhook()`.
4. `TestWebhooks.needsWebhook()` registers a `TestWebhookRegistration` in Redis cache hash `test-webhooks` (TTL: 2 minutes + 30s buffer) for each webhook in the flow.
5. Backend returns `{ waitingForWebhook: true }` to the frontend.
6. Frontend shows "Listening..." state.
7. External service sends HTTP to `/webhook-test/{path}`.
8. `TestWebhooks.executeWebhook()` looks up the registration from Redis, runs the workflow in `executionMode: 'manual'`.
9. On completion, notifies the editor UI via push (`testWebhookReceived` event with `executionId`).
10. `deactivateWebhooks()` removes the registration from Redis.

Registration is stored in Redis, not DB — so test webhooks do not survive process restart. In multi-main setup, the handler process may pub/sub command the creator process to clear its registration.

Reference: `/Users/ib/prj-other/n0n/n8n/packages/cli/src/webhooks/test-webhooks.ts:274`
Reference: `/Users/ib/prj-other/n0n/n8n/packages/cli/src/webhooks/test-webhook-registrations.service.ts:47`

**Test vs Production differences:**

| Aspect | Test (`/webhook-test/`) | Production (`/webhook/`) |
|---|---|---|
| URL prefix | `/webhook-test` | `/webhook` |
| Registration store | Redis hash, ephemeral | DB `webhook_entity` table + Redis cache |
| Activation requirement | No (workflow can be inactive) | Yes — workflow must have `activeVersionId` set |
| Execution mode | `manual` | `webhook` |
| Duration | Until first request or 2-minute timeout | Until workflow deactivated |
| UI visibility | Shown live in canvas | Shown in executions list only |
| Multiple calls | Only first call triggers execution | Every call triggers |
| Single-trigger nodes | Error thrown (Telegram, Slack, Facebook) | Normal operation |

---

## Scheduler Architecture

### Cron Library

The cron scheduler uses the **`cron`** package (v4.4.0), via the `CronJob` class.

Reference: `/Users/ib/prj-other/n0n/n8n/packages/core/package.json:57`

### ScheduledTaskManager

`ScheduledTaskManager` (`packages/core/src/execution-engine/scheduled-task-manager.ts:16`) is an injected `@Service()` that:

- Maintains an in-memory `Map<workflowId, Map<cronKey, {job, summary, ctx}>>`.
- `registerCron(ctx, onTick)` creates a `CronJob` that fires only when `instanceSettings.isLeader` is true. This guards against duplicate executions in multi-main deployments.
- `deregisterCrons(workflowId)` stops and removes all crons for a workflow.
- Optionally logs active crons at a configurable interval.

Reference: `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/scheduled-task-manager.ts:50`

### Schedule Trigger Node Behavior

`ScheduleTrigger.trigger()` (`packages/nodes-base/nodes/Schedule/ScheduleTrigger.node.ts:427`):

- **In production mode**: Calls `this.helpers.registerCron(cron, callback)` for each defined interval. The cron expression is computed by `toCronExpression()` from the human-friendly interval config. Returns `{}` (empty — the cron itself drives execution).
- **In manual mode**: Does not register crons. Returns `{ manualTriggerFunction }` which fires `emit()` immediately with the current timestamp. This is how "Execute workflow" in the canvas works for schedule triggers.

Cron expression format: `[Second] [Minute] [Hour] [Day of Month] [Month] [Day of Week]`

### Polling Nodes

Polling nodes implement `poll()` and are activated by `ActiveWorkflows.activatePolling()`:

1. `pollFunctions.getNodeParameter('pollTimes')` retrieves the configured intervals.
2. Each interval is converted to a cron expression via `toCronExpression()`.
3. `executeTrigger(testingTrigger=true)` is called immediately on activation to validate connectivity.
4. For each expression, `scheduledTaskManager.registerCron(ctx, executeTrigger)` schedules it.
5. When the cron fires, `TriggersAndPollers.runPoll()` calls `nodeType.poll()`. If it returns non-null data, `pollFunctions.__emit(data)` triggers a workflow execution.

Deduplication is entirely the node's responsibility — typically via `getWorkflowStaticData('node')` to persist the ID/timestamp of the last seen item.

Minimum polling interval: 1 minute (enforced at `ActiveWorkflows.activatePolling()` — rejects cron expressions with `*` in the seconds position).

Reference: `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/active-workflows.ts:141`

### Missed Schedules

n8n does not attempt to catch up on missed scheduled executions. When the process restarts:

- `ActiveWorkflowManager.init()` re-registers all active workflows via `addActiveWorkflows('init')`.
- `addTriggersAndPollers()` calls `addActiveWorkflows()` which re-registers crons from scratch.
- Any ticks that occurred while the process was down are simply missed.

For polling nodes, `activatePolling()` runs `executeTrigger(testingTrigger=true)` immediately on activation — this means polling nodes do catch the "just started" state by running their `poll()` once on startup, so they can detect any events that occurred while they were down (if the node correctly tracks state in `staticData`).

---

## Activation System

### Active vs Inactive

A workflow's activation state is stored in two places:
- `WorkflowEntity.active` (boolean in `workflow_entity` DB table).
- `WorkflowEntity.activeVersionId` (FK to the published/frozen version of the workflow).

When a workflow is activated, the current draft is "published" as an `activeVersion` snapshot. Webhook registrations and trigger subscriptions are always based on this frozen snapshot, not the live draft being edited.

Reference: `/Users/ib/prj-other/n0n/n8n/packages/cli/src/active-workflow-manager.ts:621`

### What Activation Does

`ActiveWorkflowManager.add(workflowId, activationMode)` (line 588):

1. Fetches the workflow and its `activeVersion` (published nodes + connections).
2. Validates the workflow has at least one trigger/webhook/poller node.
3. **If `shouldAddWebhooks(activationMode)`** — registers webhooks in DB (always true for `init`, `leadershipChange`, or when instance is leader for `update`/`activate`).
4. **If `shouldAddTriggersAndPollers()`** — only on the leader: calls `addTriggersAndPollers()` which starts in-memory trigger connections and cron jobs via `ActiveWorkflows.add()`.
5. Clears any queued retry attempts; deregisters any stored activation error.
6. Updates `triggerCount` in the workflow row.

### shouldAddWebhooks vs shouldAddTriggersAndPollers

Webhooks (DB-registered) can be served by any process that has access to the DB, so all instances register them on init/leadership change. Only the leader registers triggers/pollers (to avoid duplicate executions).

Reference: `/Users/ib/prj-other/n0n/n8n/packages/cli/src/active-workflow-manager.ts:1017`

### Multi-Main Setup

When `instanceSettings.isMultiMain` is true:

- **Activation request**: Non-leader instances publish a `add-webhooks-triggers-and-pollers` pub/sub command to the leader.
- **Leader handles**: Calls `add()` with `shouldPublish: false`; broadcasts `workflowActivated` push event to all followers.
- **Deactivation**: Non-leader publishes `remove-triggers-and-pollers` command; leader stops in-memory triggers and broadcasts `workflowDeactivated`.
- **Leadership change**: `@OnLeaderTakeover()` re-runs `addActiveWorkflows('leadershipChange')` to restart all trigger/poller subscriptions on the new leader.

Reference: `/Users/ib/prj-other/n0n/n8n/packages/cli/src/active-workflow-manager.ts:556`

### Activation Retry on Failure

If `ActiveWorkflowManager.add()` fails (e.g. third-party service unavailable), the workflow is queued for retry:

- `addQueuedWorkflowActivation()` sets a `setTimeout` starting at `WORKFLOW_REACTIVATE_INITIAL_TIMEOUT` (1 second).
- Each failed retry doubles the timeout up to `WORKFLOW_REACTIVATE_MAX_TIMEOUT` (24 hours).
- The error is also stored via `ActivationErrorsService` (visible in the UI).

Reference: `/Users/ib/prj-other/n0n/n8n/packages/cli/src/active-workflow-manager.ts:811`

### Startup Activation

On process start, `ActiveWorkflowManager.init()` calls `addActiveWorkflows('init')`:

- Queries `WorkflowRepository.getAllActiveIds()` to get all `active=true` workflows.
- Processes them in configurable batch size (`workflowsConfig.activationBatchSize`).
- On `init`/`leadershipChange`, webhook DB entries are upserted (duplicates from previous run are silently ignored with `QueryFailedError` handling).

---

## Webhook Server Architecture

### Single-process vs Dedicated Webhook Process

n8n supports two deployment modes:

**Single main process** (default):
- One Express app handles both API and webhooks.
- `webhooksEnabled = true`, `testWebhooksEnabled = true`.

**Dedicated webhook process** (queue mode only):
- `n8n webhook` command starts `WebhookServer extends AbstractServer`.
- `WebhookServer` (`packages/cli/src/webhooks/webhook-server.ts:6`) is an empty class — all webhook routing comes from `AbstractServer`.
- `webhooksEnabled = true` (production URLs), `testWebhooksEnabled = false` (test URLs only on main).
- The webhook process connects to the same DB and Redis; it reads `webhook_entity` to find which workflow to run.
- Workflows are enqueued via BullMQ (`ScalingService.setupQueue()`); a separate worker process executes them.

Reference: `/Users/ib/prj-other/n0n/n8n/packages/cli/src/commands/webhook.ts:17`
Reference: `/Users/ib/prj-other/n0n/n8n/packages/cli/src/webhooks/webhook-server.ts:1`

### Express Route Registration

In `AbstractServer.start()` (`packages/cli/src/abstract-server.ts:216`), webhook routes are registered **before** the body parser middleware (so webhook nodes can handle raw binary streams themselves):

```
app.all('/form/*path',            liveWebhooksRequestHandler)
app.all('/webhook/*path',         liveWebhooksRequestHandler)
app.all('/form-waiting/:path',    waitingFormsRequestHandler)
app.all('/webhook-waiting/:path', waitingWebhooksRequestHandler)
app.all('/mcp/*path',             liveWebhooksRequestHandler)

# Test routes (main process only):
app.all('/form-test/*path',       testWebhooksRequestHandler)
app.all('/webhook-test/*path',    testWebhooksRequestHandler)
app.all('/mcp-test/*path',        testWebhooksRequestHandler)
```

All handlers are created by `createWebhookHandlerFor(manager)` which wraps `WebhookRequestHandler`.

Reference: `/Users/ib/prj-other/n0n/n8n/packages/cli/src/abstract-server.ts:225`

### Request Body Parsing

`parseRequestBody()` in `webhook-helpers.ts` (line 977):
- `multipart/form-data`: parsed by `createMultiFormDataParser()` (busboy-based).
- `application/json`, `text/plain`, `application/x-www-form-urlencoded`, `*/xml`: parsed by the shared `parseBody` middleware.
- For webhook node v1 with `binaryData=true`: body parsing is skipped entirely (node handles the raw stream).

### IWebhookManager Interface

All webhook managers implement `IWebhookManager` (`webhook.types.ts:19`):

```typescript
interface IWebhookManager {
  getWebhookMethods?(path: string): Promise<IHttpRequestMethods[]>; // for CORS
  findAccessControlOptions(path, method): Promise<WebhookAccessControlOptions | undefined>;
  executeWebhook(req, res): Promise<IWebhookResponseCallbackData>;
}
```

Four concrete implementations:
- `LiveWebhooks` — production URLs, reads from DB.
- `TestWebhooks` — test URLs, reads from Redis cache.
- `WaitingWebhooks` — wait-node resume, resolves by execution ID.
- `WaitingForms` — form wait-node resume (extends `WaitingWebhooks` with `includeForms = true`).

Reference: `/Users/ib/prj-other/n0n/n8n/packages/cli/src/webhooks/webhook.types.ts:19`

---

## Error Handling for Triggers

### Webhook Returns 404 When Workflow is Inactive

`LiveWebhooks.findWebhook()` calls `WebhookService.findWebhook()`. If no DB row matches the path+method, a `WebhookNotFoundError` (extends `NotFoundError`) is thrown. The `WebhookRequestHandler` catches it and calls `ResponseHelper.sendErrorResponse(res, error)`, returning HTTP 404 with an informative message:

- "The requested webhook `{path}` is not registered."
- If wrong method: "This webhook is not registered for {METHOD} requests. Did you mean to make a {ALLOWED} request?"

The production hint additionally says: "The workflow must be active for a production URL to run successfully."

Reference: `/Users/ib/prj-other/n0n/n8n/packages/cli/src/errors/response-errors/webhook-not-found.error.ts:35`

### Webhook Returns 500 When Execution Fails

If the workflow execution throws an error during the response window:
- `responseMode: 'onReceived'` has already responded 200 before execution completes.
- `responseMode: 'lastNode'`: the `executePromise.catch()` block calls `responseCallback` with HTTP 500 and `{"message":"Error in workflow"}`.
- `responseMode: 'responseNode'`: the Respond to Webhook node's error propagates to the response promise, which is sent back.

Reference: `/Users/ib/prj-other/n0n/n8n/packages/cli/src/webhooks/webhook-helpers.ts:893`

### Trigger Node Errors

When a trigger node's `emitError()` is called (e.g. connection to event source dropped):

1. The workflow is removed from `activeWorkflows` in memory.
2. Error is registered in `ActivationErrorsService`.
3. The error workflow is executed (if configured on the workflow).
4. The workflow is added to `queuedActivations` for automatic retry (exponential backoff up to 24 hours).

Reference: `/Users/ib/prj-other/n0n/n8n/packages/cli/src/active-workflow-manager.ts:386`

### Webhook Request Logging

Every incoming request is logged at `debug` level:
- `LiveWebhooks`: `Received webhook "${httpMethod}" for path "${path}"` (line 78)
- `WaitingWebhooks`: `Received waiting-webhook "${method}" for execution "${executionId}"` (line 67)
- Errors: `Error in handling webhook request ${method} ${path}: ${message}` (via `WebhookRequestHandler`)

Bot requests are blocked at the Express middleware level (`isbot`) with HTTP 204 before reaching any webhook handler.

Reference: `/Users/ib/prj-other/n0n/n8n/packages/cli/src/abstract-server.ts:261`

---

## Manual Trigger Deep-dive

### How "Execute Workflow" Works

1. User clicks "Execute workflow" in the canvas.
2. Frontend sends `POST /rest/workflows/:id/run` with `{ workflowData, startNodes?, destinationNode? }`.
3. `WorkflowExecutionService.executeManually()` is called.
4. If the workflow starts with a **ManualTrigger** node:
   - `ManualTrigger.trigger()` is called (via `TriggersAndPollers.runTrigger()`).
   - It returns `{ manualTriggerFunction }` which emits `[{}]` immediately.
   - `triggerResponse.manualTriggerResponse` promise resolves, execution begins.
5. If the workflow starts with a **Webhook** node:
   - `TestWebhooks.needsWebhook()` returns `true`.
   - Backend responds `{ waitingForWebhook: true }`.
   - Frontend shows "Listening..." state, waiting for an HTTP call.
6. If the workflow starts with a **ScheduleTrigger** node:
   - In manual mode, `ScheduleTrigger.trigger()` returns `{ manualTriggerFunction }`.
   - The function runs `executeTrigger(recurrence)` immediately, emitting timestamp data.

### Test vs Production Execution Mode

The `executionMode` field distinguishes how a run was triggered:

| Mode | When used | Shows in canvas? | Saved to DB? |
|---|---|---|---|
| `manual` | User-initiated test runs | Yes | Yes (while running) |
| `webhook` | Production webhook calls | No | Yes |
| `trigger` | Schedule/poll/event triggers | No | Yes |
| `integrated` | Sub-workflow calls | No | Yes |
| `error` | Error workflow trigger | No | Yes |
| `evaluation` | AI evaluation runs | Yes | Yes |

---

## Key Files

| File | Description |
|---|---|
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/active-workflow-manager.ts` | Central orchestrator for workflow activation: registers webhooks in DB, starts triggers/pollers in memory, handles multi-main pub/sub, manages retry queue |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/abstract-server.ts` | Express route registration for all webhook endpoints; the entry point for all incoming HTTP webhook requests |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/webhooks/live-webhooks.ts` | Handles production webhook execution: DB lookup, workflow loading, execution delegation |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/webhooks/test-webhooks.ts` | Handles test webhook registration (Redis), execution, timeout management, multi-main coordination |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/webhooks/webhook-helpers.ts` | Core `executeWebhook()` function: body parsing, response mode evaluation, workflow runner invocation, response sending |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/webhooks/webhook.service.ts` | DB/cache CRUD for webhook entities; path computation; webhook method invocation (checkExists, create, delete) |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/webhooks/webhook-request-handler.ts` | HTTP layer: CORS handling, method validation, response format switching (legacy vs WebhookResponse) |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/webhooks/waiting-webhooks.ts` | Resume paused executions via Wait node; validates execution state, HMAC token, dispatches to `executeWebhook()` |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/webhooks/test-webhook-registrations.service.ts` | Redis-based registry for test webhook registrations with TTL; supports multi-main cross-process lookup |
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/active-workflows.ts` | In-memory registry of active trigger/poller workflows; manages `ITriggerResponse` lifecycle and cron scheduling |
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/scheduled-task-manager.ts` | CronJob lifecycle management using the `cron` library v4.4; leader-only execution guard |
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/triggers-and-pollers.ts` | Low-level runner: calls `nodeType.trigger()` and `nodeType.poll()`; wraps manual mode trigger with promise resolution |
| `/Users/ib/prj-other/n0n/n8n/packages/@n8n/db/src/entities/webhook-entity.ts` | TypeORM entity for `webhook_entity` table: stores static and dynamic webhook paths with cache key computation |
| `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/node-helpers.ts:1047` | `getNodeWebhookPath()`: computes the webhook URL path from workflowId, node, user-configured path |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/webhooks/webhook.types.ts` | `IWebhookManager` interface implemented by LiveWebhooks, TestWebhooks, WaitingWebhooks, WaitingForms |
| `/Users/ib/prj-other/n0n/n8n/packages/@n8n/config/src/configs/endpoints.config.ts` | Endpoint path configuration: all URL prefixes configurable via environment variables |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/commands/webhook.ts` | Dedicated webhook process entry point for queue mode deployments |
| `/Users/ib/prj-other/n0n/n8n/packages/nodes-base/nodes/ManualTrigger/ManualTrigger.node.ts` | Manual trigger node: returns `manualTriggerFunction` that emits `[{}]` immediately |
| `/Users/ib/prj-other/n0n/n8n/packages/nodes-base/nodes/Schedule/ScheduleTrigger.node.ts` | Schedule trigger: registers crons in production mode; fires immediately in manual mode |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/workflows/workflow-execution.service.ts:102` | `executeManually()`: orchestrates all test execution cases including webhook-wait flow |
