# 08 — Queue & Scaling Architecture

Source: `/Users/ib/prj-other/n0n/n8n/packages/cli/src/`

---

## Queue Architecture

### Queue Library

n8n uses the **Bull** library (not BullMQ) for the job queue. Bull is imported dynamically in `ScalingService.setupQueue()`.

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/scaling.service.ts:61
const { default: BullQueue } = await import('bull');
```

### Queue Name and Type

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/constants.ts:3-5
export const QUEUE_NAME = 'jobs';
export const JOB_TYPE_NAME = 'job';
```

There is a single queue named `jobs`. All workflow executions go through this one queue regardless of workflow type.

### Queue Initialization — Producer Side (main process)

The queue is set up in `ScalingService.setupQueue()`:

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/scaling.service.ts:60-109
```

Key settings passed to Bull:
- `prefix`: from `QUEUE_BULL_PREFIX` env var (default `bull`), wrapped in `{}` for Redis cluster mode.
- `settings.maxStalledCount = 0`: stalled jobs are NOT automatically retried by Bull. n8n handles recovery itself via `recoverFromQueue()`.
- `createClient`: all Bull connections (subscriber, client, bclient) are created via `RedisClientService`, which applies the retry strategy.

### Job Options — Producer

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/scaling.service.ts:229-234
const jobOptions: JobOptions = {
    priority,
    removeOnComplete: true,  // job removed from Redis immediately on completion
    removeOnFail: true,      // job removed from Redis immediately on failure
};
```

No explicit `attempts` (retry) count is set. `removeOnComplete` and `removeOnFail` prevent job data from accumulating in Redis after execution ends.

### Job Priority

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/workflow-runner.ts:412
job = await this.scalingService.addJob(jobData, { priority: realtime ? 50 : 100 });
```

- `realtime = true` (priority 50): used for webhook-triggered executions so they get processed faster.
- `realtime = false` (priority 100): used for trigger/scheduled executions.

### Job Data Shape

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/scaling.types.ts:18-42
```

Fields:
- `workflowId`, `executionId`, `loadStaticData` — required for job processing.
- `pushRef` — browser session ID so worker can relay push events back.
- `streamingEnabled` — for AI streaming (send-chunk messages).
- `restartExecutionId` — for resuming paused executions.
- MCP fields — `isMcpExecution`, `mcpType`, `mcpSessionId`, `mcpMessageId`, `mcpToolCall` — for AI tool calls in queue mode.

### Job Consumer — Worker Side

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/scaling.service.ts:111-137
setupWorker(concurrency: number) {
    void this.queue.process(JOB_TYPE_NAME, concurrency, async (job: Job) => {
        ...
        await this.jobProcessor.processJob(job);
    });
}
```

Concurrency is set once when `setupWorker` is called. The Bull `process` call registers a handler for `'job'` type jobs with the given concurrency limit.

### Concurrency Setting

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/commands/worker.ts:22-24
const flagsSchema = z.object({
    concurrency: z.number().int().default(10)...
});
```

Default concurrency is 10. Can also be set via `N8N_CONCURRENCY_PRODUCTION_LIMIT` env var. If set to less than 5, a warning is logged.

---

## Instance Types

n8n in scaling mode operates with three distinct process types:

| Instance Type | Binary Command | Role |
|---|---|---|
| `main` | `n8n start` | Web UI, REST API, workflow activation, job enqueuing, result collection |
| `worker` | `n8n worker` | Job processing only — no HTTP server for UI, no webhook handling |
| `webhook` | `n8n webhook` | Receives production webhooks, enqueues jobs, no UI |

### How instanceType is Determined

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/commands/worker.ts:64-72
constructor() {
    super();
    if (this.globalConfig.executions.mode !== 'queue') {
        this.globalConfig.executions.mode = 'queue';
    }
}
```

The worker command forces `EXECUTIONS_MODE=queue`. The instance type itself is registered via `InstanceSettings` from `n8n-core` and is driven by which command is run.

### What the Worker Does

The worker process:
1. Connects to Redis and subscribes to the `n8n.commands` pubsub channel.
2. Calls `ScalingService.setupQueue()` to create Bull queue connections.
3. Calls `ScalingService.setupWorker(concurrency)` to register Bull processor.
4. Optionally starts a lightweight HTTP server for health/readiness checks and Prometheus metrics (`WorkerServer`).

The worker does NOT handle webhooks, does NOT serve the UI, and does NOT run leader-exclusive tasks (pruning, wait-tracking, queue recovery).

### Worker HTTP Server

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/worker-server.ts
```

