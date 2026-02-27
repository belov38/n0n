# n8n Entry Points & Process Model

## Process Map

n8n is a monorepo-based workflow automation platform that supports multiple process types running independently or together. Here are all entry points and process types:

### Main Server Process

**Entry Point:** `/Users/ib/prj-other/n0n/n8n/packages/cli/bin/n8n:1-65`

The CLI entrypoint is a Node.js script that:
1. Sets NODE_CONFIG_DIR for config location
2. Validates Node.js version
3. Loads dotenv (unless in E2E tests)
4. Loads global config via `/Users/ib/prj-other/n0n/n8n/packages/cli/src/commands/start.ts:49-54` (the `@Command` decorator marks this as the default when no subcommand provided)
5. Calls CommandRegistry to execute the command

**Command Name:** `start` (default)
**Command Class:** `/Users/ib/prj-other/n0n/n8n/packages/cli/src/commands/start.ts:55`
**Description:** Starts n8n web server with Express.js, loads UI, and activates workflows

**Key Initialization Flow:**

```
start.ts:init()
  ├── Database connection (DbConnection)
  ├── Error reporter (Sentry)
  ├── Execution mode: 'regular' vs 'queue' (from EXECUTIONS_MODE)
  ├── Multi-main setup (if enabled)
  ├── License initialization
  ├── Orchestration setup (PubSub, Redis)
  ├── Binary data service
  ├── Deduplication service
  ├── External hooks
  ├── Workflow history
  └── Module registry initialization

start.ts:run()
  ├── Load settings from database
  ├── Server.start() (Express, webhooks, routes)
  ├── ActiveWorkflowManager.init() (trigger/poller workflows)
  ├── Display editor URL
  └── Listen for terminal input (e.g., 'o' to open browser)
```

**Listens On:**
- HTTP/HTTPS: `{N8N_LISTEN_ADDRESS}:{N8N_PORT}` (default: `[::]:5678`)
- WebSocket: Same host:port for push notifications
- Health check endpoint: `/{N8N_ENDPOINT_HEALTH}` (default: `/health`)

**Execution Mode:**
- `EXECUTIONS_MODE=regular` (default): Executions run in-process on main server
- `EXECUTIONS_MODE=queue`: Execution requests go to Redis queue, picked up by workers

**Process Type Identifier:** `main`

---

### Worker Process

**Entry Point:** `/Users/ib/prj-other/n0n/n8n/packages/cli/bin/n8n:11` (via `n8n worker` command)
**Command Class:** `/Users/ib/prj-other/n0n/n8n/packages/cli/src/commands/worker.ts:32`
**Description:** Dedicated process that pulls execution jobs from Redis queue and runs them

**Key Initialization Flow:**

```
worker.ts:init()
  ├── Force EXECUTIONS_MODE=queue if not already set
  ├── Crash journal initialization
  ├── Database connection
  ├── License initialization
  ├── Credentials overwrites
  ├── Binary data service
  ├── Deduplication service
  ├── External hooks
  ├── MessageEventBus (reports job results)
  ├── LogStreamingEventRelay
  ├── Orchestration setup (PubSub, Redis)
  ├── Module registry initialization
  └── Execution context hooks

worker.ts:run()
  ├── Configure Redis queue (Bull)
  ├── Configure worker concurrency
  ├── Set up job handlers
  ├── WorkerStatusService (health tracking)
  └── Keep process alive (never exits)
```

**Command Flags:**
- `--concurrency=<N>` (default: 10): How many jobs can run in parallel on this worker

**Concurrency Rules:**
- Overridable by environment variable `N8N_CONCURRENCY_PRODUCTION_LIMIT` (if not -1)
- Minimum recommended: 5
- Unlimited: Set to -1

**Redis Queue Name:** `bull` prefix (via `QUEUE_BULL_PREFIX`)

**Message Channels:**
- Subscribe to command channel: Receives stop/pause commands from main process
- Publish to worker response channel: Sends execution results back
- MCP relay channel: For ModelContextProtocol relay messages

**Health Check Endpoints (if enabled):**
- Liveness: `/{N8N_ENDPOINT_HEALTH}` (returns 200 if alive)
- Readiness: `/{N8N_ENDPOINT_HEALTH}/readiness` (returns 200 if DB and Redis connected)
- Port: `QUEUE_HEALTH_CHECK_PORT` (default: 5678)
- Address: `N8N_WORKER_SERVER_ADDRESS` (default: `::`)

**Process Type Identifier:** `worker`

---

### Webhook Process

**Entry Point:** `/Users/ib/prj-other/n0n/n8n/packages/cli/bin/n8n:50` (via `n8n webhook` command)
**Command Class:** `/Users/ib/prj-other/n0n/n8n/packages/cli/src/commands/webhook.ts:20`
**Description:** Dedicated process that handles incoming webhooks and form submissions

