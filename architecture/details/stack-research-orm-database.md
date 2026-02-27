# ORM / Database Layer Research for n0n

**Research Date:** February 2026
**Runtime:** Bun.js
**Database:** PostgreSQL (primary), SQLite (dev/test option)
**Context:** Workflow automation platform, ~50+ tables, JSON workflow definitions

---

## Why This Matters

n8n uses a forked TypeORM (`@n8n/typeorm 0.3.20-16`) that required custom patches for PostgreSQL/SQLite dual support. We need to choose a database layer that:
- Works natively on Bun without Node.js polyfills
- Handles 50+ tables with complex joins, aggregations, JSON columns
- Has a mature migration system for production schema evolution
- Provides strong TypeScript type safety
- Performs well under concurrent workflow execution load

---

## 1. Drizzle ORM (Current Choice)

**Version:** 0.35+ stable, 1.0.0-beta.2 (migration engine rewrite)
**Bundle:** ~7.4 KB min+gzip
**GitHub Stars:** ~30k+
**License:** Apache 2.0

### Bun Compatibility
Excellent. Drizzle was designed for multi-runtime from day one. Dedicated adapters for `postgres.js`, `node-postgres`, Neon, Supabase. Works with Bun's native SQL drivers without polyfills.

### Two Query APIs

**SQL-like query builder** (primary API):
```typescript
const workflows = await db
  .select()
  .from(workflowTable)
  .where(eq(workflowTable.active, true))
  .leftJoin(tagTable, eq(workflowTable.id, tagTable.workflowId))
  .limit(50);
```

**Relational query API** (Prisma-like):
```typescript
const workflow = await db.query.workflows.findFirst({
  where: eq(workflows.id, id),
  with: { tags: true, sharedWith: { with: { user: true } } },
});
```

Both APIs are type-safe. The relational API handles nested relations without manual joins. The SQL-like API gives full control for complex aggregations.

### JSON/JSONB Support
Type-safe with explicit generics:
```typescript
export const workflows = pgTable('workflows', {
  nodes: jsonb<INode[]>('nodes').notNull().default([]),
  connections: jsonb<IConnections>('connections').notNull().default({}),
  settings: jsonb<IWorkflowSettings>('settings'),
});
```

Recent fixes for JSONB default value parsing (was a known bug in earlier versions).

### Migration System (drizzle-kit)
The 1.0.0-beta.2 release rewrote the migration engine ("Alternation Engine") with test coverage expanded from 600 to 9,000+ cases. Commands:
- `drizzle-kit generate` -- produces SQL migration files from schema diff
- `drizzle-kit migrate` -- applies migrations
- `drizzle-kit push` -- direct schema sync (dev only)
- `drizzle-kit pull` -- introspect existing DB into schema files

Schema is defined in TypeScript, migrations are SQL files in version control. You always see exact SQL before applying.

### Performance
Benchmarks on PostgreSQL 18.1 with ~1M rows (source: habibium.com/blog/bun-sql-vs-drizzle):

| Query Type | Native Bun SQL | Drizzle (prepared) | Overhead |
|---|---|---|---|
| Point read | 493 us | 531 us | +8% |
| Aggregation | 480 us | 575 us | +20% |
| Complex multi-join | 750 ms | 703 ms | -6% (faster) |

For complex queries, Drizzle's consistent query structure actually helps the PostgreSQL query planner. The 8% overhead on simple reads translates to ~38 us -- negligible compared to network latency.

### Strengths
- Smallest bundle size of all ORMs (7.4 KB)
- SQL-first: what you write maps directly to SQL
- Schema-as-code with full TypeScript inference
- Both high-level relational and low-level SQL APIs
- Native Bun support, no binary dependencies
- Migration system reaching production maturity

### Weaknesses
- Still pre-1.0 (0.35+), API surface may shift
- Documentation thinner than Prisma
- Relational query API less battle-tested than Prisma's
- Schema-as-code requires TypeScript comfort for DB constraints
- Fewer integrations/plugins than Prisma ecosystem

---

## 2. Prisma ORM

**Version:** 7.3.0 (major rewrite in v7)
**Bundle:** ~1.6 MB (down from ~14 MB in v6)
**GitHub Stars:** ~40k+
**License:** Apache 2.0