Endpoints exposed if enabled:
- `GET /healthz` — liveness probe (always returns `{ status: 'ok' }`)
- `GET /healthz/readiness` — readiness probe (checks DB connection + Redis connection)
- `POST /<overwrite-endpoint>` — credential overwrites injection
- `GET /metrics` — Prometheus metrics

Port configured by `QUEUE_HEALTH_CHECK_PORT` (default 5678). Enabled by `QUEUE_HEALTH_CHECK_ACTIVE=true`.

---

## Job Lifecycle — Full Flow

### Enqueue (main process)

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/workflow-runner.ts:378-413
```

1. `WorkflowRunner.run()` is called on main.
2. If `executionsConfig.mode === 'queue'` and execution mode is not `manual` (unless `OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS=true`), it calls `enqueueExecution()`.
3. Execution is created in DB with status `new` by `ActiveExecutions.add()`.
4. `ScalingService.addJob()` sends the job to Redis via Bull.
5. `getLifecycleHooksForScalingMain()` is set up — these run only `workflowExecuteBefore` and `workflowExecuteAfter` on the main side.
6. Main then awaits `job.finished()` — this promise resolves when the worker signals completion via `job-finished` progress message.

### Process (worker process)

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/job-processor.ts:72-368
```

1. Worker picks up job from Bull queue.
2. Loads execution data from database.
3. Skips if status is `crashed` (already recovered).
4. Sets execution status to `running` in DB.
5. Builds lifecycle hooks via `getLifecycleHooksForScalingWorker()` — includes push relay, save, error workflow, external hooks.
6. Executes the workflow via `WorkflowExecute`.
7. On completion, sends `job-finished` message via `job.progress()`.
8. Main receives this message in `registerMainOrWebhookListeners()` and resolves its `job.finished()` promise.

### Result Reporting — job.progress() Messages

Bull's `global:progress` event is used as the primary inter-process communication channel. All messages are typed:

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/scaling.types.ts:58-135
```

| Message kind | Direction | Purpose |
|---|---|---|
| `job-finished` | worker → main | Execution completed (success or error), carries result summary |
| `job-failed` | worker → main | Unhandled exception in worker |
| `respond-to-webhook` | worker → main | Send HTTP response to waiting webhook caller |
| `send-chunk` | worker → main | Relay AI streaming chunk to waiting HTTP response |
| `abort-job` | main → worker | Stop a running execution |
| `mcp-response` | worker → main | MCP tool call result |

---

## Multi-Instance Coordination

### Activation of Queue Mode

Set via `EXECUTIONS_MODE=queue` env var:

```
/Users/ib/prj-other/n0n/n8n/packages/@n8n/config/src/configs/executions.config.ts:65-67
```

### Single Main (default)

In the default queue deployment (one main, multiple workers):
- The main process is automatically the leader.
- `this.instanceSettings.markAsLeader()` is called directly at startup.

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/commands/start.ts:306-308
} else {
    this.instanceSettings.markAsLeader();
}
```

### Multi-Main Setup (licensed feature)

Enabled by `N8N_MULTI_MAIN_SETUP_ENABLED=true`. Requires a license that includes `MULTIPLE_MAIN_INSTANCES`.

```
/Users/ib/prj-other/n0n/n8n/packages/@n8n/config/src/configs/multi-main-setup.config.ts
```

Config:
- `N8N_MULTI_MAIN_SETUP_KEY_TTL` — Leader key TTL in seconds (default 10)
- `N8N_MULTI_MAIN_SETUP_CHECK_INTERVAL` — Leader check interval in seconds (default 3)

### Leader Election

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/multi-main-setup.ee.ts
```

Leader election uses a Redis key as a distributed lock. The key is:

```
{n8n_prefix}:main_instance_leader
```

Value is the `hostId` of the current leader.

Election algorithm:
1. On startup, call `tryBecomeLeader()` immediately (no initial wait).
2. Every `interval` seconds, call `checkLeader()`.
3. `tryBecomeLeader()` uses Redis `SET key value EX ttl NX` — only succeeds if key doesn't exist.
4. If leader, call `EXPIRE key ttl` on every check to renew the lease.
5. If the leader key disappears (TTL expires without renewal), any follower can take over.

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/multi-main-setup.ee.ts:124-143
private async tryBecomeLeader() {
    const keySetSuccessfully = await this.publisher.setIfNotExists(
        this.leaderKey, hostId, this.leaderKeyTtl
    );
    if (keySetSuccessfully) {
        this.instanceSettings.markAsLeader();
        this.emit('leader-takeover');
    } else {
        this.instanceSettings.markAsFollower();
    }
}
```

