# Job Queue / Task Processing System — Stack Research

Research date: 2026-02-27

## Context

n0n is a workflow automation platform (n8n replica) running on Bun. Requirements:

- Distributed job processing (main server dispatches, workers consume)
- Job priority (webhook-triggered = priority 50, scheduled = priority 100)
- Concurrency control (limit parallel executions per worker, default 10)
- Job progress reporting (worker sends node execution progress to main via `job.progress()`)
- Graceful shutdown (pause queue, wait for running jobs to finish)
- Failure recovery (detect crashed jobs, mark as failed)
- Redis-backed (already using Redis for pub/sub, cache, leader election)
- Leader election for multi-instance deployments

n8n uses Bull (not BullMQ). n0n's architecture doc specifies BullMQ but it's not yet implemented.

---

## 1. BullMQ (Current Choice)

**What it is:** Modern TypeScript rewrite of Bull by Taskforce.sh. Redis-backed job queue.

**Latest version:** 5.50+ (actively maintained, frequent releases throughout 2025-2026)

**Bun compatibility:** Officially listed as supported runtime. Works for both producers and consumers. Minor edge case: ioredis under Bun may aggressively scale connections to the pool max immediately rather than gradually. Not a practical issue.

### Feature Assessment

| Feature | Support | Notes |
|---|---|---|
| Job priority | Yes | Numeric scale, lower = higher priority. `queue.add('job', data, { priority: 50 })` |
| Concurrency | Yes | Per-worker setting, recommended 100-300 for IO-bound. `new Worker(name, fn, { concurrency: 10 })` |
| Progress reporting | Yes | `job.updateProgress(data)` + QueueEvents listener. Stored in Redis per-job key |
| Delayed jobs | Yes | `{ delay: 5000 }` or cron-like repeatable jobs |
| Retries | Yes | Configurable exponential backoff |
| Stalled job detection | Yes | Lock-based. Worker renews lock periodically. `stalledInterval` default 30s. `maxStalledCount` configurable |
| Rate limiting | Yes | Per-queue and per-group |
| Job dependencies | Yes | Parent-child relationships with unlimited nesting |
| Deduplication | Yes | Built-in |
| Graceful shutdown | Yes | `worker.close()` waits for active jobs |

### Performance

Benchmarks on M1 Max (single machine):
- Zero-work jobs: ~27,200 jobs/sec at concurrency 100
- 10ms-work jobs: ~8,300 jobs/sec at concurrency 100

These numbers far exceed what a workflow automation platform needs. Even at scale, individual workflow executions take seconds to minutes, not milliseconds.

### Operational Requirements

- Redis instance (standalone or cluster)
- ioredis as client library
- Bull Board available for monitoring UI
- No additional infrastructure beyond Redis

### Community

- 7,000+ GitHub stars
- 50,000+ dependent projects
- Active releases throughout 2025-2026
- NestJS integration (@nestjs/bullmq)
- Comprehensive documentation

### Verdict

Mature, battle-tested, Bun-compatible, feature-complete for our use case. The standard choice in the JS ecosystem.

---

## 2. Bull (n8n's Choice)

**What it is:** Original job queue library by OptimalBits. Predecessor to BullMQ.

**Status:** Maintenance mode. Bug fixes only, no new features.

**Why n8n still uses it:** Migration cost. Bull works, n8n has extensive integration code around it, and rewriting for BullMQ gains them little. n8n also disables Bull's built-in stall recovery (`maxStalledCount: 0`) and implements its own crash detection via periodic DB reconciliation.

### Key Differences from BullMQ

| Aspect | Bull | BullMQ |
|---|---|---|
| Language | JavaScript | TypeScript |
| Maintenance | Bug fixes only | Active development |
| Job dependencies | No | Yes (parent-child flows) |
| Group rate limiting | No | Yes |
| Deduplication | No | Yes |
| Sandboxed processors | Yes | Yes |
| API design | Callback-heavy, older patterns | Promise/async-first, cleaner API |

### Verdict

No reason to choose Bull for a new project. BullMQ is strictly better. The only reason n8n uses Bull is historical inertia.

---

## 3. Bun-Native Alternatives

### BunQueue

**What it is:** Job queue built specifically for Bun, using SQLite (not Redis) as the backing store. 16 SQLite shards for parallelism.

**GitHub:** github.com/egeominotti/bunqueue

**Benchmarks (M1 Max):**
- Batch push: 1.2M ops/sec
- Processing (16 workers): 494K ops/sec
- 1M jobs processed in under 3 seconds

**Features:** Delayed jobs, retries with exponential backoff, job priorities, concurrent workers, MCP support.

**Limitations:**
- **Single-instance only.** SQLite file-locking means all workers must share the same filesystem. No distributed processing across network boundaries.
- **No progress reporting mechanism** documented.
- **No stalled job detection** comparable to BullMQ's lock-based system.
- **Very new.** Minimal production usage. No monitoring tools like Bull Board.
- **No pub/sub.** We'd still need Redis for leader election, push relay, and inter-instance communication.