### Major Change in v7: Rust Engine Removed
Prisma 7 eliminated the Rust query engine that caused deployment problems for years. Results:
- 90% bundle size reduction (14 MB -> 1.6 MB)
- 3x faster query latency
- 70% faster type checking
- No more native binary dependencies

### Bun Compatibility
Now excellent in v7+. The ESM-first `prisma-client` generator produces Bun-compatible output. Running `prisma init` in Bun detects the runtime and skips `dotenv` import. No polyfills needed.

### Schema-First Approach
```prisma
model Workflow {
  id          String   @id @default(cuid())
  name        String
  nodes       Json
  connections Json
  active      Boolean  @default(false)
  tags        Tag[]
  executions  Execution[]
  createdAt   DateTime @default(now())
}
```

Type generation from schema file. Single source of truth but requires `prisma generate` step after schema changes.

### JSON/JSONB Support
JSON columns use the `Json` scalar type. No granular typing -- the generated type is `Prisma.JsonValue` which requires manual type assertions:
```typescript
const workflow = await prisma.workflow.findUnique({ where: { id } });
const nodes = workflow.nodes as INode[]; // manual cast required
```

Worse type safety for JSON columns than Drizzle.

### Migration System
Mature and production-proven. `prisma migrate dev` generates SQL migrations from schema changes. Includes:
- Automated diff detection
- CI preview of destructive changes
- Expand-and-contract pattern support
- Detailed error messages for conflicts

### Performance (v7)
Competitive with Drizzle for most queries after the Rust engine removal. The `$executeRaw` and `$queryRaw` in v7.3.0 bypass the query compiler entirely for hand-tuned SQL. New `compilerBuild` option: "fast" (speed-optimized) or "small" (bundle-optimized).

### Strengths
- Largest ecosystem, best documentation
- Most mature migration system
- Schema-first approach enforces consistency
- Huge community, answers to every common problem exist
- `prisma studio` for visual DB browsing
- Production track record at scale

### Weaknesses
- 1.6 MB bundle still 200x larger than Drizzle (matters for serverless/cold starts)
- Schema-first requires code generation step
- `Json` type lacks granular TypeScript inference
- Prisma Schema Language is another DSL to learn
- More opinionated, harder to escape when needed
- Query abstraction hides SQL, harder to optimize complex queries

---

## 3. Kysely

**Version:** Latest stable (2025-2026)
**Bundle:** ~35 KB min+gzip
**GitHub Stars:** ~15k+
**License:** MIT

### Approach
Type-safe SQL query builder. No ORM abstraction layer, no schema generation step. Types are derived at compile time from TypeScript interfaces.

### Bun Compatibility
Excellent. Pure TypeScript, minimal dependencies. Works with `postgres.js` and `pg` drivers on Bun without polyfills.

### Type Safety
```typescript
interface Database {
  workflows: WorkflowTable;
  executions: ExecutionTable;
  // ... 50+ table interfaces
}

const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

const result = await db
  .selectFrom('workflows')
  .where('active', '=', true)
  .innerJoin('tags', 'tags.workflowId', 'workflows.id')
  .select(['workflows.id', 'workflows.name', 'tags.name as tagName'])
  .execute();
// result type is fully inferred
```

Each query chain method narrows types. No code generation -- type changes are immediate.

### JSON/JSONB Support
Requires SQL template literals for JSON operations:
```typescript
const result = await db
  .selectFrom('workflows')
  .select([
    'id',
    sql<string>`nodes->>'name'`.as('nodeName'),
  ])
  .execute();
```

Less ergonomic than Drizzle for typed JSON columns. Complex JSON shapes often need `unknown` + type guards.

### Migration System
Community-maintained `kysely-ctl`. More manual setup than Drizzle Kit or Prisma Migrate. Provides building blocks (schema API for CREATE/ALTER) but no automatic diff generation.

### Strengths
- No code generation step, instant type feedback
- Small bundle (~35 KB)
- Close to SQL, minimal abstraction
- Works perfectly on Bun
- Good for teams that know SQL well

### Weaknesses
- No automatic migration generation (manual SQL or community tools)
- 50+ table interfaces are tedious to maintain manually (kysely-codegen helps)
- JSON column typing is weak
- Smaller ecosystem than Drizzle/Prisma
- No relational query API (all joins are explicit)
- More boilerplate for common patterns