### Leader-Exclusive Responsibilities

Controlled via `@OnLeaderTakeover()` and `@OnLeaderStepdown()` decorators. Only the leader instance runs:

- **Queue recovery** — `ScalingService.scheduleQueueRecovery()` / `stopQueueRecovery()`
- **Wait tracker** — `WaitTracker.startTracking()` — polls DB for waiting executions and re-enqueues them
- **Execution pruning** — `ExecutionsPruningService` (only leader runs pruning)
- **License renewal** — handled by the leader
- **Workflow activation/deactivation** — triggers and pollers only run on leader; pubsub commands `add-webhooks-triggers-and-pollers` / `remove-triggers-and-pollers` are broadcast to all mains so all can register the webhook URL routes

---

## Push / Real-Time Delivery in HA Mode

The push system uses either WebSocket or SSE (configured via `N8N_PUSH_BACKEND`, default `websocket`).

### Push Relay Mechanism

When an execution runs on a worker, the worker has no WebSocket connection to any browser. The solution uses the `relay-execution-lifecycle-event` pubsub command:

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/push/index.ts:207-255
```

**Decision logic:**

```typescript
private shouldRelayViaPubSub(pushRef: string) {
    const { isWorker, isMultiMain } = this.instanceSettings;
    return isWorker || (isMultiMain && !this.hasPushRef(pushRef));
}
```

**Step-by-step push delivery in queue mode:**

1. Worker executes a node and calls `hookFunctionsPush` → `pushInstance.send(msg, pushRef)`.
2. `Push.send()` checks `shouldRelayViaPubSub(pushRef)`.
3. Since `isWorker === true`, it calls `relayViaPubSub()`.
4. `relayViaPubSub()` calls `publisher.publishCommand({ command: 'relay-execution-lifecycle-event', payload: { ...pushMsg, pushRef, asBinary } })`.
5. All main instances (and webhook instances) receive this pubsub message via their `Subscriber`.
6. The `@OnPubSubEvent('relay-execution-lifecycle-event', { instanceType: 'main' })` decorator on `Push.handleRelayExecutionLifecycleEvent()` is triggered.
7. Each main checks `this.hasPushRef(pushRef)` — only the main that holds that browser session has the connection.
8. Only that main sends the WebSocket/SSE message directly to the browser.

**Large payload handling:** If a `nodeExecuteAfterData` message exceeds 5 MiB, it is dropped from the relay channel. The frontend receives the item count from the smaller `nodeExecuteAfter` message and fetches full data at execution end.

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/push/index.ts:34
const MAX_PAYLOAD_SIZE_BYTES = 5 * 1024 * 1024; // 5 MiB
```

### Lifecycle Hooks Split (queue mode)

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/execution-lifecycle/execution-lifecycle-hooks.ts
```

**Worker hooks** (`getLifecycleHooksForScalingWorker`):
- `nodeExecuteBefore`, `nodeExecuteAfter` — fire push events (relayed via pubsub)
- `workflowExecuteAfter` — saves execution to DB (`hookFunctionsSaveWorker`), triggers error workflow

**Main hooks** (`getLifecycleHooksForScalingMain`):
- `workflowExecuteBefore`, `workflowExecuteAfter` — only these two run on main
- `nodeExecuteBefore`, `nodeExecuteAfter` — explicitly cleared on main (`hooks.handlers.nodeExecuteBefore = []`)
- `workflowExecuteAfter` on main handles: deletion decisions, metadata saving, external hooks

---

## Pub/Sub Architecture

### Channels

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/constants.ts:7-14
```

Three channels:
- `n8n.commands` (`{prefix}:n8n.commands`) — main → workers, main → all mains
- `n8n.worker-response` (`{prefix}:n8n.worker-response`) — workers → main
- `n8n.mcp-relay` (`{prefix}:n8n.mcp-relay`) — main → main for MCP response routing