**Key Initialization Flow:**

```
webhook.ts:init()
  ├── Force EXECUTIONS_MODE=queue (required for webhook process)
  ├── Crash journal initialization
  ├── Validate execution mode is 'queue'
  ├── Database connection
  ├── License initialization
  ├── Orchestration setup (PubSub, Redis)
  ├── Binary data service
  ├── Deduplication service
  ├── External hooks
  ├── MessageEventBus (webhookProcessorId tracking)
  ├── LogStreamingEventRelay
  └── Module registry initialization

webhook.ts:run()
  ├── Configure Redis queue (Bull)
  ├── WebhookServer.start() (Express, webhook routes)
  └── Keep process alive (never exits)
```

**Known Issues (from webhook.ts:45-56):**
- Cannot run without queue mode (execution mode must be 'queue')
- Bug: Executions list shows crashes when no queue
- Bug: Cannot stop running jobs from webhook process without queue

**Serves Endpoints:**
- Live webhooks: `/{N8N_ENDPOINT_WEBHOOK}/*`
- Test webhooks: `/{N8N_ENDPOINT_WEBHOOK_TEST}/*`
- Forms: `/{N8N_ENDPOINT_FORM}/*`
- MCP servers: `/{N8N_ENDPOINT_MCP}/*`

**Process Type Identifier:** `webhook`

---

## Startup Sequence (Main Server - EXECUTIONS_MODE=regular)

### 1. Pre-initialization (bin/n8n: 1-65)
```
├─ Normalize OS line endings
├─ Set NODE_CONFIG_DIR
├─ Check Node.js version (>= 22.16)
├─ Disable custom inspect
├─ Load source-map-support
├─ Load reflect-metadata (for decorators)
├─ Load dotenv (from .env file or N8N_CONFIG_FILES)
└─ Load config module (populates GlobalConfig)
```

**Failure Points:**
- Node version mismatch → exits with code 1
- Invalid NODE_CONFIG_DIR → config loading fails

### 2. Container & Command Registry (bin/n8n: 60-64)
```
1. Get Container from @n8n/di
2. Get CommandRegistry from ../dist/command-registry.js
3. Parse process.argv[2] (default: 'start')
4. Execute CommandRegistry.execute()
```

### 3. Command Execution (command-registry.ts: 27-90)
```
1. Parse command name from argv[2]
2. Try to load ./commands/{name}.js
3. Load all modules via ModuleRegistry
4. Get CommandEntry from metadata
5. Parse flags with Zod schema
6. Instantiate command via Container.get(CommandClass)
7. Call command.init()
8. Call command.run()
9. Call command.finally() on completion
```

### 4. BaseCommand.init() Flow (base-command.ts: 84-100+)
```
1. DbConnection.init()
   ├─ Connects to database (SQLite or PostgreSQL)
   ├─ Checks migrations
   └─ Fails fast if DB unreachable

2. ErrorReporter.init() (Sentry)
   ├─ Sets up error tracking
   └─ Tags: instance type, release version

3. GlobalConfig loaded (already done in bin/n8n)
   ├─ Database type from DB_TYPE env var
   ├─ Execution mode from EXECUTIONS_MODE
   └─ All other configs from @Env decorators

4. License initialization (if needed)

5. Binary data service (for storing outputs)

6. Data deduplication service

7. External hooks registration

8. Event bus initialization

9. Module system initialization
   ├─ Community packages (if needsCommunityPackages=true)
   └─ Task runners (if needsTaskRunner=true)
```

**Failure Points (fail fast):**
- Cannot connect to database → `Error: Database connection failed`
- Database not migrated → Application waits with `/health/readiness → 503`
- License validation fails → Throws `FeatureNotLicensedError`
- Redis not available (if queue mode) → Queue fails to initialize

### 5. Start.init() Specific Flow (start.ts: 189-278)
```
1. Crash journal for graceful shutdown tracking
2. Execution mode check
   ├─ If 'regular': Mark as leader
   ├─ If 'queue': Init orchestration (Redis/PubSub)

3. Multi-main setup (if enabled)
   ├─ Requires license: LICENSE_FEATURES.MULTIPLE_MAIN_INSTANCES
   ├─ Leader election via Postgres advisory locks
   └─ Event handler registration

4. Auth roles initialization (main only)
   ├─ Syncs roles/scopes from database
   └─ Serialized with Postgres transactions

5. Wait tracker initialization

6. Credentials overwrites

7. Workflow history setup

8. Test runner cleanup

9. Generate static assets (index.html, JS, CSS)
   ├─ Reads from EDITOR_UI_DIST_DIR
   ├─ Injects config meta tags (base64 encoded)
   ├─ Replaces {{BASE_PATH}} placeholders
   └─ Replaces {{REST_ENDPOINT}} in index.html

10. Module initialization
    ├─ Extensions registered
    └─ Custom nodes loaded

11. AuthHandlerRegistry initialization

12. Metrics setup (if multi-main)

13. Execution context hooks registration
```

