# Job Queue — BullMQ

**Decision date:** 2026-02-27 | **Runtime:** Bun | **Backend:** Redis

## Choice: BullMQ

BullMQ is the modern TypeScript rewrite of Bull. Redis-backed, feature-complete distributed job queue. The standard choice in the JS ecosystem for serious job processing.

### Why BullMQ

1. **Feature-complete for our use case.** Every requirement covered: priorities, concurrency control, progress reporting, stalled job detection, delayed jobs, retries with backoff, graceful shutdown, deduplication, parent-child job flows.

2. **Bun-compatible.** Officially listed as supported runtime. Works for both producers and consumers.

3. **Redis is already required.** n0n needs Redis for pub/sub (push relay), leader election, and application cache. Job queue is one more Redis use case, not additional infrastructure.

4. **Direct mapping from n8n's architecture.** Bull's `queue.process()` → BullMQ's `new Worker()`. Bull's `job.progress()` → BullMQ's `job.updateProgress()`. The migration from n8n patterns is mechanical.

5. **Mature ecosystem.** 7K+ GitHub stars, 600K+ weekly downloads, Bull Board for monitoring UI, NestJS integration, comprehensive docs.

### Key Specs

| Metric | Value |
|--------|-------|
| Version | 5.50+ (actively maintained) |
| npm weekly | ~600K+ |
| Language | TypeScript (native) |
| Backend | Redis (ioredis) |
| Monitoring | Bull Board |

### Feature Matrix

| Feature | Support | Notes |
|---------|---------|-------|
| Job priority | Yes | Numeric scale, lower = higher. `{ priority: 50 }` |
| Concurrency | Yes | Per-worker. `{ concurrency: 10 }` |
| Progress reporting | Yes | `job.updateProgress(data)` + QueueEvents listener |
| Stalled job detection | Yes | Lock-based, configurable `stalledInterval` (default 30s) |
| Delayed jobs | Yes | `{ delay: 5000 }` or cron repeatable |
| Retries | Yes | Configurable exponential backoff |
| Job dependencies | Yes | Parent-child with unlimited nesting |
| Deduplication | Yes | Built-in |
| Rate limiting | Yes | Per-queue and per-group |
| Graceful shutdown | Yes | `worker.close()` waits for active jobs |

### Performance (M1 Max, single machine)

- Zero-work jobs: ~27,200 jobs/sec at concurrency 100
- 10ms-work jobs: ~8,300 jobs/sec at concurrency 100

Far exceeds workflow automation needs where individual executions take seconds to minutes.

### Implementation Notes for n0n

```typescript
import { Queue, Worker, QueueEvents } from 'bullmq';

const queue = new Queue('n0n-executions', { connection: redisConfig });
const worker = new Worker('n0n-executions', async (job) => { ... }, {
  concurrency: 10,
  connection: redisConfig,
});
const queueEvents = new QueueEvents('n0n-executions', { connection: redisConfig });
```

Key settings:
- `removeOnComplete: true` — don't accumulate completed job data in Redis
- `removeOnFail: true` — same for failed jobs
- `job.updateProgress()` for worker-to-main communication (job-finished, respond-to-webhook)
- Webhook-triggered jobs: priority 50 (higher). Scheduled: priority 100 (lower).
- Consider `maxStalledCount: 1` for simpler stall recovery (vs n8n's custom DB reconciliation)

BullMQ improvements over n8n's Bull to leverage:
- **Flows (parent-child jobs):** Model sub-workflow executions as child jobs
- **Deduplication:** Prevent double-enqueue of the same execution
- **Group rate limiting:** Rate-limit by workflow ID to prevent starvation

### Alternatives Considered

| Queue | Why Not |
|-------|---------|
| **Bull** | Maintenance mode. No new features. n8n only uses it due to historical inertia. |
| **BunQueue** | SQLite-backed, single-instance only. Can't do distributed processing. |
| **pg-boss** | Doesn't eliminate Redis (still needed for pub/sub). Adds PG table bloat. Lower throughput. |
| **Graphile Worker** | Same as pg-boss — still need Redis, adds complexity. |
| **Temporal** | Workers broken on Bun (V8 dependency). Massive operational overhead. Wrong tool — we need job dispatch, not workflow runtime. |
| **Redis Streams** | Too low-level. Would mean reimplementing BullMQ from scratch. |

### Sources

- [BullMQ docs](https://docs.bullmq.io)
- [BullMQ GitHub](https://github.com/taskforcesh/bullmq)
- [Bull Board](https://github.com/felixmosh/bull-board)