### Pub/Sub Subscription Differences by Instance Type

**main** subscribes to all three channels:
```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/commands/start.ts:285-302
await subscriber.subscribe(subscriber.getCommandChannel());
await subscriber.subscribe(subscriber.getWorkerResponseChannel());
await subscriber.subscribe(subscriber.getMcpRelayChannel());
```

**worker** subscribes only to commands channel:
```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/commands/worker.ts:147
await subscriber.subscribe(subscriber.getCommandChannel());
```

**webhook** subscribes only to commands channel:
```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/commands/webhook.ts:111
await subscriber.subscribe(subscriber.getCommandChannel());
```

### Commands (main → workers/all mains)

Full list from pubsub event map:

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/pubsub/pubsub.event-map.ts
```

| Command | Purpose |
|---|---|
| `reload-license` | Reload license after update |
| `restart-event-bus` | Restart log streaming event bus |
| `reload-external-secrets-providers` | Re-read secrets provider config |
| `reload-overwrite-credentials` | Reload credential overwrite config |
| `reload-oidc-config` | Reload OIDC SSO config |
| `reload-saml-config` | Reload SAML SSO config |
| `reload-sso-provisioning-configuration` | Reload SSO provisioning config |
| `reload-source-control-config` | Reload source control config |
| `community-package-install/update/uninstall` | Sync community package state |
| `get-worker-id` | Request worker ID for status display |
| `get-worker-status` | Request worker status for UI display |
| `add-webhooks-triggers-and-pollers` | Activate workflow on all mains (multi-main) |
| `remove-triggers-and-pollers` | Deactivate workflow on all mains (multi-main) |
| `display-workflow-activation/deactivation` | Update UI state (multi-main) |
| `relay-execution-lifecycle-event` | Push WS event to correct main (HA push relay) |
| `relay-chat-stream-event` | Relay AI chat streaming events (multi-main) |
| `relay-chat-human-message` | Relay chat human message events (multi-main) |
| `relay-chat-message-edit` | Relay message edit events (multi-main) |
| `clear-test-webhooks` | Remove test webhook registrations |
| `cancel-test-run` | Cancel test run across all mains |

### Debouncing

Messages with `debounce: true` are handled through a lodash `debounce(fn, 300)` on the subscriber side. Commands in `IMMEDIATE_COMMANDS` skip debouncing:

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/constants.ts:28-34
export const IMMEDIATE_COMMANDS = new Set([
    'add-webhooks-triggers-and-pollers',
    'remove-triggers-and-pollers',
    'relay-execution-lifecycle-event',
    'relay-chat-stream-event',
    'cancel-test-run',
]);
```

### Self-Send Commands

Some commands must also be processed by the sender (e.g., workflow activation changes that must apply to the activating main too):

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/constants.ts:19-23
export const SELF_SEND_COMMANDS = new Set([
    'add-webhooks-triggers-and-pollers',
    'remove-triggers-and-pollers',
]);
```

---

## Redis Usage Map

### Redis Clients Created

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/redis/redis.types.ts
```

| Client label | Created by | Purpose |
|---|---|---|
| `subscriber(n8n)` | Subscriber service | Listen to pubsub channels |
| `publisher(n8n)` | Publisher service | Publish to pubsub channels, leader key operations |
| `cache(n8n)` | CacheService | Application-level caching |
| `subscriber(bull)` | Bull internal | Bull queue event listening |
| `client(bull)` | Bull internal | General Bull queue operations |
| `bclient(bull)` | Bull internal | Blocking dequeue operations (job pickup) |

### Redis Key Patterns

| Key Pattern | Purpose | TTL / Durability |
|---|---|---|
| `{bull_prefix}:jobs:*` | Bull queue job data | Ephemeral — removed on complete/fail via `removeOnComplete/removeOnFail` |
| `{bull_prefix}:jobs:active` | Bull active job list | Ephemeral |
| `{bull_prefix}:jobs:waiting` | Bull waiting job list | Ephemeral |
| `{bull_prefix}:jobs:failed` | Bull failed job list | Ephemeral (removeOnFail) |
| `{n8n_prefix}:main_instance_leader` | Leader election key | TTL = `N8N_MULTI_MAIN_SETUP_KEY_TTL` (default 10s) — ephemeral |
| `{n8n_prefix}:cache:*` | Application cache (resource ownership, variables, node types) | TTL = `N8N_CACHE_REDIS_TTL` (default 1 hour) |
| `{n8n_prefix}:mcp-session:{sessionId}` | MCP session state | TTL = 86400s (24h) |
| `n8n.commands` channel | Pubsub — main → workers | N/A (channel, not key) |
| `n8n.worker-response` channel | Pubsub — workers → main | N/A (channel, not key) |
| `n8n.mcp-relay` channel | Pubsub — main → main for MCP | N/A (channel, not key) |

