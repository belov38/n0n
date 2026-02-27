# Frontend Stack Decisions

**Decision date:** 2026-02-27 | **Framework:** React 19

## Stack Summary

| Area | Choice | Key Reason |
|------|--------|------------|
| Client State | **Zustand** | 1.2KB, React 19 native, excellent devtools, subscription model |
| Server State | **TanStack Query** | Cache invalidation + WS events, handles ~80% of data fetching |
| UI Components | **shadcn/ui** | Mature, Radix-based a11y, copy-into-project ownership, Tailwind |
| Code Editor | **CodeMirror 6** | 30-50KB (vs Monaco's 500KB+), custom Lezer grammars |
| Read-only Code | **Shiki** | Zero client JS, VS Code grammars, server-renderable |
| Routing | **React Router v7** | Library/data mode, SPA with separate backend |
| Real-time Push | **Bun native WebSocket** | Already implemented, lower overhead than Socket.IO |
| Data Fetching | **TanStack Query + WS invalidation** | WS events trigger query invalidation, TQ handles refetch |

---

## 1. State Management: Zustand + TanStack Query

### Zustand (client/UI state)

- **Version:** 4.5.x, React 19 fully compatible
- **Bundle:** ~1.2KB gzipped
- **Pattern:** Separate stores per concern (workflow, ui, execution, credentials, node-types, push)
- **Middleware:** `devtools` (Redux DevTools time-travel), `persist` (localStorage), `immer` (mutable-style updates). Order: immer → persist → devtools
- **Performance:** ~12ms single state update with 1000 subscribed components

Zustand handles pure UI state: panel open/closed, selected nodes, drag state, theme, modal states.

### TanStack Query (server/remote state)

- **Version:** v5, React 19 compatible
- **Role:** Server state cache — workflows list, execution data, node types, credentials list
- **Features:** Auto background refetch, stale-while-revalidate, optimistic updates, deduplication, pagination

This is the biggest improvement over n8n's pattern. Currently Zustand stores manually manage server data. Moving to TanStack Query:
1. Eliminates manual loading/error states
2. Adds automatic cache invalidation from WS events
3. Reduces Zustand stores to pure UI state
4. Handles deduplication when multiple components need same data

**WS + TanStack Query integration pattern:**
```
WS event (execution.completed)
  → queryClient.invalidateQueries({ queryKey: ['executions', executionId] })
  → TanStack Query auto-refetches in background
  → UI updates with fresh server data
```

**Migration path:** Incremental. Add alongside Zustand. Move server-fetched data one store at a time. Start with `workflows` and `executions`.

### Alternatives not chosen

| Library | Why Not |
|---------|---------|
| **Jotai** | Atomic model is overkill — our stores are mostly independent, not interdependent. |
| **Legend State** | React 19 `observer` conflicts. Smaller ecosystem. |
| **TanStack Store** | Alpha stage, API unstable. |

---

## 2. UI Components: shadcn/ui

- **Status in 2026:** Mature, actively maintained, large ecosystem
- **Foundation:** Built on Radix UI primitives = solid accessibility (keyboard nav, screen readers, ARIA)
- **Theming:** CSS variables + Tailwind, runtime dark/light switching, design token system
- **Ownership:** Copy-into-project model — we own the code, customize freely, no patching

2025-2026 additions: multiple style variants, RTL support, password toggle, expanded registry, community dashboard templates.

For components shadcn/ui lacks (color picker, date picker, tree view, splitter), supplement with individual Ark UI components rather than switching wholesale.

---

## 3. Code Editor: CodeMirror 6

- **Bundle:** 30-50KB (minimal setup) — 10x smaller than Monaco's 500KB+
- **React wrapper:** `@uiw/react-codemirror` (well maintained, production-proven)
- **Custom languages:** Lezer parser framework for n0n expression syntax (`{{ }}`)
- **Use cases:** Expression editor in NDV, Code node editor, JSON input/output display

### Shiki (read-only code display)

- Zero client JS, server-rendered highlighting using VS Code TextMate grammars
- Use for: execution output display, log viewing, read-only code preview in workflow sharing

### Alternative not chosen

| Editor | Why Not |
|--------|---------|
| **Monaco** | 500KB+ bundle. Full IDE experience is overkill for embedded panels. |

---

## 4. Routing: React Router v7 (Library/Data Mode)

- React 19 fully compatible
- **Library/data mode** — SPA with separate Elysia backend, no need for framework (full-stack) mode
- Consider upgrading from declarative to data mode for route-level data loading (loaders can prefetch TanStack Query queries)

### Alternative not chosen

| Router | Why Not |
|--------|---------|
| **TanStack Router** | Type-safe route params are nice, but migration cost not justified. Consider if RR causes type-safety pain. |

---

## 5. Real-time: Bun Native WebSocket

- Already implemented in `@n0n/api-client` push client + `@n0n/stores` push store
- ~30% more messages/sec than Socket.IO
- Missing vs Socket.IO: auto-reconnection, rooms/namespaces, HTTP fallback — implement reconnection with exponential backoff ourselves

### Alternative not chosen

| Transport | Why Not |
|-----------|---------|
| **Socket.IO** | 10-20% message size overhead. Extra dependency for features we can implement incrementally. |

---

## Action Plan

### Immediate (no breaking changes)
1. Add `@tanstack/react-query` as dependency
2. Set up `QueryClient` provider in app shell
3. Migrate `workflows` store server data to TanStack Query (keep UI state in Zustand)

### Short-term
4. Migrate `executions` store server data to TanStack Query
5. Integrate WS push events with query invalidation
6. Add CodeMirror 6 for expression editor in NDV
7. Add Shiki for read-only execution output display

### Medium-term
8. Migrate remaining server state stores to TanStack Query
9. Build custom expression language for CodeMirror (Lezer grammar)

---

## Sources

- [Zustand](https://github.com/pmndrs/zustand)
- [TanStack Query](https://tanstack.com/query)
- [shadcn/ui](https://ui.shadcn.com)
- [CodeMirror 6](https://codemirror.net)
- [@uiw/react-codemirror](https://github.com/uiwjs/react-codemirror)
- [React Router v7](https://reactrouter.com/start/modes)