### 6. Server Initialization (abstract-server.ts: 157-214)
```
1. Create HTTP/HTTPS server
   ├─ If HTTPS: Read N8N_SSL_KEY and N8N_SSL_CERT
   ├─ Create express.Application
   └─ Add error handlers for EADDRINUSE, EACCES, EAFNOSUPPORT

2. Bind to {N8N_LISTEN_ADDRESS}:{N8N_PORT}
   └─ Default: [::]:5678 (dual-stack IPv4/IPv6)

3. Initialize external hooks (ExternalHooks service)

4. Setup health check endpoints
   ├─ GET /{endpointHealth} → Always 200 (alive)
   ├─ GET /{endpointHealth}/readiness → 200 if DB connected & migrated, else 503
   └─ Middleware checks DB connection state for all requests
```

### 7. Server.start() Flow (server.ts: 90-110 + abstract-server.ts: 216-299)
```
1. Conditionally load FrontendService (if !disableUi)
   ├─ Loads module settings controller
   └─ Loads third-party licenses controller

2. setupErrorHandlers() - Register Sentry Express error handler

3. setupCommonMiddlewares()
   ├─ Compression middleware
   ├─ Raw body reader

4. Setup webhook handlers BEFORE body parser
   ├─ POST /webhook/* → LiveWebhooks
   ├─ POST /webhookTest/* → TestWebhooks
   ├─ POST /form/* → WaitingForms
   └─ POST /formWaiting/* → WaitingForms

5. Bot detection & blocking
   ├─ Parses User-Agent
   └─ Blocks known bots (returns 204)

6. Setup dev middlewares (if in development)
   ├─ CORS headers

7. Setup body parsing middleware
   ├─ JSON parser
   ├─ Form data parser
   └─ AFTER webhook handlers (preserves binary data)

8. Configure server (Server.configure())
   ├─ Register controllers via ControllerRegistry
   ├─ Examples:
   │  ├─ WorkflowsController
   │  ├─ CredentialsController
   │  ├─ ExecutionsController
   │  ├─ UsersController
   │  └─ ... 30+ controllers

9. Log ready status
   ├─ Version: N8N_VERSION
   ├─ Locale: N8N_DEFAULT_LOCALE
   └─ Run n8n.ready external hooks
```

### 8. Start.run() Flow (start.ts: 311-377)
```
1. Load database settings
   ├─ Find all records with loadOnStartup=true
   └─ Apply to config via config.set()

2. SQLite specific: Run VACUUM if enabled
   └─ EXECUTIONS_DATA_SQLITE_VACUUM_ON_STARTUP

3. Server.start() (Express HTTP listener started above)
   └─ Now actually listening on port 5678

4. ExecutionsPruningService.init()
   ├─ Soft-delete after EXECUTIONS_DATA_MAX_AGE hours
   ├─ Hard-delete after EXECUTIONS_DATA_HARD_DELETE_BUFFER hours
   └─ Interval: EXECUTIONS_DATA_PRUNE_SOFT_DELETE_INTERVAL

5. WorkflowHistoryCompactionService.init()
   ├─ Periodically compress workflow history
   └─ Interval: WORKFLOW_HISTORY_COMPACTION_INTERVAL

6. If EXECUTIONS_MODE=regular: runEnqueuedExecutions()
   ├─ Find executions enqueued at previous shutdown
   ├─ Start running up to concurrency limit
   └─ Re-queue remaining ones

7. ActiveWorkflowManager.init()
   ├─ Activate all enabled workflows
   ├─ Start trigger-based polls (Cron, interval-based)
   ├─ Subscribe to webhook events
   └─ **MOST IMPORTANT**: Workflows now executing

8. Release node type definitions from memory
   └─ Free up RAM after startup

9. Display editor URL to console
   └─ "Editor is now accessible via: http://localhost:5678/"

10. If terminal interactive: Listen for 'o' key to open browser
    └─ Uses raw mode on process.stdin
```

**Critical Dependency Chain:**
```
DatabaseConnection → DatabaseMigrations → Settings Load
                                             ↓
                            ActiveWorkflowManager Init
                                       ↓
                        Workflows start executing
```

If any step above fails, the process exits with error. The `/health/readiness` endpoint will return 503 until database is ready.

---

## Service Dependencies

### Required Services (Must be running)