---

## 4. postgres.js (porsager/postgres)

**Version:** Latest stable
**Bundle:** ~50 KB
**GitHub Stars:** ~7k+
**License:** Unlicense

### What It Is
Raw PostgreSQL driver. Not an ORM, not a query builder. SQL template literals with automatic parameterization.

```typescript
import postgres from 'postgres';
const sql = postgres({ host: 'localhost', database: 'n0n' });

const workflows = await sql`
  SELECT w.*, array_agg(t.name) as tags
  FROM workflows w
  LEFT JOIN tags t ON t.workflow_id = w.id
  WHERE w.active = true
  GROUP BY w.id
  LIMIT 50
`;
```

### Bun Compatibility
Excellent. Pure JavaScript, ESM-first, async/await native.

### Features
- Built-in connection pooling (transparent, configurable)
- Automatic SQL injection prevention via template literals
- Prepared statements
- LISTEN/NOTIFY support
- Transaction support
- Streaming large result sets

### When to Use
- As the underlying driver for Drizzle or Kysely
- For performance-critical queries that ORMs can't optimize
- For raw SQL escape hatches in an ORM-based codebase

### Weaknesses
- No type safety for queries (manual type definitions)
- No migration system
- No schema management
- Every query is hand-written SQL
- Maintaining 50+ tables of raw SQL queries is error-prone

---

## 5. Bun Native SQLite (bun:sqlite)

**Version:** Built into Bun 1.2+
**Bundle:** 0 KB (built-in)

### What It Is
Native SQLite driver built into Bun runtime. 3-10x faster than `better-sqlite3`.

```typescript
import { Database } from 'bun:sqlite';
const db = new Database(':memory:');
```

### When Useful for n0n
- **Unit tests:** In-memory SQLite for fast isolated test databases
- **Dev environment:** Quick local development without Docker PostgreSQL
- **Embedded scenarios:** Single-user local deployments

### Limitations
- Cannot replace PostgreSQL in production (single-file, no concurrent writes at scale)
- SQL dialect differences from PostgreSQL (no JSONB operators, different type system)
- Schema must be compatible with both SQLite and PostgreSQL if used for dev/test
- Both Drizzle and Kysely support SQLite dialect, making the switch manageable

### Recommendation
Use for unit tests with in-memory databases. Keep PostgreSQL via Docker for integration tests and development to avoid dialect mismatch surprises.

---

## 6. Other Options Considered

### MikroORM
Active development, improved Bun support in 2025. Data-mapper pattern similar to TypeORM. Smaller community than Drizzle/Prisma. Not compelling enough to justify switching.

### Electric SQL
Local-first database with PostgreSQL sync. Interesting for offline-capable workflow clients. Still in development phases, premature for production use. Worth monitoring.

### TypeORM
n8n's choice (with a fork). Maintenance has slowed. Known bugs with decorator-based entity definitions. Not recommended for new projects in 2026.

---

## Comparison Matrix

| Criteria | Drizzle | Prisma 7 | Kysely | postgres.js |
|---|---|---|---|---|
| **Bundle size** | 7.4 KB | 1.6 MB | ~35 KB | ~50 KB |
| **Bun native** | Yes | Yes (v7+) | Yes | Yes |
| **Type safety** | Excellent | Excellent | Excellent | Manual |
| **JSON/JSONB typing** | Strong (generics) | Weak (Json scalar) | Moderate (sql literals) | None |
| **Migration system** | Good (drizzle-kit) | Best (prisma migrate) | Community tools | None |
| **Query flexibility** | SQL-like + relational | Prisma Query Language | Pure SQL builder | Raw SQL |
| **Complex query support** | Both APIs available | Limited, escape to raw | Full SQL control | Full SQL control |
| **Schema definition** | TypeScript code | Prisma Schema Language | TypeScript interfaces | None |
| **Code generation step** | No | Yes (prisma generate) | No (or optional codegen) | No |
| **Startup time** | Fastest | Slowest | Fast | Fast |
| **Documentation** | Good | Best | Good | Good |
| **Community size** | Large | Largest | Medium | Medium |
| **Production maturity** | High | Highest | High | Highest |
| **Learning curve** | Moderate (SQL knowledge helps) | Low (abstracted) | Moderate | High (raw SQL) |

