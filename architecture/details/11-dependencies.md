# n8n Technology Stack & Dependencies

**Analysis Date:** February 2026
**Monorepo Version:** 2.10.0
**Node.js Requirement:** >=22.16
**Package Manager:** pnpm >=10.22.0

---

## Executive Summary

n8n is a large-scale TypeScript monorepo (55+ packages) using **pnpm workspaces** with **Turbo** build orchestration. The architecture separates concerns into:
- **Backend:** Node.js/Express + TypeORM + PostgreSQL/SQLite + BullMQ + Redis
- **Frontend:** Vue 3 + Pinia + Vite + Element Plus + Vue Flow
- **Extensibility:** Custom node SDK, LangChain integration layer, webhook/trigger system
- **Infrastructure:** Dependency injection pattern, multi-database support, distributed execution with queue abstraction

The stack emphasizes **type safety** (TypeScript everywhere), **DI/IoC patterns**, and **isolation between execution contexts**. Significant engineering effort goes into schema validation (Zod), credential encryption, expression evaluation, and supporting multiple deployment topologies.

---

## Technology Stack Summary

### Runtime Core - Backend

| Package | Version | Role | Why This Choice |
|---------|---------|------|-----------------|
| **Express** | 5.1.0 | HTTP framework, REST API server | Long-established, battle-tested, large ecosystem; v5 provides modern async/await support |
| **@n8n/typeorm** | 0.3.20-16 | ORM layer, database abstraction | Forked from TypeORM for custom patches; supports PostgreSQL, SQLite, MySQL with migrations |
| **PostgreSQL (pg)** | 8.17.0 | Primary relational database | ACID compliance, JSON support, window functions for complex queries |
| **SQLite3** | 5.1.7 | Development/embedded database | Zero-config, useful for testing and single-machine deployments |
| **BullMQ** | 4.16.4 (patched) | Job queue system | Distributed task processing, persistent execution state, failure recovery; patched for n8n-specific behavior |
| **Redis/ioredis** | 5.3.2 | Cache & pub/sub broker | Central to BullMQ operation; also caches credentials and execution data |
| **bcryptjs** | 2.4.3 | Password hashing | Credential storage, user authentication |
| **jsonwebtoken** | 9.0.3 | JWT token generation/verification | Session tokens, API authentication |
| **axios** | 1.13.5 | HTTP client | External API calls from nodes, third-party integrations |
| **Winston** | 3.14.2 | Structured logging | Multi-transport logging (file, console, syslog) |
| **Prom-client** | 15.1.3 | Prometheus metrics | Operational observability, endpoint metrics, queue depth monitoring |
| **Sentry** | ^10.36.0 | Error tracking | Production error aggregation and alerting |

**Key Files:**
- `/Users/ib/prj-other/n0n/n8n/packages/cli/package.json:96-199` - Main server dependencies
- `/Users/ib/prj-other/n0n/n8n/packages/core/package.json:42-83` - Execution engine dependencies

---

### Database & Persistence

| Package | Version | Role | Why This Choice |
|---------|---------|------|-----------------|
| **@n8n/typeorm** | 0.3.20-16 | ORM, database abstraction | Custom fork allows patching; supports schema versioning and multi-database backends |
| **class-validator** | 0.14.0 | DTO validation | Decorators for entity validation before database operations |
| **reflect-metadata** | 0.2.2 | Runtime type metadata | Required by TypeORM for decorator support and DI container |
| **migrate (embedded)** | - | Schema migrations | TypeORM manages migrations; custom n8n migration system for schema evolution |

**Schema & Repository Pattern:**
- `/Users/ib/prj-other/n0n/n8n/packages/@n8n/db/package.json:24-44` - Database package with repositories
- All database access goes through service interfaces (WorkflowRepository, CredentialRepository, ExecutionRepository)
- Multi-schema support: PostgreSQL schema switching, SQLite in-memory for tests

---

### Frontend Core

| Package | Version | Role | Why This Choice |
|---------|---------|------|-----------------|
| **Vue** | 3.5.13 (catalog:frontend) | UI framework | Modern reactivity model; composition API for complex state |
| **Vite** | 7.3.1 (rolldown-vite) | Build tool, dev server | ESM-native, hot module replacement, ~10x faster cold starts than webpack |
| **Pinia** | 2.2.4 (catalog:frontend) | State management | Vue 3 native store pattern; replaces Vuex with simpler API |
| **Vue Router** | 4.5.0 (catalog:frontend) | Client-side routing | SPA navigation; lazy-loaded route components |
| **Element Plus** | 2.4.3 (patched) | UI component library | Comprehensive component set (dialogs, tables, forms, pagination); patched for n8n customizations |
| **CodeMirror** | 6.x (multiple packages) | Code editor | Lightweight, composable editor with syntax highlighting and linting |
| **Vue Flow** | 1.48.0 | Visual workflow editor | DAG node/edge abstraction; n8n adds custom rendering on top |