### Trigger.dev / Inngest

SaaS platforms that support Bun as a deployment target. Not self-hosted libraries. Not applicable for n0n.

### Verdict

BunQueue is impressive for single-instance scenarios but fundamentally incompatible with our distributed architecture (separate main server + worker processes on different machines). We'd still need Redis for everything else. Eliminates the primary advantage of going Redis-free.

---

## 4. PostgreSQL-Based Queues

### Graphile Worker

**What it is:** PostgreSQL-only job queue using `SKIP LOCKED` for efficient job retrieval.

**Performance:** 10,000+ jobs/sec per documentation.

**Features:**
- Job priorities
- Cron scheduling
- Configurable concurrency (connection pool based)
- Jobs can be created inside DB transactions (atomic with business logic)
- Automatic cleanup of completed jobs

**Bun compatibility:** Uses standard `pg` driver. Should work with Bun but not explicitly tested/documented.

### pg-boss

**What it is:** PostgreSQL job queue with Node.js. Latest version 12.13.0 (actively maintained).

**Features:**
- Priority queues
- Dead letter queues
- Delayed/deferred jobs
- Exponential backoff retries
- Pub/sub API for fan-out
- Cron scheduling
- FIFO storage policies

**Bun compatibility:** Uses `pg` driver. Should work but not explicitly tested.

### Shared Limitations of PG-Based Queues

1. **Still need Redis.** n0n uses Redis for pub/sub (push relay between workers and mains), leader election, and application cache. Switching the job queue to PG doesn't eliminate Redis from the stack.

2. **Table bloat management.** PostgreSQL job tables need periodic VACUUM and careful management of completed/failed jobs. Redis handles this via key expiration automatically.

3. **Lower throughput for individual job consumption.** BullMQ achieves ~5x higher throughput than PG-based queues for per-job processing (BullMQ benchmarks vs Oban/PG benchmarks).

4. **Progress reporting is clunky.** Must poll the database or use PG LISTEN/NOTIFY (which doesn't persist messages if the listener is disconnected). BullMQ's progress events over Redis are more natural.

5. **Connection pool pressure.** Each concurrent consumer holds a database connection. With multiple workers at concurrency 10, that's significant connection pool consumption on a shared PostgreSQL instance that also serves the application.

### Verdict

Would make sense if we didn't already need Redis. Since we need Redis for pub/sub, leader election, and caching regardless, adding a PG queue only adds complexity without removing infrastructure. If we ever drop Redis entirely (unlikely given the pub/sub requirements), revisit pg-boss.

---

## 5. Temporal.io

**What it is:** Workflow orchestration engine. Not a job queue -- it's a full workflow runtime with durable execution, event sourcing, and sophisticated failure handling.

**Bun compatibility: BROKEN.** Temporal TypeScript SDK workers hang indefinitely on Bun due to V8 promise hook differences (Bun uses JavaScriptCore, not V8). Temporal team has stated it's "too early" to support Bun. Client-side operations work but workers (the critical part) do not.

**Architecture:** Requires a dedicated Temporal server cluster with its own database (Cassandra, MySQL, or PostgreSQL). Massive operational overhead compared to a Redis-backed queue.

**Fit assessment:** Even if Bun were supported, Temporal is designed for orchestrating long-running business processes with complex state machines. n0n's workflow engine already handles orchestration (stack-based executor with `ExecutionHooks`). We need a job *dispatch* mechanism, not a workflow *runtime*. Using Temporal would mean replacing our engine entirely, which is out of scope.

### Verdict

Wrong tool. Doesn't work with Bun. Massive operational overhead. Our engine already handles workflow orchestration; we just need job dispatch.

---

## 6. Redis Streams

**What it is:** Redis's built-in append-only log data structure with consumer groups. XADD/XREAD/XREADGROUP/XACK commands.

**Features:**
- Ordered, persistent message log
- Consumer groups with at-least-once delivery
- Acknowledgment tracking (detect unprocessed messages)
- Message replay from any point

**What's missing (that you'd need to build yourself):**
- Job priority (streams maintain insertion order, not priority order)
- Concurrency control per consumer
- Delayed/scheduled jobs
- Progress reporting
- Retry logic with backoff
- Stalled job detection
- Monitoring UI

### Assessment

Redis Streams are a message delivery primitive, not a job queue. BullMQ internally uses Redis lists, sorted sets, and Lua scripts to implement all the job queue semantics on top of Redis. Building equivalent functionality on top of Streams would essentially mean writing your own BullMQ. The only advantage would be using a "purer" Redis primitive, but that's not worth months of development and testing.

### Verdict

Too low-level. BullMQ already abstracts Redis operations correctly. No reason to reimplement.

---

## 7. Newer Queue Systems (2025-2026)

### QStash (Upstash)

Serverless HTTP-based message queue. Not self-hosted. SaaS dependency.

### Diques

GitHub project for distributed queues. Early stage, minimal adoption.

### Bee-Queue

Simpler Redis-backed queue. Less feature-rich than BullMQ, maintenance mode. No advantages over BullMQ.