---

## Performance Summary

Based on PostgreSQL 18.1 benchmarks with ~1M rows on Bun:

| Scenario | postgres.js (baseline) | Drizzle (prepared) | Prisma 7 (est.) | Notes |
|---|---|---|---|---|
| Point read | 493 us | 531 us (+8%) | ~550 us | Negligible difference |
| Aggregation | 480 us | 575 us (+20%) | ~580 us | Still under 0.6ms |
| Complex multi-join | 750 ms | 703 ms (-6%) | ~720 ms | Drizzle's structure helps planner |
| Cold start | ~0 ms | ~1 ms | ~50-100 ms | Bundle size dependent |

In real requests with network latency (10-50ms), TLS (5-30ms), auth middleware, and response serialization, the ORM overhead is ~0.04% of total request time.

---

## Recommendation: Stay with Drizzle ORM

### Primary Reasons

**1. Best Bun.js alignment.** Drizzle was built for multi-runtime from the start. No binary dependencies, smallest bundle, fastest cold starts. This matters for both server and potential serverless/edge deployments.

**2. SQL-first matches our needs.** With 50+ tables and complex queries (workflow execution joins, aggregation for analytics, JSON workflow traversal), being close to SQL is an advantage. The relational query API handles simple CRUD; the SQL-like API handles everything else.

**3. JSON/JSONB is a first-class concern.** Workflow definitions (nodes, connections, settings) are stored as JSONB. Drizzle's typed `jsonb<T>()` columns give compile-time safety that Prisma's `Json` scalar cannot match.

**4. No code generation step.** Schema changes are immediately reflected in types. No `prisma generate` friction during development.

**5. Migration system is maturing at the right time.** The 1.0.0-beta.2 migration engine rewrite with 9,000+ tests lands as we're building out our schema. By the time n0n reaches production, drizzle-kit will be fully stable.

**6. Performance.** 8% overhead on simple reads, and actually faster than raw SQL on complex joins. The 7.4 KB bundle is 200x smaller than Prisma.

### When to Reconsider

- If the team grows significantly and Prisma's ecosystem/docs advantage outweighs Drizzle's technical advantages
- If Drizzle 1.0 introduces breaking changes that are costly to migrate
- If we need Prisma-specific features (Prisma Accelerate, Prisma Studio, Prisma Pulse)

### Architecture Notes

- Use `postgres.js` as the underlying driver for Drizzle
- Use Drizzle's relational query API for simple CRUD operations
- Use Drizzle's SQL-like query builder for complex queries with joins/aggregations
- Use `bun:sqlite` for unit tests with in-memory databases where dialect-safe
- Use Docker PostgreSQL for integration tests
- Define all JSON column types explicitly with `jsonb<T>()` for workflow data

### Driver Stack

```
Application Code
    |
Drizzle ORM (7.4 KB, type-safe queries)
    |
postgres.js driver (connection pooling, parameterization)
    |
PostgreSQL 16+
```

---

## Sources

- Drizzle ORM docs: https://orm.drizzle.team
- Drizzle 1.0-beta.2 release notes: https://orm.drizzle.team/docs/latest-releases/drizzle-orm-v1beta2
- Drizzle-kit overview: https://orm.drizzle.team/docs/kit-overview
- Bun SQL vs Drizzle benchmarks: https://habibium.com/blog/bun-sql-vs-drizzle
- Prisma 7.3.0 release: https://www.prisma.io/blog/prisma-orm-7-3-0
- Prisma 7.2.0 (Bun config): https://www.prisma.io/blog/announcing-prisma-orm-7-2-0
- Drizzle vs Prisma comparison: https://makerkit.dev/blog/tutorials/drizzle-vs-prisma
- Kysely docs: https://kysely.dev/docs/getting-started
- Kysely migrations: https://kysely.dev/docs/migrations
- Bun SQLite: https://oneuptime.com/blog/post/2026-01-31-bun-sqlite/view
- Bun PostgreSQL: https://oneuptime.com/blog/post/2026-01-31-bun-postgresql/view