**Note:** The actual key prefix used for Bull is set by `QUEUE_BULL_PREFIX` (default `bull`). The n8n application prefix is `N8N_REDIS_KEY_PREFIX` (default `n8n`). Cache prefix adds `N8N_CACHE_REDIS_KEY_PREFIX` (default `cache`).

### Cache Backend Selection

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/services/cache/cache.service.ts:35-36
const useRedis = backend === 'redis' || (backend === 'auto' && mode === 'queue');
```

In queue mode with `N8N_CACHE_BACKEND=auto` (the default), Redis is used for caching, ensuring all main instances share the same cache.

### Redis Connection Config

```
/Users/ib/prj-other/n0n/n8n/packages/@n8n/config/src/configs/scaling-mode.config.ts
```

Key env vars:
- `QUEUE_BULL_REDIS_HOST` / `QUEUE_BULL_REDIS_PORT` — Redis connection
- `QUEUE_BULL_REDIS_TLS` — enable TLS
- `QUEUE_BULL_REDIS_CLUSTER_NODES` — comma-separated `host:port` for cluster mode
- `QUEUE_BULL_REDIS_TIMEOUT_THRESHOLD` — max cumulative reconnect time before process exit (default 10s)
- `enableReadyCheck: false` — disabled to allow fast reconnection after Redis restart

---

## Scheduled / Cron Jobs

### Workflow Cron Triggers

Cron-triggered workflows are activated via the `ActiveWorkflowManager`. In queue mode, **only the leader main** activates triggers and pollers. When a workflow is activated or deactivated, the leader broadcasts:

```
publisher.publishCommand({ command: 'add-webhooks-triggers-and-pollers', payload: { workflowId, ... } })
```

This command has `selfSend: true`, so all mains (including the sender) register the webhook HTTP routes. However, only the leader runs the cron scheduler.

In multi-main mode, if leadership changes, the `@OnLeaderStepdown()` hook stops all triggers on the outgoing leader, and `@OnLeaderTakeover()` starts them on the new leader.

### Wait Tracker (Resume After Wait)

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/wait-tracker.ts:47-55
@OnLeaderTakeover()
private startTracking() {
    this.mainTimer = setInterval(() => {
        void this.getWaitingExecutions();
    }, 60000);
    void this.getWaitingExecutions();
}
```

Only the leader polls the DB every 60 seconds for executions in `waiting` status and re-runs them when their `waitTill` time arrives.

### Queue Recovery (Crash Detection)

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/scaling.service.ts:575-640
```

Only the leader runs queue recovery (guarded by `@OnLeaderTakeover()` / `@OnLeaderStepdown()`):
- Interval: every `N8N_EXECUTIONS_QUEUE_RECOVERY_INTERVAL` minutes (default 180 minutes = 3 hours).
- Batch size: `N8N_EXECUTIONS_QUEUE_RECOVERY_BATCH` (default 100).
- Finds executions in DB with status `new` or `running` but not present in the Bull queue.
- Marks those executions as `crashed`.
- If the batch was full (all 100 used), next check is scheduled at half the interval.

---

## Graceful Shutdown

### Shutdown Service

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/shutdown/shutdown.service.ts
```

`ShutdownService` collects all `@OnShutdown(priority)` decorated methods and runs them in reverse priority order. All handlers at the same priority run concurrently via `Promise.allSettled()`.

The `HIGHEST_SHUTDOWN_PRIORITY` is assigned to `ScalingService.stop()`:

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/scaling.service.ts:163
@OnShutdown(HIGHEST_SHUTDOWN_PRIORITY)
async stop() { ... }
```

### Worker Shutdown Sequence

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/scaling.service.ts:183-197
private async stopWorker() {
    await this.pauseQueue();  // Bull queue.pause(true, true) — no new jobs accepted or picked up

    while (this.getRunningJobsCount() !== 0) {
        // logs every 4 iterations (every ~2 seconds)
        await sleep(500);
    }
}
```