1. **PostgreSQL or SQLite Database**
   - Default: SQLite at `/home/node/.n8n/database.sqlite`
   - Env Var: `DB_TYPE` (default: 'sqlite')
   - Connection: `DB_POSTGRESDB_HOST`, `DB_POSTGRESDB_PORT`, `DB_POSTGRESDB_USER`, `DB_POSTGRESDB_PASSWORD`
   - Schema: `DB_POSTGRESDB_SCHEMA` (default: 'public')
   - Failure Behavior: Main process hangs at "connecting to database", readiness probe returns 503
   - Migrations: Run automatically on startup, blocks server until complete
   - File Location: `/Users/ib/prj-other/n0n/n8n/packages/@n8n/db` (schemas & migrations)

2. **Redis** (if EXECUTIONS_MODE=queue)
   - Host: `QUEUE_BULL_REDIS_HOST` (default: localhost)
   - Port: `QUEUE_BULL_REDIS_PORT` (default: 6379)
   - Database: `QUEUE_BULL_REDIS_DB` (default: 0)
   - Password: `QUEUE_BULL_REDIS_PASSWORD`
   - Purpose: Job queue for worker processes, pub/sub for orchestration
   - Failure Behavior: Queue fails to initialize, workers cannot start
   - Timeout: `QUEUE_BULL_REDIS_TIMEOUT_THRESHOLD` (10s default, cumulative)

### Optional Services

1. **Sentry** (Error Reporting)
   - Env: `SENTRY_BACKEND_DSN`, `SENTRY_FRONTEND_DSN`
   - Failure: Logged, doesn't block startup

2. **S3/Object Storage** (Binary Data)
   - Env: `BINARY_DATA_STORAGE_PATH` (default: local filesystem)
   - Supports: S3, GCS, Azure Blob Storage
   - Failure: Binary data saving fails

3. **External Webhooks** (Custom integrations)
   - URLs: `EXTERNAL_FRONTEND_HOOKS_URLS`
   - Failure: Logged, doesn't block startup

### Inter-Process Communication (if queue mode)

**Main ↔ Worker Communication via Redis Pub/Sub:**

```
Main publishes to:
  - 'command' channel: Stop/pause commands
  - 'mcp-relay' channel: MCP (ModelContextProtocol) messages

Worker subscribes to:
  - 'command' channel
  - 'mcp-relay' channel

Worker publishes to:
  - 'worker-response' channel: Job results
  - 'message-event-bus' channel: Execution events
```

**Queue Channels (Bull/Redis):**
- Queue name: `bull:queue:${name}` (e.g., `bull:queue:default`)
- Lock prefix: `bull:lock:${jobId}`
- Worker lease: `QUEUE_WORKER_LOCK_DURATION` (60s default)
- Stalled detection: `QUEUE_WORKER_STALLED_INTERVAL` (30s default)

---

## Deployment Topology

### Single Node (Default - EXECUTIONS_MODE=regular)

```
┌─────────────────────────────────────────┐
│ n8n Instance (PID: n)                   │
├─────────────────────────────────────────┤
│ Main Server Process                     │
│  ├─ Express HTTP Server (port 5678)     │
│  ├─ ActiveWorkflowManager               │
│  │  ├─ Cron/interval triggers           │
│  │  ├─ Polling executions               │
│  │  └─ Webhook handlers                 │
│  ├─ Execution execution (in-process)    │
│  └─ Database migrations (startup)       │
└─────────────────────────────────────────┘
         ↓
    ┌─────────────┐
    │ SQLite or   │
    │ PostgreSQL  │
    └─────────────┘
```