**Catalog Entry References:**
- `/Users/ib/prj-other/n0n/n8n/pnpm-workspace.yaml:89-107` - Frontend catalog (Vue, Pinia, Element Plus versions)
- `/Users/ib/prj-other/n0n/n8n/pnpm-lock.yaml:220-306` - Resolved frontend versions

**Key Frontend Packages:**
- `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/package.json:24-113` - Main editor-ui dependencies
- `/Users/ib/prj-other/n0n/n8n/packages/frontend/@n8n/design-system/package.json:50-71` - Design system & reusable components

---

### Code Editor & Expression Evaluation

| Package | Version | Role | Why This Choice |
|---------|---------|------|-----------------|
| **@codemirror/** (6 packages) | 6.x | Code editor library | Language-agnostic; pluggable syntax highlighters and linters |
| **@codemirror/lang-javascript** | 6.2.4 | JS/TS syntax support | Dynamic expression evaluation in workflows |
| **@codemirror/lang-python** | 6.2.1 | Python syntax | Nodes using Python code execution |
| **@codemirror/lang-json** | 6.0.2 | JSON editor | Configuration/payload editing |
| **@codemirror/lang-sql** | 6.3.1 (n8n custom pkg) | SQL editor | Database query nodes |
| **vm2** | 3.10.5 | Sandboxed JS execution | Isolated expression evaluation; SECURITY NOTE: pinned to 3.x due to attack surface |
| **esprima-next** | 5.8.4 | JS AST parser | Expression parsing without full evaluation |
| **recast** | 0.22.0 | AST transformation | Code transformation utilities |

**Why vm2 matters architecturally:**
- Runs user expressions (e.g., `{{ $json.name }}`) in isolated context
- Prevents access to global scope (`process`, `require`, file system)
- Pinned to specific version due to known CVE history in 3.x

**Custom CodeMirror packages:**
- `/Users/ib/prj-other/n0n/n8n/packages/@n8n/codemirror-lang/package.json` - n8n expression language
- `/Users/ib/prj-other/n0n/n8n/packages/@n8n/codemirror-lang-sql/package.json` - SQL highlighting

---

### AI & LangChain Integration

| Package | Version | Role | Why This Choice |
|---------|---------|------|-----------------|
| **@langchain/core** | 1.1.8 | LangChain abstractions | Base classes for chains, agents, memory, retrieval |
| **@langchain/openai** | 1.1.3 | OpenAI integration | GPT-4, GPT-3.5 LLM support |
| **@langchain/anthropic** | 1.1.3 | Anthropic Claude integration | Alternative LLM provider |
| **@langchain/community** | 1.1.14 | Community integrations | Vector stores (Pinecone, Weaviate), memory systems |
| **langchain** | 1.2.3 | Main library | Full LangChain ecosystem |
| **@n8n/nodes-langchain** | 2.10.0 | Custom node wrapper | Integrates LangChain chains/agents as n8n nodes |
| **openai** | 6.9.0 | OpenAI SDK | Direct API access when LangChain wrapper insufficient |
| **@anthropic-ai/sdk** | (via catalog) | Anthropic SDK | Claude API integration |
| **js-tiktoken** | 1.0.12 | Token counting | LLM token counting for cost/limit calculation |
| **@modelcontextprotocol/sdk** | 1.26.0 | Model Context Protocol | MCP server/client for tool delegation |

**Vector Store Integrations (in `@n8n/nodes-langchain`):**
- Pinecone, Weaviate, Qdrant, Chroma, Redis, PgVector, Supabase, Xata, Milvus

**Why separate `@n8n/nodes-langchain` package:**
- Isolates heavy LangChain dependencies from core nodes
- Allows selective installation for AI-focused deployments
- `/Users/ib/prj-other/n0n/n8n/packages/@n8n/nodes-langchain/package.json:202-283` contains full dependency tree

---

### Validation & Schema

| Package | Version | Role | Why This Choice |
|---------|---------|------|-----------------|
| **Zod** | 3.25.67 | Schema validation | TypeScript-first, runtime validation, pinned to specific version across monorepo |
| **ajv** | 6.14.0 / 8.18.0 | JSON Schema validation | Alternative validator; multiple versions supported for different use cases |
| **class-validator** | 0.14.0 | Decorator-based validation | TypeORM entity validation |
| **@n8n/json-schema-to-zod** | workspace | Custom tool | Converts JSON Schema to Zod schemas for code generation |
| **zod-to-json-schema** | 3.23.3 | Bidirectional conversion | JSON Schema ↔ Zod serialization |

**Why Zod pinned to 3.25.67:**
- Runtime validation of node parameters, credentials, API responses
- Type inference enables compile-time safety across FE/BE
- All overrides in `pnpm-workspace.yaml:341` ensure consistency

---

### Credential Management

| Package | Version | Role | Why This Choice |
|---------|---------|------|-----------------|
| **@azure/keyvault-secrets** | 4.8.0 | Azure Key Vault client | Enterprise secret storage integration |
| **@aws-sdk/client-secrets-manager** | 3.808.0 | AWS Secrets Manager | AWS credential management |
| **@google-cloud/secret-manager** | 5.6.0 | Google Cloud Secrets | GCP secret storage |
| **infisical-node** | 1.3.0 | Infisical integration | Third-party secret manager support |
| **bcryptjs** | 2.4.3 | Encryption/hashing | Local credential encryption |
| **@n8n/client-oauth2** | workspace | OAuth 2.0 flow | Custom OAuth implementation for node-level auth flows |

**Credential Storage Architecture:**
- Encrypted at rest (bcrypt-based encryption keys)
- Supports multiple backends (local DB, AWS Secrets, Azure KV, Google Secrets)
- Accessed via `CredentialRepository` interface (DI-injected)

---

### Distributed Execution & Scaling

| Package | Version | Role | Why This Choice |
|---------|---------|------|-----------------|
| **BullMQ** | 4.16.4 | Job queue with Redis | Distributed job processing, persistence, failure recovery |
| **Redis** | 4.6.14 (node client) | Message broker & cache | BullMQ backend; credential caching; pub/sub for scaling |
| **@n8n/scaling** | workspace | Leader election & pub/sub | Custom abstraction over Redis for multi-process coordination |

**Execution Modes:**
1. **Direct execution (dev):** Workflow runs in main process
2. **Queue mode (production):** Execution jobs pushed to BullMQ → processed by worker processes
3. **Distributed:** Multiple workers pull from same Redis queue; pub/sub for cross-worker communication

---

### Utilities & Helpers

| Package | Version | Role | Why This Choice |
|---------|---------|------|-----------------|
| **lodash** | 4.17.23 | Utility library | Data manipulation, deep cloning, iteration helpers |
| **luxon** | 3.7.2 | Date/time handling | Timezone-aware date manipulation (replaces moment.js) |
| **nanoid** | 3.3.8 | Unique ID generation | URL-safe IDs for resources, tests, traces |
| **uuid** | 10.0.0 | UUID v4 generation | Standard UUIDs for entity IDs |
| **change-case** | 4.1.2 / 5.4.4 | String case conversion | camelCase ↔ snake_case ↔ PascalCase |
| **form-data** | 4.0.4 | Multipart form builder | File uploads to external APIs |
| **xml2js** | 0.6.2 | XML parsing | SOAP, XML API integrations |
| **htmlparser2** | 10.0.0 | HTML parsing | DOM manipulation, scraping |
| **cheerio** | 1.0.0 | jQuery-like HTML | DOM querying in nodes |
| **flatted** | 3.2.7 | Circular reference handling | Serialization of complex execution data |
| **xss** | 1.0.15 | XSS prevention | HTML sanitization for display |

---

### Testing Stack

| Package | Version | Role | Why This Choice |
|---------|---------|------|-----------------|
| **Jest** | 29.6.2 | Unit test framework | TypeScript support via ts-jest; mocking with jest-mock-extended |
| **Vitest** | 3.1.3 | Alternative test runner | Faster ESM support for frontend packages; compatible with Jest syntax |
| **@vitest/coverage-v8** | 3.2.4 | Code coverage | V8 engine coverage for accurate reporting |
| **jest-mock-extended** | 3.0.4 | Enhanced mocking | Typed mocks for complex interfaces |
| **nock** | 14.0.1 | HTTP mocking | Intercept network requests in tests |
| **@testing-library/vue** | 8.1.0 | Vue component testing | User-centric component tests |
| **Playwright** | 1.58.0 | E2E testing | Browser automation, cross-browser testing (Chromium, Firefox, WebKit) |
| **@currents/playwright** | 1.15.3 | Playwright CI orchestration | Distributed test execution, artifact management |
| **supertest** | 7.1.1 | HTTP assertion | API endpoint testing |
| **MirageJS** | 0.1.48 | Mock server | Frontend API mocking during tests |

**Test Organization:**
- Unit tests: `*.test.ts` or `*.spec.ts` in same directory as source
- Integration tests: `jest.config.integration.js` with separate database
- Migration tests: `jest.config.migration.js` with real schema
- E2E tests: `packages/testing/playwright/tests/e2e/**`
- Playwright Janitor: `/Users/ib/prj-other/n0n/n8n/packages/testing/janitor/package.json` - static architecture analysis

---

### Build & Tooling

| Tool | Version | Role | Why This Choice |
|------|---------|------|-----------------|
| **TypeScript** | 5.9.2 (catalog) | Language | Strict type checking; all packages use `noEmit: true` (compilation happens via tsc) |
| **Turbo** | 2.8.9 | Monorepo orchestrator | Parallel builds, caching, dependency graph analysis |
| **Biome** | 1.9.0 | Code formatter | Rust-based formatter, significantly faster than Prettier + ESLint combined |
| **ESLint** | 9.29.0 (catalog) | Linter | Code quality rules; custom `@n8n/eslint-config` package |
| **Prettier** | 3.3.3 (frontend) | Secondary formatter | Handles Vue `.vue` files (Biome ignores them) |
| **tsc-watch** | 6.2.0 | TypeScript watch mode | Development compilation with auto-reload |
| **tsc-alias** | 1.8.10 | Path alias resolution | Resolves `@n8n/*` imports in compiled output |
| **ts-jest** | 29.1.1 | Jest transformer | TypeScript → Jest compilation |
| **ts-morph** | 27.0.2 | AST manipulation | Code generation for node metadata, migrations |
| **tsx** | 4.19.3 | TypeScript executor | Run `.ts` files directly (CLI scripts) |
| **Storybook** | 10.1.11 (catalog:storybook) | Component showcase | Design system documentation, component testing |

**Build Configuration Reference:**
- `/Users/ib/prj-other/n0n/n8n/turbo.json:1-50` - Turbo task cache/dependencies
- `/Users/ib/prj-other/n0n/n8n/biome.jsonc:1-55` - Formatter configuration
- `/Users/ib/prj-other/n0n/n8n/tsconfig.json:1-4` - TypeScript root config

---

## Monorepo Structure (56 Packages)

### Core Packages

| Package | Purpose | Key Dependencies |
|---------|---------|-----------------|
| **@n8n/di** | Dependency Injection container | reflect-metadata |
| **@n8n/errors** | Error class hierarchy | callsites (stack trace inspection) |
| **@n8n/config** | Centralized configuration | @n8n/di, Zod |
| **@n8n/constants** | Shared constants | - |
| **@n8n/permissions** | RBAC system | Zod |
| **@n8n/utils** | Utility functions | lodash, nanoid |
| **@n8n/decorators** | Class decorators for DI | reflect-metadata |
| **@n8n/api-types** | Shared TypeScript interfaces (FE/BE) | - |

### Database & Execution

| Package | Purpose | Key Dependencies |
|---------|---------|-----------------|
| **@n8n/db** | Database schema + repositories | @n8n/typeorm, class-validator, Zod |
| **n8n-workflow** | Workflow interfaces, traversal utilities | AST libraries, Zod, JSON Schema |
| **n8n-core** | Workflow execution engine | n8n-workflow, winston, axios |

### Node System

| Package | Purpose | Key Dependencies |
|---------|---------|-----------------|
| **n8n-nodes-base** | ~400 built-in nodes | axios, crypto libs, format converters |
| **@n8n/nodes-langchain** | AI/LangChain nodes | @langchain/*, openai, vector DBs |
| **@n8n/node-cli** | Node development scaffolding | ts-morph, glob |
| **@n8n/extension-sdk** | Custom node SDK | n8n-workflow |

### Backend Server

| Package | Purpose | Key Dependencies |
|---------|---------|-----------------|
| **n8n (cli)** | Main server process | Express, @n8n/db, bull, redis, sentry |
| **@n8n/backend-common** | Shared server utilities | winston, reflect-metadata |
| **@n8n/backend-test-utils** | Testing helpers | Jest, nock, supertest |

### Frontend

| Package | Purpose | Key Dependencies |
|---------|---------|-----------------|
| **n8n-editor-ui** | Main Vue 3 SPA | Vue, Pinia, Element Plus, CodeMirror, Vue Flow |
| **@n8n/design-system** | Reusable Vue components | Element Plus, Reka UI, Tailwind CSS |
| **@n8n/stores** | Pinia state management | Pinia, Vue |
| **@n8n/composables** | Vue composables library | @vueuse/core, Vue |
| **@n8n/i18n** | Internationalization | vue-i18n |
| **@n8n/rest-api-client** | Typed fetch client | axios |
| **@n8n/chat** | Chat UI components | Vue, Element Plus |

### Code & Language Support

| Package | Purpose | Key Dependencies |
|---------|---------|-----------------|
| **@n8n/codemirror-lang** | n8n expression language | CodeMirror, Lezer |
| **@n8n/codemirror-lang-sql** | SQL syntax | CodeMirror, Lezer |
| **@n8n/codemirror-lang-html** | HTML syntax | CodeMirror, Lezer |
| **@n8n/expression-runtime** | Expression evaluation | vm2 |

### Infrastructure & Testing

| Package | Purpose | Key Dependencies |
|---------|---------|-----------------|
| **@n8n/task-runner** | Distributed task execution | Bull, Redis |
| **@n8n/scaling** | Multi-process coordination | Redis, pub/sub |
| **n8n-containers** | Docker container utilities | - |
| **n8n-playwright** | E2E test suite | Playwright, n8n packages |
| **@n8n/playwright-janitor** | Test architecture analysis | ts-morph, Playwright AST |

**Full workspace definition:**
- `/Users/ib/prj-other/n0n/n8n/pnpm-workspace.yaml:1-7` - Workspace glob patterns

---

## Version Constraints & Pinning Strategy

### Catalog-Based Versioning

n8n uses **pnpm catalog** to centralize versions for consistency:

```yaml
# pnpm-workspace.yaml:8-84 defines the default catalog
catalog:
  lodash: 4.17.23          # Strategic pin (compatibility known)
  luxon: 3.7.2             # Date handling compatibility
  typescript: 5.9.2        # Compiler version frozen
  @n8n/typeorm: 0.3.20-16  # Custom fork version
  vm2: ^3.10.5             # SECURITY: Major version only (known issues in 4.x)
  zod: 3.25.67             # Validation library frozen
```

### High-Impact Pinned Packages

| Package | Version | Reason |
|---------|---------|--------|
| **vm2** | 3.10.5 | Sandboxing security; major version changes alter isolation behavior |
| **zod** | 3.25.67 | Schema validation across entire stack; version changes affect type inference |
| **typescript** | 5.9.2 | Strict build reproducibility across team/CI |
| **@n8n/typeorm** | 0.3.20-16 | Forked; contains n8n-specific patches |
| **@codemirror/*** | 6.x | Editor stability; breaking changes between major versions |
| **vue** | 3.5.13 | Component reactivity model; version bumps can affect behavior |
| **element-plus** | 2.4.3 | Patched; n8n customizations rely on specific version |
| **luxon** | 3.7.2 | Timezone handling; critical for scheduling nodes |

**Catalog Location:**
- `/Users/ib/prj-other/n0n/n8n/pnpm-workspace.yaml:8-85` - Main catalog
- `/Users/ib/prj-other/n0n/n8n/pnpm-workspace.yaml:88-128` - Specialized catalogs (frontend, storybook, e2e, sentry)
- `/Users/ib/prj-other/n0n/n8n/pnpm-workspace.yaml:130-152` - Exclusions from minimum release age

### Patched Dependencies

pnpm `patchedDependencies` apply Git diffs to installed packages:

| Package | Patch File | Purpose |
|---------|-----------|---------|
| **bull@4.16.4** | `patches/bull@4.16.4.patch` | n8n queue enhancements |
| **element-plus@2.4.3** | `patches/element-plus@2.4.3.patch` | UI customizations |
| **pdfjs-dist@5.3.31** | `patches/pdfjs-dist@5.3.31.patch` | Document processing |
| **vue-tsc@2.2.8** | `patches/vue-tsc@2.2.8.patch` | Vue type checking improvements |
| **@lezer/highlight** | `patches/@lezer__highlight.patch` | CodeMirror syntax coloring |
| **z-vue-scan** | `patches/z-vue-scan.patch` | Vue component scanning |

**Patch management:**
- `/Users/ib/prj-other/n0n/n8n/pnpm-lock.yaml:368-413` - Patched dependency hashes
- Patches prevent external package upgrades that would break compatibility
- Hash-based verification ensures integrity across installs

### Problematic Overrides (Compatibility Shims)

```yaml
# pnpm-workspace.yaml:88-147 - Selected overrides addressing known issues
expr-eval@2.0.2: npm:expr-eval-fork@3.0.0  # Fallback to fork due to 2.0 issues
libphonenumber-js: npm:empty-npm-package@1.0.0  # Unused; stub prevents resolution
ajv@6/7/8: Different versions per consumer  # Multiple JSON Schema validators coexist
minimatch@9/10: Version shim layer  # Transitive dependency version conflicts
body-parser: 2.2.1  # Explicit version for Express 5 compatibility
multer: ^2.0.2  # Multipart form handling upgrade
```

**Why override-heavy:**
- 55 packages + deep dependency tree = version conflicts
- Third-party integrations have conflicting peer dependencies
- Cloud SDKs (AWS, Azure, Google) pin incompatible sub-libraries

---

## Build & Development Workflow

### Turbo Task Graph

```
build:
  ├── depends on: ^build (build all dependencies first)
  └── outputs: dist/**

typecheck:
  ├── depends on: ^typecheck + ^build
  └── validates: TS compilation

lint:
  ├── depends on: ^build + @n8n/eslint-config#build
  └── runs: ESLint

test:
  ├── depends on: ^build + build (local)
  └── outputs: coverage/**, *.xml (JUnit)

dev/watch:
  └── persistent: true (hot reload)
```

**Key Turbo config:**
- `/Users/ib/prj-other/n0n/n8n/turbo.json:4-49` - Task definitions and caching

### TypeScript Compilation

All packages use **source-first approach**:
- `"main": "./dist/index.js"` (compiled output)
- `"module": "./src/index.ts"` (source in dev)
- TypeScript compiles **without emitting** (`--noEmit`) in watch mode
- `tsc-alias` rewrites import paths post-compilation (e.g., `@n8n/*` → relative paths)

**Why source-first in dev:**
- Zero-config setup; no build step in hot reload
- Clear separation: `dist/` = production, `src/` = development
- Fast iteration: Turbo only rebuilds dependents

---

## Specialized Features & Architecture

### Credential Encryption & Storage

**Multi-backend support:**

```typescript
// Abstraction layer enables pluggable credential storage
interface ICredentialRepository {
  save(credential: Credential): Promise<void>;
  get(id: string): Promise<Credential | null>;
  // Decryption handled transparently
}

// Implementations:
- LocalCredentialRepository → SQLite/PostgreSQL (bcrypt encryption)
- AzureKeyVaultRepository → Azure Key Vault client
- AWSSecretsManagerRepository → AWS Secrets Manager
- GoogleSecretManagerRepository → Google Cloud Secrets
```

**Why critical architecture:**
- Credentials encrypted at rest (never in plaintext in logs/exports)
- Each credential type has custom authentication flow
- DI container injects correct repository based on configuration

---

### Expression Evaluation

**Multi-layer approach:**

```
User writes:     {{ $json.items[0].name }}
                          ↓
Parsed by:       Esprima (AST generation)
                          ↓
Executed in:     vm2 (isolated context)
                          ↓
Scope includes:  $json (payload data)
                 $env (environment variables)
                 $secrets (credential tokens)
                 Math, Date, JSON utilities
                 Custom n8n helpers
```

**Why vm2 is mandatory:**
- User expressions could access `process`, `require`, file system without sandbox
- Each execution gets fresh vm context (no state leaks)
- Limited CPU/memory prevents DoS

---

### Workflow Execution Contexts

**Different contexts per node type:**

```typescript
// Workflow node (e.g., Code node)
context = {
  payload: executionData,
  helpers: { logger, utils, generateWebhookUrl },
  mode: 'manual' | 'trigger' | 'webhook',
};

// HTTP request node
context = {
  credentials: resolvedCredential,
  ssl: sslOptions,
  proxy: proxySettings,
};

// Database node
context = {
  dataSource: connectionPool,
  schema: schemaName,
};
```

**Why multiple contexts:**
- Each node type needs different capabilities
- Prevents unauthorized access to unneeded resources
- Simplifies testing (mock-friendly interfaces)

---

### Multi-Database Support

**Three database options with runtime selection:**

| Database | Best For | Key Libraries |
|----------|----------|---------------|
| **SQLite** | Development, single-machine | sqlite3 (5.1.7) |
| **PostgreSQL** | Production, scaling | pg (8.17.0) |
| **MySQL** | MySQL deployments | mysql2 (3.15.0) |

**Runtime switching via environment:**
```typescript
const dbType = process.env.DB_TYPE; // 'sqlite', 'postgresdb', 'mysql'

const dataSource = new DataSource({
  type: dbType,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  // typeorm handles dialect differences
});
```

**Why optional:**
- Container deployments standardize on PostgreSQL
- Developers can use SQLite locally (zero setup)
- Allows migrations before production cutover

---

## Performance & Observability

### Logging (Winston)

```typescript
// Multi-transport setup in core package
import winston from 'winston';

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'n8n.log' }),
    new winston.transports.Syslog(), // Optional syslog integration
  ],
});

// Structured logs: { timestamp, level, message, context, error }
```

**Usage across packages:**
- `/Users/ib/prj-other/n0n/n8n/packages/core/package.json:80` - winston dependency
- Log level controllable via `N8N_LOG_LEVEL` environment variable

### Metrics & Monitoring

**Prometheus integration:**
```typescript
import * as promClient from 'prom-client';

// Auto-instrumented metrics
- http_requests_total (request count)
- http_request_duration_seconds (latency histogram)
- queue_depth (BullMQ queue size)
- execution_duration (workflow execution time)
```

**Reference:**
- `/Users/ib/prj-other/n0n/n8n/packages/cli/package.json:142` - express-prom-bundle

### Distributed Tracing (Sentry)

```typescript
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});

// Automatic instrumentation:
// - HTTP request tracing
// - Database query tracking
// - Exception capture with context
```

---

## Node Development & Extension

### Custom Node SDK

```typescript
// @n8n/extension-sdk provides interfaces
import { INodeType, INodeExecuteFunctions } from 'n8n-core';

export class MyCustomNode implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'My Custom Node',
    name: 'myCustomNode',
    group: ['transform'],
    version: 1,
    inputs: ['main'],
    outputs: ['main'],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        options: [/* ... */],
      },
    ],
  };

  async execute(this: INodeExecuteFunctions) {
    // Node logic
  }
}
```

**Why separate SDK:**
- Third-party developers build nodes without entire n8n codebase
- Type definitions isolated in `@n8n/extension-sdk`
- Packaging standardized via `@n8n/node-cli`

---

## Testing Strategy

### Unit Tests (Jest)

```bash
# Run unit tests for a package
cd packages/cli
pnpm test:unit

