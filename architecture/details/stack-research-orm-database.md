# ORM / Database — Drizzle ORM + PostgreSQL

**Decision date:** 2026-02-27 | **Runtime:** Bun

## Choice: Drizzle ORM with postgres.js driver on PostgreSQL

Drizzle is a SQL-first TypeScript ORM with the smallest bundle (7.4KB), no codegen step, and native Bun support. PostgreSQL is the sole database target (no SQLite dual-support complexity).

### Why Drizzle

1. **Best Bun alignment.** Multi-runtime from day one. No binary dependencies. 7.4KB gzipped (200x smaller than Prisma). Fastest cold starts.

2. **SQL-first matches our needs.** 50+ tables with complex joins, aggregations, and JSON workflow traversal. Two APIs: SQL-like query builder for complex queries, relational API for simple CRUD. What you write maps directly to SQL.

3. **Typed JSONB columns.** `jsonb<INode[]>('nodes')` gives compile-time safety for workflow definitions. Prisma's `Json` scalar requires manual casts.

4. **No codegen step.** Schema changes are immediately reflected in types. No `prisma generate` friction.

5. **Migration system maturing.** drizzle-kit 1.0.0-beta.2 rewrote the migration engine with 9,000+ test cases. `generate` → SQL files in VCS. `push` for dev. `pull` for introspection.

### Key Specs

| Metric | Value |
|--------|-------|
| Version | 0.35+ stable, 1.0.0-beta.2 (migrations) |
| Bundle | ~7.4 KB gzipped |
| GitHub stars | ~30k+ |
| License | Apache 2.0 |
| Driver | postgres.js |
| Database | PostgreSQL only (no SQLite in production) |

### Performance (PostgreSQL 18.1, ~1M rows)

| Query Type | Native postgres.js | Drizzle (prepared) | Overhead |
|------------|-------------------|-------------------|----------|
| Point read | 493 us | 531 us | +8% |
| Aggregation | 480 us | 575 us | +20% |
| Complex multi-join | 750 ms | 703 ms | -6% (faster) |

ORM overhead is ~0.04% of total request time when including network latency, TLS, and auth middleware.

### Schema Pattern for n0n

```typescript
import { pgTable, text, boolean, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const workflows = pgTable('workflows', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nodes: jsonb<INode[]>('nodes').notNull().default([]),
  connections: jsonb<IConnections>('connections').notNull().default({}),
  settings: jsonb<IWorkflowSettings>('settings'),
  active: boolean('active').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```

### Implementation Notes for n0n

- **Driver stack:** Application → Drizzle ORM → postgres.js → PostgreSQL 16+
- Relational query API for simple CRUD (findFirst, findMany with nested relations)
- SQL-like query builder for complex queries (joins, aggregations, subqueries)
- All JSON column types defined with `jsonb<T>()` for workflow data
- Docker PostgreSQL for both dev and integration tests
- `bun:sqlite` only for isolated unit tests where dialect-safe

### Alternatives Considered

| ORM | Why Not |
|-----|---------|
| **Prisma 7** | 1.6MB bundle (200x larger). `Json` scalar lacks typed generics. Requires codegen step. |
| **Kysely** | No auto migration generation. 50+ table interfaces tedious to maintain. Weaker JSON typing. |
| **postgres.js (raw)** | No type safety, no migrations, no schema management. Fine as underlying driver. |
| **TypeORM** | n8n's choice (with fork). Maintenance slowed. Not recommended for new projects. |

### Sources

- [Drizzle ORM docs](https://orm.drizzle.team)
- [Drizzle 1.0-beta.2 release](https://orm.drizzle.team/docs/latest-releases/drizzle-orm-v1beta2)
- [Bun SQL vs Drizzle benchmarks](https://habibium.com/blog/bun-sql-vs-drizzle)
- [Drizzle vs Prisma](https://makerkit.dev/blog/tutorials/drizzle-vs-prisma)