**Characteristics:**
- Single process handles everything
- No Redis needed
- Executions block the process (can't be killed externally)
- Simple deployment, limited scalability
- Good for: dev, small teams, <100 workflows

---

### Scaling Mode (EXECUTIONS_MODE=queue with Multi-Main=false)

```
┌──────────────────────────────┐
│ Main Server (port 5678)      │
│ ├─ HTTP API                  │
│ ├─ UI (editor-ui)            │
│ ├─ ActiveWorkflowManager     │
│ ├─ Webhook endpoints         │
│ └─ Job dispatcher            │
└──────────────────────────────┘
         ↓
    ┌────────────────┐
    │ Redis (queue)  │
    │ ├─ job queue   │
    │ └─ pub/sub     │
    └────────────────┘
         ↑ ↓
┌──────────────────────────────┐
│ Worker Processes (N instances)│
│ ├─ Worker 1 (concurrency: 10)│
│ ├─ Worker 2 (concurrency: 10)│
│ └─ Worker N (concurrency: 10)│
└──────────────────────────────┘
         ↓
    ┌────────────┐
    │ Database   │
    └────────────┘
```

**Scaling Strategy:**
- Horizontal: Add more workers independently
- No worker discovery needed (all poll same Redis queue)
- Main process can be single instance
- Workers are stateless, can be killed/restarted anytime

**Configuration:**
- `EXECUTIONS_MODE=queue`
- `N8N_CONCURRENCY_PRODUCTION_LIMIT=-1` or specific number
- `QUEUE_BULL_REDIS_HOST=redis-hostname`
- Workers: `n8n worker --concurrency=20` (or flag override)

**Failure Scenarios:**
- Worker dies: Jobs stay in queue, redistributed to other workers
- Main dies: Webhooks not handled (use webhook process), new jobs queued but not picked up
- Redis down: Everything blocked

---

### Multi-Main HA Mode (EXECUTIONS_MODE=queue with MultiMainSetup=enabled)

```
┌──────────────────────┐     ┌──────────────────────┐
│ Main Instance 1      │     │ Main Instance 2      │
│ (primary/secondary)  │     │ (primary/secondary)  │
├──────────────────────┤     ├──────────────────────┤
│ HTTP API (5678)      │     │ HTTP API (5678)      │
│ ActiveWorkflow Mgr   │     │ ActiveWorkflow Mgr   │
│ Webhook handling     │     │ Webhook handling     │
└──────────────────────┘     └──────────────────────┘
         ↓                           ↓
    ┌────────────────────────────────────┐
    │ PostgreSQL with Advisory Locks     │
    │ (Leader election serialization)    │
    └────────────────────────────────────┘
         ↓
    ┌────────────────┐
    │ Redis (queue)  │
    └────────────────┘
         ↑ ↓
┌────────────────────────────────────┐
│ Worker Processes (stateless pool)  │
│ ├─ Worker 1                        │
│ ├─ Worker 2                        │
│ └─ Worker N                        │
└────────────────────────────────────┘
```

**Configuration:**
- `EXECUTIONS_MODE=queue`
- `N8N_MULTI_MAIN_SETUP_ENABLED=true`
- Requires license: `LICENSE_FEATURES.MULTIPLE_MAIN_INSTANCES`
- Both instances connect to same PostgreSQL and Redis
- Leader elected via Postgres advisory locks (serialized via transaction)

**Key Properties:**
- Only primary main instance activates workflows
- Secondary main handles API requests, defers workflows to primary
- If primary fails, secondary becomes primary (automatic)
- Both can handle webhooks
- Both can accept API requests (load balanceable)

**Leader Election (from start.ts: 205-227):**
```
1. Both instances try to init MultiMainSetup
2. Postgres advisory lock in transaction
3. First to acquire becomes primary, others wait
4. Primary: ActiveWorkflowManager enabled
5. Secondary: ReadOnly mode for workflows
```

---

### Separate Webhook Process (EXECUTIONS_MODE=queue)

```
┌─────────────────────────────────────┐
│ Main Server (port 5678)             │
│ ├─ HTTP API                         │
│ ├─ UI                               │
│ ├─ ActiveWorkflowManager            │
│ └─ Job dispatcher                   │
└─────────────────────────────────────┘
         ↓
    ┌────────────────┐
    │ Redis          │
    └────────────────┘
         ↑ ↓
      ┌──────┴───────┐
      ↓              ↓
  ┌──────────┐  ┌──────────────────────────┐
  │ Workers  │  │ Webhook Process (5678)   │
  │  N procs │  │ ├─ POST /webhook/*       │
  │          │  │ ├─ POST /form/*          │
  └──────────┘  │ ├─ POST /mcp/*           │
               │ └─ No ActiveWorkflowMgr  │
               └──────────────────────────┘
```

**Motivation:**
- Separate webhook traffic from main instance
- Prevents webhook overload from affecting workflow management
- Webhook process only: REST endpoints, form handling, MCP relay
- Cannot run without queue mode (webhook.ts:45-60 requirement)

**Notes:**
- Webhook process is "thin" - no ActiveWorkflowManager
- Jobs from webhooks enqueued to Redis queue
- Must have `EXECUTIONS_MODE=queue`

---

## Environment Variables & Configuration

### Database Configuration

**SQLite (Default)**
```bash
DB_TYPE=sqlite
# Optional: DB_SQLITE_DATABASE=/custom/path/database.sqlite
# Pool size: DB_SQLITE_POOL_SIZE=4 (for tests)
```

**PostgreSQL**
```bash
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=postgres.example.com
DB_POSTGRESDB_PORT=5432
DB_POSTGRESDB_USER=n8n
DB_POSTGRESDB_PASSWORD=secret
DB_POSTGRESDB_SCHEMA=public
DB_TABLE_PREFIX='' # e.g., 'test_' for testing
```

### Execution Mode & Scaling

```bash
# Mode: 'regular' (default) or 'queue'
EXECUTIONS_MODE=regular

# Queue configuration (if EXECUTIONS_MODE=queue)
QUEUE_BULL_REDIS_HOST=redis.example.com
QUEUE_BULL_REDIS_PORT=6379
QUEUE_BULL_REDIS_DB=0
QUEUE_BULL_REDIS_PASSWORD=redis_secret
QUEUE_BULL_REDIS_PREFIX=bull
QUEUE_BULL_REDIS_USERNAME=redis_user
QUEUE_BULL_REDIS_TLS=false
QUEUE_BULL_REDIS_CLUSTER_NODES=redis-1:6379,redis-2:6379

# Worker concurrency
N8N_CONCURRENCY_PRODUCTION_LIMIT=-1  # -1 = unlimited
N8N_CONCURRENCY_EVALUATION_LIMIT=-1
QUEUE_WORKER_TIMEOUT=30  # deprecated, use N8N_GRACEFUL_SHUTDOWN_TIMEOUT

# Queue health check (worker process)
QUEUE_HEALTH_CHECK_ACTIVE=false
QUEUE_HEALTH_CHECK_PORT=5678
N8N_WORKER_SERVER_ADDRESS=::
```

### Server Configuration

```bash
# Host and port
N8N_HOST=0.0.0.0
N8N_PORT=5678
N8N_LISTEN_ADDRESS=::  # [::] for IPv6 dual-stack, 0.0.0.0 for IPv4 only
N8N_PROTOCOL=http      # 'http' or 'https'
N8N_SSL_KEY=/path/to/key.pem
N8N_SSL_CERT=/path/to/cert.pem

# Editor URL (for external access)
N8N_EDITOR_BASE_URL=http://n8n.example.com

# n8n base path (if behind proxy at subpath)
N8N_PATH=/n8n/

# Proxy hops (for X-Forwarded-For)
N8N_PROXY_HOPS=1
```

### Webhook Configuration

```bash
# Endpoints
N8N_ENDPOINT_WEBHOOK=/webhook
N8N_ENDPOINT_WEBHOOK_TEST=/webhook-test
N8N_ENDPOINT_FORM=/form
N8N_ENDPOINT_FORM_TEST=/form-test
N8N_ENDPOINT_FORM_WAITING=/form-waiting
N8N_ENDPOINT_WEBHOOK_WAITING=/webhook-waiting
N8N_ENDPOINT_REST=/rest
N8N_ENDPOINT_MCP=/mcp
N8N_ENDPOINT_MCP_TEST=/mcp-test
N8N_ENDPOINT_HEALTH=/health

# Production webhooks on main
DISABLE_PRODUCTION_WEBHOOKS_ON_MAIN_PROCESS=false
DISABLE_UI=false
```

### Execution Data Configuration

```bash
# Execution timeout
EXECUTIONS_TIMEOUT=-1        # -1 = unlimited
EXECUTIONS_TIMEOUT_MAX=3600  # Max 1 hour

# Data pruning
EXECUTIONS_DATA_PRUNE=true
EXECUTIONS_DATA_MAX_AGE=336  # Hours (14 days)
EXECUTIONS_DATA_PRUNE_MAX_COUNT=10000  # 0 = unlimited
EXECUTIONS_DATA_HARD_DELETE_BUFFER=1   # Hours
EXECUTIONS_DATA_SAVE_ON_ERROR=all      # 'all' or 'none'
EXECUTIONS_DATA_SAVE_ON_SUCCESS=all
EXECUTIONS_DATA_SAVE_ON_PROGRESS=false
EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS=true

# Pruning intervals
EXECUTIONS_DATA_PRUNE_SOFT_DELETE_INTERVAL=60  # Minutes
EXECUTIONS_DATA_PRUNE_HARD_DELETE_INTERVAL=15

# SQLite specific
EXECUTIONS_DATA_SQLITE_VACUUM_ON_STARTUP=false
```

### Execution Recovery (for queue mode)

```bash
# Queue recovery
N8N_EXECUTIONS_QUEUE_RECOVERY_INTERVAL=180  # Minutes
N8N_EXECUTIONS_QUEUE_RECOVERY_BATCH=100     # Jobs per recovery run

# Auto-deactivation of failed workflows
N8N_WORKFLOW_AUTODEACTIVATION_ENABLED=false
N8N_WORKFLOW_AUTODEACTIVATION_MAX_LAST_EXECUTIONS=3
```

### Multi-Main Configuration

```bash
N8N_MULTI_MAIN_SETUP_ENABLED=false  # Requires queue mode
# Requires license: LICENSE_FEATURES.MULTIPLE_MAIN_INSTANCES
```

### External Integrations

```bash
# Sentry (error tracking)
SENTRY_BACKEND_DSN=https://...
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=1.0
SENTRY_RELEASE_TYPE=stable  # 'stable', 'rc', 'dev'

# PostHog (analytics)
POSTHOG_API_KEY=...
POSTHOG_API_HOST=...

# External frontend hooks
EXTERNAL_FRONTEND_HOOKS_URLS=https://example.com/hook.js;https://another.com/hook.js
```

### Feature Flags & Licensing

```bash
# License
N8N_LICENSE_KEY=...
N8N_LICENSE_TELEMETRY=true

# Experiments/Feature flags
N8N_EXPERIMENT_OVERRIDES={"feature_name": true}
```

### Logging

```bash
N8N_LOG_LEVEL=info        # 'debug', 'info', 'warn', 'error'
N8N_LOG_OUTPUT=console    # 'console' or file path
LOG_SCOPES=             # Specific modules: 'n8n.* scaling.* nodes.*'
NODEJS_PREFER_IPV4=false  # Use IPv4 only
```

### Development/Testing

```bash
NODE_ENV=development
E2E_TESTS=false  # Skips dotenv loading
ENVIRONMENT=production  # or 'development'
DEPLOYMENT_NAME=myinstance
```

---

## Configuration Precedence & Loading

**Order (highest to lowest priority):**

1. Environment variables (process.env)
2. `.env` file (via dotenv)
3. Files in `N8N_CONFIG_FILES` (custom config files)
4. `@Env` decorator defaults in config classes
5. Hard-coded defaults in code

**Config Loading Flow:**

```typescript
// packages/cli/bin/n8n:38-46
if (process.env.E2E_TESTS !== 'true') {
  require('dotenv').config({ quiet: true });
}

process.env.NODE_CONFIG_DIR = process.env.NODE_CONFIG_DIR ||
  path.join(__dirname, 'config');

require('../dist/config');  // Loads GlobalConfig
```

**Example: Execution Mode Override**

```bash
# Using env var (highest priority)
export EXECUTIONS_MODE=queue

# Or via .env file
# EXECUTIONS_MODE=queue

# Default in config class (lowest priority)
# @Env('EXECUTIONS_MODE', executionModeSchema)
# mode: ExecutionMode = 'regular';
```

---

## Docker Deployment

**Dockerfile Location:** `/Users/ib/prj-other/n0n/n8n/docker/images/n8n/Dockerfile:1-33`

**Base Image:** `n8nio/base:${NODE_VERSION}`

**Entrypoint Script:** `/Users/ib/prj-other/n0n/n8n/docker/images/n8n/docker-entrypoint.sh:1-16`

```bash
#!/bin/sh
if [ -d /opt/custom-certificates ]; then
  export NODE_OPTIONS="--use-openssl-ca $NODE_OPTIONS"
  export SSL_CERT_DIR=/opt/custom-certificates
  c_rehash /opt/custom-certificates
fi

if [ "$#" -gt 0 ]; then
  exec n8n "$@"  # n8n webhook, n8n worker, etc.
else
  exec n8n      # n8n start (default)
fi
```

**Docker Compose Example:** `/Users/ib/prj-other/n0n/n8n/.devcontainer/docker-compose.yml:1-25`

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: n8n
      POSTGRES_PASSWORD: password

  n8n:
    build: .
    environment:
      DB_TYPE: postgresdb
      DB_POSTGRESDB_HOST: postgres
      DB_POSTGRESDB_PASSWORD: password
    ports:
      - "5678:5678"
```

**Build Commands:**
```bash
# Full docker image with dependencies
pnpm build:docker

# With coverage
pnpm build:docker:coverage

# With vulnerability scan
pnpm build:docker:scan
```

**Ports Exposed:**
- `5678/tcp` - HTTP/HTTPS, WebSocket, Health checks

---

## Graceful Shutdown

**Timeout Configuration:**
```bash
N8N_GRACEFUL_SHUTDOWN_TIMEOUT=30  # Seconds
```

**Shutdown Flow:**

```typescript
// Commands extend BaseCommand and listen for SIGTERM/SIGINT
process.on('SIGTERM', async () => {
  await command.onTerminationSignal('SIGTERM')();
});

// Each command implements:
async stopProcess() {
  // 1. Stop accepting new work
  // 2. Wait for in-flight executions
  // 3. Cleanup hooks
  // 4. Close database/Redis
  // 5. Exit process
}
```

**Main Server Shutdown (start.ts: 84-117):**
1. Stop accepting new workflow activations
2. Stop wait tracker
3. Run 'n8n.stop' hooks
4. Remove all trigger/poller workflows
5. Shutdown multi-main setup (if enabled)
6. Shutdown pub/sub (if queue mode)
7. Shutdown active executions
8. Close message event bus

**Worker Shutdown (worker.ts: 52-62):**
1. Run 'n8n.stop' hooks
2. Wait for running jobs (up to timeout)
3. Exit process

**Webhook Shutdown (webhook.ts: 30-42):**
1. Run 'n8n.stop' hooks
2. Shutdown active executions
3. Exit process

---

## Key Entry Files

### CLI & Command Infrastructure
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/bin/n8n:1-65`** - Main entrypoint: loads config, validates Node version, invokes CommandRegistry
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/src/command-registry.ts:1-210`** - CLI command loader, parser, executor; handles --help, command discovery, Zod flag validation
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/src/commands/base-command.ts:43-100+`** - Abstract base for all commands; handles DI container setup, licensing, crash journal, hook registration

### Process Commands
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/src/commands/start.ts:55-400+`** - Main server command: initializes multi-main, orchestration, active workflows, generates static assets
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/src/commands/worker.ts:32-211`** - Worker command: Bull queue setup, concurrency handling, job processing
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/src/commands/webhook.ts:20-100`** - Webhook process: Express webhook handlers, form submissions, MCP relay

### Server Infrastructure
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/src/server.ts:71-150+`** - Main HTTP server: controller registration, UI loading, middleware configuration
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/src/abstract-server.ts:26-325`** - HTTP server base: Express app setup, port binding, SSL/TLS, health checks, webhook routing
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/src/webhooks/webhook-server.ts:1-7`** - Webhook server service (thin wrapper on AbstractServer)

### Configuration System
- **`/Users/ib/prj-other/n0n/n8n/packages/@n8n/config/src/index.ts:1-232`** - GlobalConfig: root configuration class with all nested configs (database, executions, redis, etc.)
- **`/Users/ib/prj-other/n0n/n8n/packages/@n8n/config/src/configs/executions.config.ts:1-131`** - ExecutionsConfig: execution mode, timeouts, pruning, concurrency, recovery settings
- **`/Users/ib/prj-other/n0n/n8n/packages/@n8n/config/src/configs/scaling-mode.config.ts:1-138`** - ScalingModeConfig: Redis connection, Bull settings, worker health checks

### Workflow Management
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/src/active-workflow-manager.ts`** - Activates workflows on startup, manages triggers/pollers, enables webhooks
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/src/workflow-runner.ts`** - Executes workflow in-process (regular mode) or enqueues to Redis (queue mode)
- **`/Users/ib/prj-other/n0n/n8n/packages/core`** - Workflow execution engine (from n8n-core package)

### Orchestration & Scaling
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/scaling.service.ts`** - Initializes Bull queue, sets up workers, manages job lifecycle
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/pubsub/publisher.service.ts`** - Publishes commands/events to Redis (main→workers)
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/pubsub/subscriber.service.ts`** - Subscribes to commands (workers listening)
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/src/scaling/multi-main-setup.ee.ts`** - Leader election, role assignment, failover logic

### Database & Persistence
- **`/Users/ib/prj-other/n0n/n8n/packages/@n8n/db`** - TypeORM entities, repositories, migrations; defines all database tables
- **`/Users/ib/prj-other/n0n/n8n/packages/@n8n/config/src/configs/database.config.ts`** - DatabaseConfig: connection params, SQLite/Postgres selection, pool sizes

### Event & Telemetry
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/src/eventbus/message-event-bus/message-event-bus.ts`** - Event aggregation, logging, Sentry integration
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/src/events/event.service.ts`** - Event emission for server-started, instance-stopped, etc.
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/src/posthog.ts`** - PostHog telemetry client

### External Integrations
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/src/external-hooks.ts`** - Custom hook registry (n8n.ready, n8n.stop, etc.)
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/src/license.ts`** - License validation, feature availability checks

### Docker & Deployment
- **`/Users/ib/prj-other/n0n/n8n/docker/images/n8n/Dockerfile:1-33`** - Docker image: Node base, sqlite rebuild, n8n installation
- **`/Users/ib/prj-other/n0n/n8n/docker/images/n8n/docker-entrypoint.sh:1-16`** - Entrypoint: custom certificate handling, forwards args to n8n CLI
- **`/Users/ib/prj-other/n0n/n8n/.devcontainer/docker-compose.yml`** - Dev environment: PostgreSQL + n8n services

### Utilities & Helpers
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/src/shutdown/shutdown.service.ts`** - Graceful shutdown orchestration (@OnShutdown hooks)
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/src/utils/health-endpoint.util.ts`** - Health check endpoint path resolution
- **`/Users/ib/prj-other/n0n/n8n/packages/cli/src/constants.ts`** - N8N_VERSION, paths, endpoints