# Configuration: packages/cli/jest.config.unit.js
# Transforms: ts-jest
# Mocking: jest-mock-extended (typed mocks)
# HTTP mocking: nock
```

### Integration Tests

```bash
# SQLite (fast, in-memory)
pnpm test:integration --db=sqlite

# PostgreSQL (real schema)
pnpm test:integration --db=postgres

# Test containers (testcontainers-node) for isolation
```

### E2E Tests (Playwright)

```bash
# Local development
pnpm --filter=n8n-playwright test:local

# Container-based (fresh DB per test)
pnpm --filter=n8n-playwright test:container:sqlite

# Multi-user scenarios
tests/e2e/building-blocks/user-service.spec.ts
```

**Playwright Janitor (Architecture Enforcement):**
- `/Users/ib/prj-other/n0n/n8n/packages/testing/janitor/package.json` - Static test analysis
- Enforces layered architecture: Tests → Flows → Page Objects → Playwright API
- Catches selector leakage, dead code, duplicate logic via AST fingerprinting

---

## Key Configuration Files Reference

| File | Purpose | Critical Section |
|------|---------|------------------|
| **`package.json`** | Root package metadata | Engines (Node >=22.16), pnpm catalog |
| **`pnpm-workspace.yaml`** | Workspace configuration | Catalogs (version pins), patches, overrides |
| **`pnpm-lock.yaml`** | Deterministic lock file | 9.0 format (pnpm v10 native) |
| **`turbo.json`** | Build orchestration | Task dependencies, cache outputs |
| **`tsconfig.json`** | TypeScript base config | Extends shared config |
| **`biome.jsonc`** | Code formatter rules | Tab indent (2), LF line endings |
| **`packages/@n8n/typescript-config/tsconfig.common.json`** | Shared TS config | Strict mode, ESM modules |
| **`packages/@n8n/eslint-config/`** | Shared ESLint rules | React/Vue/Node plugins |
| **`.github/scripts/`** | Build scripts | License generation, Docker image |

**Workspace root config:**
- `/Users/ib/prj-other/n0n/n8n/package.json:1-165` - Monorepo root with pnpm overrides
- `/Users/ib/prj-other/n0n/n8n/pnpm-workspace.yaml:1-153` - Workspace and catalog definitions
- `/Users/ib/prj-other/n0n/n8n/turbo.json:1-50` - Build task graph

---

## Stack Assessment

### Design Philosophy

**n8n's technology stack reflects three core design principles:**

1. **Type Safety Over Runtime Flexibility**
   - TypeScript everywhere (no `any` allowed)
   - Strict schemas via Zod for runtime validation
   - Type inference from Zod enables compile-time guarantees
   - Reduces bugs in user expressions via vm2 sandboxing

2. **Dependency Injection & Loose Coupling**
   - Every major service (database, cache, logger) injected at runtime
   - Enables multi-database support without recompilation
   - Testing uses mock implementations of interfaces
   - Scaling adds worker processes by injecting same repositories into new context

3. **Isolation & Security by Default**
   - User expressions run in vm2 sandbox (no filesystem/process access)
   - Credentials encrypted at rest, decrypted on-demand
   - Each execution context has minimal capabilities (no global state)
   - Webhook handlers isolated per trigger node

### Performance Characteristics

**Strengths:**
- **Fast startup (dev):** Source-first approach + Turbo caching → <5s cold boot
- **Build scalability:** Turbo graph enables parallel package builds; 56 packages in ~90s
- **Execution speed:** Direct mode (no queue) for development; queue-based for distributed
- **Frontend:** Vite + rolldown = ESM-native builds; Vue 3 reactivity model
- **Database:** PostgreSQL JSONB for flexible data shapes; indexes on common query patterns

**Potential Bottlenecks:**
- **Large workflows:** Graph traversal O(n) for n nodes; UI lag with >1000 nodes
- **Node execution:** Serial execution (each node waits for previous) unless parallel branches
- **Expression evaluation:** vm2 has CPU/memory limits to prevent DoS; can timeout on complex logic
- **Credential loading:** Decryption happens per-execution (mitigated by Redis caching)

### Operational Requirements

**Infrastructure:**
- **PostgreSQL 12+** or **SQLite** (for dev)
- **Redis 6+** (BullMQ queue backend)
- **Node.js 22.16+** (modern async/await, performance)
- **2GB RAM minimum** (dev); 4GB+ (production)
- **Disk:** 10GB+ (20M execution records, node packages)

**Scaling Pattern:**
1. Single server: n8n server + PostgreSQL + Redis (all localhost)
2. Two-tier: n8n server on one host; PostgreSQL/Redis on another
3. Distributed: Load-balanced n8n servers → shared PostgreSQL/Redis (BullMQ workers in separate processes)
4. Kubernetes: StatefulSet for servers; separate Deployments for workers

**Upgrades:**
- TypeORM migrations run automatically on startup
- No breaking schema changes; backward-compatible migrations only
- npm/pnpm upgrade workflow: lock file → test → deploy

### Extensibility & Ecosystem

**Well-supported extension points:**
- Custom nodes via `@n8n/extension-sdk` (INodeType interface)
- Custom webhooks/triggers (webhookMethods interface)
- Custom credentials (ICredentialType)
- Workflow transformations (n8n-workflow expression library)
- LangChain integration layer enables 100+ AI/vector models

**Governance:**
- n8n-nodes-base (400+ nodes) is official repository
- Community nodes supported but not actively maintained
- Breaking changes to INodeType require major version bump
- Credential format versioned per type (allows schema evolution)

---

## Key Files

| File Path | Purpose | Why It Matters |
|-----------|---------|----------------|
| `/Users/ib/prj-other/n0n/n8n/package.json:1-83` | Root monorepo config | Defines engines, Turbo, pnpm catalog versions |
| `/Users/ib/prj-other/n0n/n8n/pnpm-workspace.yaml:1-153` | Workspace structure + catalogs | All dependency version pins defined here |
| `/Users/ib/prj-other/n0n/n8n/turbo.json:1-50` | Build orchestration | Task dependency graph, cache config |
| `/Users/ib/prj-other/n0n/n8n/biome.jsonc:1-55` | Code formatting rules | Formatter config (tabs, line width, semicolons) |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/package.json:96-199` | Server dependencies | Express, TypeORM, BullMQ, Sentry, logging |
| `/Users/ib/prj-other/n0n/n8n/packages/core/package.json:42-83` | Execution engine deps | Workflow AST, axios for HTTP, winston for logs |
| `/Users/ib/prj-other/n0n/n8n/packages/workflow/package.json:53-72` | Workflow interfaces | Node/edge definitions, expression evaluation |
| `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/package.json:24-150` | Frontend dependencies | Vue 3, Pinia, Element Plus, CodeMirror, Vue Flow |
| `/Users/ib/prj-other/n0n/n8n/packages/@n8n/design-system/package.json:50-71` | Design system components | Element Plus, Reka UI, Tailwind CSS |
| `/Users/ib/prj-other/n0n/n8n/packages/@n8n/db/package.json:24-44` | Database layer | TypeORM, class-validator, repository interfaces |
| `/Users/ib/prj-other/n0n/n8n/packages/@n8n/nodes-langchain/package.json:202-283` | AI/LangChain nodes | Vector DBs, LLM SDKs, embedding models |
| `/Users/ib/prj-other/n0n/n8n/packages/@n8n/di/package.json:1-30` | Dependency Injection container | reflect-metadata, IoC implementation |
| `/Users/ib/prj-other/n0n/n8n/packages/testing/playwright/package.json:34-59` | E2E test suite | Playwright, test utilities, janitor analysis |
| `/Users/ib/prj-other/n0n/n8n/packages/@n8n/config/package.json:24-31` | Configuration management | Zod schema validation, environment variable parsing |
| `/Users/ib/prj-other/n0n/n8n/packages/@n8n/backend-common/package.json:24-36` | Shared backend utilities | Winston logging, reflect-metadata, yargs-parser |
| `/Users/ib/prj-other/n0n/n8n/packages/@n8n/extension-sdk/package.json` | Custom node SDK | Public API for third-party node development |
| `/Users/ib/prj-other/n0n/n8n/packages/@n8n/permissions/package.json:24-25` | RBAC system | Zod schemas for permission validation |
| `/Users/ib/prj-other/n0n/n8n/packages/@n8n/errors/package.json:27-28` | Error hierarchy | callsites for stack trace inspection |
| `/Users/ib/prj-other/n0n/n8n/packages/@n8n/codemirror-lang/package.json` | Expression language | n8n expression syntax highlighting |