1. Queue is paused — no new jobs will be picked up.
2. Worker polls every 500ms waiting for all in-progress jobs to complete.
3. No maximum wait imposed by `stopWorker()` itself. The overall process timeout is controlled by `N8N_GRACEFUL_SHUTDOWN_TIMEOUT` (env var) or the deprecated `QUEUE_WORKER_TIMEOUT` (default 30s).

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/commands/worker.ts:75-82
const { QUEUE_WORKER_TIMEOUT } = process.env;
if (QUEUE_WORKER_TIMEOUT) {
    this.gracefulShutdownTimeoutInS =
        parseInt(QUEUE_WORKER_TIMEOUT, 10) || this.globalConfig.queue.bull.gracefulShutdownTimeout;
}
```

### Main Shutdown Sequence (queue mode)

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/commands/start.ts:84-117
async stopProcess() {
    this.activeWorkflowManager.removeAllQueuedWorkflowActivations();
    Container.get(WaitTracker).stopTracking();
    await this.externalHooks?.run('n8n.stop');
    await this.activeWorkflowManager.removeAllTriggerAndPollerBasedWorkflows();
    if (this.instanceSettings.isMultiMain) {
        await Container.get(MultiMainSetup).shutdown();  // clears leader key
    }
    if (this.globalConfig.executions.mode === 'queue') {
        Container.get(Publisher).shutdown();
        Container.get(Subscriber).shutdown();
    }
    Container.get(EventService).emit('instance-stopped');
    await Container.get(ActiveExecutions).shutdown();
    await Container.get(MessageEventBus).close();
}
```

When a multi-main leader shuts down, it deletes the leader key in Redis, allowing immediate leader election by other instances:

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/multi-main-setup.ee.ts:63-69
async shutdown() {
    clearInterval(this.leaderCheckInterval);
    const { isLeader } = this.instanceSettings;
    if (isLeader) await this.publisher.clear(this.leaderKey);
}
```

### Single Main Shutdown (queue mode)

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/scaling.service.ts:176-181
private async stopMain() {
    if (this.instanceSettings.isSingleMain) await this.pauseQueue();
    // only single main pauses the queue — multi-main does not
    if (this.queueRecoveryContext.timeout) this.stopQueueRecovery();
    if (this.isQueueMetricsEnabled) this.stopQueueMetrics();
}
```

A single main process pauses the Bull queue on shutdown so workers stop picking up new jobs. In multi-main mode, the queue is not paused because other mains continue running.

---

## Failure Recovery

### Worker Crash Mid-Execution

Bull's stall detection is disabled (`maxStalledCount: 0`):

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/scaling.service.ts:73
settings: { ...this.globalConfig.queue.bull.settings, maxStalledCount: 0 }
```

This means Bull will NOT automatically re-queue a stalled job. Instead, n8n's own queue recovery handles this:

- Queue recovery (leader-only, runs every 3 hours by default) finds executions with DB status `new`/`running` but no matching active/waiting job in Bull.
- Marks those executions as `crashed` in the DB.
- The user sees the execution as crashed in the UI.

### Main Crash with Active Jobs

The `job.finished()` promise on main will reject with a timeout or connection error. The execution remains in `running` status until the next queue recovery cycle marks it `crashed`.

### Dead Letter Queue

There is no explicit dead letter queue. Jobs are removed from Redis on both completion and failure (`removeOnComplete: true`, `removeOnFail: true`). Failed jobs are captured via the `global:failed` Bull event for metrics counting only.

### Crash Journal

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/crash-journal.ts (referenced in base-command.ts:192)
```

On startup, a crash journal is initialized. If a previous startup crashed without cleanup, the journal helps detect and recover.

### Job Processing Errors