### Nothing Notable

No significant new self-hosted job queue library has emerged in 2025-2026 that challenges BullMQ's position for Redis-backed distributed job processing. The ecosystem has settled around BullMQ as the standard.

---

## Comparison Matrix

| Criteria | BullMQ | Bull | BunQueue | pg-boss | Graphile Worker | Temporal | Redis Streams |
|---|---|---|---|---|---|---|---|
| Bun compatible | Yes | Yes | Yes (native) | Likely | Likely | **No** (workers) | Yes |
| Job priority | Yes | Yes | Yes | Yes | Yes | N/A | **No** (FIFO only) |
| Concurrency control | Yes (per-worker) | Yes | Yes | Yes (pool-based) | Yes (pool-based) | Yes | Manual |
| Progress reporting | Yes (native) | Yes (native) | No | Poll-based | Poll-based | Yes | Manual |
| Stalled job detection | Yes (lock-based) | Yes (lock-based) | No | Timeout-based | Timeout-based | Yes | XPENDING |
| Distributed workers | Yes | Yes | **No** (SQLite) | Yes | Yes | Yes | Yes |
| Monitoring UI | Bull Board | Bull Board | No | No | No | Temporal UI | No |
| Infra required | Redis | Redis | None (SQLite) | PostgreSQL | PostgreSQL | Temporal cluster | Redis |
| Eliminates Redis? | No | No | Yes | **No** (still need for pubsub) | **No** | No | No |
| Maturity | High | High (legacy) | Low | Medium | Medium | High | N/A (primitive) |
| TypeScript | Native | No (DefinitelyTyped) | Native | Yes | Yes | Yes | N/A |
| npm weekly downloads | ~600K+ | ~800K+ (legacy) | Minimal | ~50K+ | ~20K+ | ~100K+ | N/A |

---

## Recommendation: Stay with BullMQ

### Rationale

1. **Best feature match.** BullMQ covers every requirement: priorities, concurrency, progress reporting, stalled job detection, graceful shutdown, distributed workers. No gaps.

2. **Bun-compatible.** Officially supported. Known to work.

3. **Redis is already required.** n0n needs Redis for pub/sub (push relay from workers to main), leader election (`SET NX EX`), and application cache. The job queue is one more Redis use case, not an additional infrastructure dependency.

4. **n8n architecture maps directly.** The entire scaling architecture we documented from n8n (08-queue-scaling.md) translates 1:1 to BullMQ with better APIs. Bull's `queue.process(type, concurrency, handler)` becomes BullMQ's `new Worker(name, handler, { concurrency })`. Bull's `job.progress(data)` becomes BullMQ's `job.updateProgress(data)`. The migration from n8n's patterns is mechanical.

5. **Ecosystem maturity.** Bull Board for monitoring, NestJS integration patterns, extensive documentation, large community. Battle-tested at scale.

6. **No viable alternative improves our situation.**
   - PG queues don't eliminate Redis (we still need it for pub/sub).
   - BunQueue can't do distributed processing.
   - Temporal doesn't work with Bun and is architecturally wrong.
   - Raw Redis Streams means rebuilding BullMQ from scratch.
   - No new 2025-2026 library offers a compelling advantage.

### Implementation Notes

Key differences from n8n's Bull usage to leverage in our BullMQ implementation:

```typescript
// n8n (Bull):
const BullQueue = require('bull');
const queue = new BullQueue('jobs', { redis: config });
queue.process('job', concurrency, async (job) => { ... });

// n0n (BullMQ):
import { Queue, Worker, QueueEvents } from 'bullmq';
const queue = new Queue('n0n-executions', { connection: redisConfig });
const worker = new Worker('n0n-executions', async (job) => { ... }, {
  concurrency: 10,
  connection: redisConfig,
});
const queueEvents = new QueueEvents('n0n-executions', { connection: redisConfig });
```

Key BullMQ improvements over Bull that we should use:
- **Flows (parent-child jobs):** Could model sub-workflow executions as child jobs.
- **Job deduplication:** Prevent double-enqueue of the same execution.
- **Group rate limiting:** Rate-limit by workflow ID to prevent one workflow from starving others.
- **Better TypeScript types:** Native TypeScript, no `@types` needed.

Settings to match n8n's patterns:
- `removeOnComplete: true` — don't accumulate completed job data in Redis
- `removeOnFail: true` — same for failed jobs
- Use `job.updateProgress()` for worker-to-main communication (`job-finished`, `job-failed`, `respond-to-webhook` messages)
- Consider keeping `maxStalledCount: 0` and implementing our own queue recovery (DB reconciliation) like n8n does, OR use BullMQ's built-in stall recovery with `maxStalledCount: 1` for simpler operation

### What NOT to Do

- Don't use BunQueue for distributed processing. It's single-instance.
- Don't add pg-boss alongside Redis. Extra complexity for no infra reduction.
- Don't build on raw Redis Streams. That's reimplementing BullMQ.
- Don't switch to Bull (the old one). It's in maintenance mode.
- Don't evaluate Temporal until Bun worker support ships.