---

## Summary: Why This Stack

**Why Express over Fastify/Elysia?**
- n8n predates modern frameworks; switching has high risk for marginal gain
- Express 5 provides modern async/await support
- Massive ecosystem of middleware (OAuth, rate limiting, compression, metrics)

**Why Vue 3 over React?**
- Simpler API for complex UI logic (composition API vs hooks)
- Smaller bundle size critical for performance-sensitive workflow editor
- Element Plus provides unified enterprise component library

**Why Turbo over Nx?**
- Lighter-weight orchestration; better for hybrid monorepos (many small packages)
- Caching optimized for incremental builds (95% of changes affect <5 packages)

**Why BullMQ + Redis over native job queues?**
- Distributed architecture from day one (supports scaling to >1000 concurrent workflows)
- Persistent queue survives server crashes
- pub/sub enables cross-worker communication

**Why vm2 sandbox for expressions?**
- User-written code must not access `process`, file system, or globals
- Isolation prevents credential leakage in expressions
- CPU/memory limits prevent DoS via infinite loops

**Why Zod over other validators?**
- Runtime type validation + compile-time type inference
- Better DX than JSON Schema or class-based validators
- Version pinned across monorepo ensures consistency

---

## End of Analysis

This document provides the complete technology stack inventory for n8n as of v2.10.0. Every major dependency choice reflects the platform's core design principles: type safety, distributed execution, extensibility, and security. The monorepo structure supports both internal scalability (55+ packages) and external extensibility (custom nodes, webhooks, credentials).

For architectural questions or dependency upgrade planning, refer to the file paths and version catalogs documented above. All key packages are version-pinned in `/Users/ib/prj-other/n0n/n8n/pnpm-workspace.yaml` to ensure reproducible builds across the organization.