When an unhandled exception occurs inside `processJob`:

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/scaling.service.ts:139-161
private async reportJobProcessingError(error: Error, job: Job) {
    // sends job-failed progress message to main
    const msg: JobFailedMessage = { kind: 'job-failed', ... };
    await job.progress(msg);
    this.errorReporter.error(error, { executionId });
    throw error;  // causes Bull to mark job as failed
}
```

Main receives `job-failed` message and logs the error. The `job.finished()` promise on main rejects.

### Redis Connection Loss

```
/Users/ib/prj-other/n0n/n8n/packages/cli/src/services/redis-client.service.ts:222-247
```

If Redis becomes unavailable:
1. Each retry attempt increments a cumulative timeout counter.
2. If cumulative timeout exceeds `QUEUE_BULL_REDIS_TIMEOUT_THRESHOLD` (default 10s), the process calls `process.exit(1)`.
3. Workers detect this differently: a `Error initializing Lua scripts` error causes immediate `process.exit(1)` even before the timeout.

---

## Multi-Instance Topology

```
                           Internet
                              │
                    ┌─────────▼──────────┐
                    │   Load Balancer /  │
                    │   Reverse Proxy    │
                    └───────┬────┬───────┘
                            │    │
               ┌────────────▼┐  ┌▼────────────┐
               │  Main #1    │  │  Main #2    │
               │  (leader)   │  │  (follower) │
               │  - REST API │  │  - REST API │
               │  - WebSocket│  │  - WebSocket│
               │  - triggers │  │             │
               │  - pruning  │  │             │
               └─────┬──┬────┘  └─────┬──┬───┘
                     │  │             │  │
                     │  └──────┬──────┘  │
                     │         │         │
              ┌──────▼─────────▼─────────▼──────┐
              │              Redis               │
              │  - Bull queue (jobs)             │
              │  - Pubsub channels               │
              │  - Leader election key           │
              │  - Application cache             │
              │  - MCP session store             │
              └──────────────┬───────────────────┘
                             │
              ┌──────────────┼───────────────┐
              │              │               │
     ┌────────▼──────┐ ┌─────▼──────┐ ┌─────▼──────┐
     │  Worker #1    │ │  Worker #2 │ │  Worker #3 │
     │  concurrency: │ │concurrency:│ │concurrency:│
     │  10 jobs max  │ │10 jobs max │ │10 jobs max │
     └───────┬───────┘ └─────┬──────┘ └─────┬──────┘
             │               │              │
     ┌───────▼───────────────▼──────────────▼──────┐
     │                PostgreSQL                   │
     │  - Execution records                        │
     │  - Workflow definitions                     │
     │  - Credentials                              │
     └─────────────────────────────────────────────┘
```

**Communication paths:**
- Browser → Main (REST API + WebSocket)
- Main → Redis (publish command, enqueue job, cache)
- Worker → Redis (dequeue job, publish worker-response)
- Redis → Main (pubsub events, job progress events)
- Redis → Worker (pubsub commands, job assignments)
- All processes → PostgreSQL (read/write execution data)

---

## Scaling Knobs

### What Can Be Scaled Independently

**Web servers (main):** Can run multiple main instances with `N8N_MULTI_MAIN_SETUP_ENABLED=true`. Each instance handles HTTP/WebSocket traffic. Only one instance is leader at a time.

**Workers:** Can run any number of worker processes. Each worker has a `--concurrency` flag (default 10). Total throughput = number of workers × concurrency per worker. Workers are completely stateless and interchangeable.

**Webhook processors:** Can run dedicated `n8n webhook` processes to separate webhook intake from the main UI process.

### Performance Bottlenecks

1. **Redis throughput:** All inter-process communication goes through Redis. High job rates or large pubsub messages (up to 5 MiB) will stress Redis.

2. **PostgreSQL write throughput:** Every job completion writes execution data. In high-throughput scenarios, the `execution_data` table becomes the bottleneck.

3. **Queue recovery interval:** Default 3 hours means crashed executions are marked `crashed` up to 3 hours after the fact. Reduce `N8N_EXECUTIONS_QUEUE_RECOVERY_INTERVAL` for faster detection.

4. **Bull job data in Redis:** With `removeOnComplete: true` and `removeOnFail: true`, data does not accumulate. Bull maintains only active/waiting job lists.

5. **Concurrency control:** In regular mode (not queue), `ConcurrencyControlService` limits concurrent executions. In queue mode, concurrency control is disabled at the main level — it is handled entirely by worker `--concurrency`.

### Key Config Env Vars for Scaling

| Env Var | Default | Purpose |
|---|---|---|
| `EXECUTIONS_MODE` | `regular` | Must be `queue` to enable scaling |
| `N8N_CONCURRENCY_PRODUCTION_LIMIT` | `-1` | Worker concurrency (overrides `--concurrency` flag if set) |
| `QUEUE_BULL_REDIS_HOST` | `localhost` | Redis host |
| `QUEUE_BULL_REDIS_CLUSTER_NODES` | `''` | Enable Redis cluster mode |
| `QUEUE_BULL_PREFIX` | `bull` | Key prefix for Bull in Redis |
| `N8N_REDIS_KEY_PREFIX` | `n8n` | Key prefix for n8n application keys |
| `N8N_MULTI_MAIN_SETUP_ENABLED` | `false` | Enable multi-main |
| `N8N_MULTI_MAIN_SETUP_KEY_TTL` | `10` | Leader key TTL in seconds |
| `N8N_MULTI_MAIN_SETUP_CHECK_INTERVAL` | `3` | Leader check interval in seconds |
| `N8N_EXECUTIONS_QUEUE_RECOVERY_INTERVAL` | `180` | Queue recovery interval in minutes |
| `N8N_GRACEFUL_SHUTDOWN_TIMEOUT` | (varies) | Max time to wait for in-progress executions on shutdown |
| `QUEUE_HEALTH_CHECK_ACTIVE` | `false` | Enable worker health endpoints |
| `QUEUE_HEALTH_CHECK_PORT` | `5678` | Worker health endpoint port |

---

## Key Files

| File | Description |
|---|---|
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/scaling.service.ts` | Central queue manager: creates Bull queue, enqueues jobs, registers listeners, orchestrates worker, runs queue metrics and recovery |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/job-processor.ts` | Worker-side job execution: loads execution from DB, runs workflow, sends progress messages back to main |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/scaling.types.ts` | All TypeScript types for the queue system: `JobData`, `JobMessage` union, `JobFinishedProps`, `QueueRecoveryContext` |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/constants.ts` | Queue name, pub/sub channel names, self-send and immediate command sets |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/multi-main-setup.ee.ts` | Leader election implementation using Redis `SET NX EX`; emits `leader-takeover` / `leader-stepdown` events |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/pubsub/publisher.service.ts` | Publishes to all three pubsub channels; also houses Redis utility methods for multi-main (setIfNotExists, setExpiration, etc.) |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/pubsub/subscriber.service.ts` | Subscribes to pubsub channels; routes messages to `PubSubEventBus`; handles debounce logic and message filtering by target |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/pubsub/pubsub.event-map.ts` | Complete type-safe map of all pubsub commands and worker responses |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/pubsub/pubsub.registry.ts` | Registers `@OnPubSubEvent()` decorated methods from all services with the `PubSubEventBus` |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/push/index.ts` | Push service: manages browser connections, decides when to relay via pubsub vs. direct send, handles `relay-execution-lifecycle-event` |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/workflow-runner.ts` | Decides whether to run execution in-process or enqueue it; in queue mode creates the Bull job and awaits `job.finished()` |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/execution-lifecycle/execution-lifecycle-hooks.ts` | Defines hook sets for different execution contexts: `getLifecycleHooksForScalingWorker`, `getLifecycleHooksForScalingMain`, `getLifecycleHooksForRegularMain` |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/commands/worker.ts` | Worker process entry point: sets concurrency, calls `setupQueue` + `setupWorker`, starts `WorkerServer` |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/commands/start.ts` | Main process entry point: initializes orchestration, conditionally starts multi-main leader election, sets up `ActiveWorkflowManager` |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/commands/webhook.ts` | Webhook process entry point: queue mode only, enqueues jobs from incoming webhooks, no UI |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/services/redis-client.service.ts` | Creates all ioredis clients with shared retry strategy; handles Redis cluster support; exits process if reconnection timeout exceeded |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/active-executions.ts` | Tracks in-process executions on the current instance; handles response promises for webhook executions; drives graceful shutdown wait |
| `/Users/ib/prj-other/n0n/n8n/packages/@n8n/config/src/configs/scaling-mode.config.ts` | All queue/Bull/Redis config env vars: host, port, TLS, cluster, lock duration, stall interval, health check |
| `/Users/ib/prj-other/n0n/n8n/packages/@n8n/config/src/configs/multi-main-setup.config.ts` | Multi-main config: enable flag, leader key TTL, check interval |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/shutdown/shutdown.service.ts` | Orchestrates graceful shutdown: runs all `@OnShutdown()` handlers in priority order |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/worker-server.ts` | Lightweight HTTP server on workers: health/readiness probes, Prometheus metrics, credentials overwrites endpoint |
