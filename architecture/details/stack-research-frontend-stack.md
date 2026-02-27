# Frontend Stack Research (Feb 2026)

Research for n0n workflow automation platform frontend. Current stack: React 19 + React Router v7 + Zustand + shadcn/ui.

## TL;DR Recommendations

| Area | Choice | Rationale |
|------|--------|-----------|
| Client State | **Zustand** (keep) | 1.2KB, React 19 native, 50+ stores proven, excellent devtools |
| Server State | **TanStack Query** (add) | Handles ~80% of state: workflows, executions, logs. Cache invalidation + WS |
| UI Components | **shadcn/ui** (keep) | Mature in 2026, new components, themes, RTL. Built on Radix = solid a11y |
| Code Editor | **CodeMirror 6** | 30-50KB vs Monaco's 500KB+. Modular, custom language via Lezer, good React wrapper |
| Read-only Code | **Shiki** | Zero client JS, server-rendered highlighting, VS Code grammars |
| Routing | **React Router v7** (keep, library/data mode) | SPA with separate backend = no need for framework mode. Stable, familiar |
| Real-time Push | **Native WebSocket** (keep) | Already implemented, lower overhead, no Socket.IO dependency needed |
| Data Fetching | **TanStack Query + WS invalidation** | WS events trigger `queryClient.invalidateQueries()`, TQ handles refetch/dedup |

---

## 1. State Management

### Zustand (current) -- KEEP

- **Version**: 4.5.x stable, React 19 fully compatible
- **Bundle**: ~1.2KB gzipped
- **50+ stores**: Proven at scale. Subscription model = components only re-render on their slice
- **Middleware**: `devtools` (Redux DevTools time-travel), `persist` (localStorage/custom), `immer` (mutable-style updates). Recommended order: immer -> persist -> devtools
- **Performance**: ~12ms for single state update with 1000 subscribed components, ~2.1MB memory overhead
- **Ecosystem**: Largest community among lightweight state managers, extensive docs

**For n0n**: Perfect fit for UI state (panel open/closed, selected nodes, drag state, theme). Keep current architecture of separate stores per concern.

### Jotai -- NOT RECOMMENDED (for our use case)

- **Version**: v2 stable, React 19 compatible
- **Bundle**: ~4KB gzipped
- **Model**: Atomic state -- individual atoms composed into derived atoms
- **Performance**: ~14ms single update (1000 components) -- marginally slower than Zustand
- **Strength**: Automatic derived state when many fields depend on each other
- **Weakness**: Different mental model, steeper learning curve, less intuitive for store-like patterns

**For n0n**: Overkill. Our stores are mostly independent (workflow store, ui store, execution store). Jotai shines when state has complex interdependencies (e.g., spreadsheet cells). We don't have that pattern.

### Legend State -- NOT RECOMMENDED

- **Model**: Observable-based fine-grained reactivity (Solid.js-inspired)
- **Performance**: Claims 35ms for 30+ field forms vs Zustand's 85ms (specific benchmark)
- **React 19 issue**: `observer` pattern conflicts with React compiler. Team advises using `Memo` component instead -- departure from core design
- **Ecosystem**: Small community, limited support resources

**For n0n**: React 19 compatibility concerns are a dealbreaker. Smaller ecosystem = risk for production.

### TanStack Store -- NOT RECOMMENDED

- **Status**: Alpha stage, API unstable, not production-ready
- **Philosophy**: Framework-agnostic, type-safe (like other TanStack tools)

**For n0n**: Monitor for future. Too risky for production now.

### TanStack Query -- ADD

- **Version**: v5 stable, React 19 compatible
- **Role**: Server state management (not client state)
- **Features**: Auto background refetch, stale-while-revalidate, optimistic updates, deduplication, pagination
- **WebSocket integration**: WS events -> `queryClient.invalidateQueries({ queryKey: ['executions', id] })` -> automatic refetch
- **Experimental**: `streamedQuery` API for long-lived streaming connections (execution logs)

**For n0n**: This is the biggest potential improvement. Currently our Zustand stores manually manage server data (workflows list, execution data, node types). Moving these to TanStack Query would:
1. Eliminate manual loading/error states
2. Add automatic cache invalidation from WS events
3. Reduce Zustand stores to pure UI state
4. Handle deduplication when multiple components need same data

**Migration path**: Incremental. Add TanStack Query alongside Zustand. Move server-fetched data one store at a time. Start with `workflows` and `executions` stores.

---

## 2. UI Component Library

### shadcn/ui (current) -- KEEP

- **Status in 2026**: Mature, actively maintained, large ecosystem
- **New in 2025-2026**:
  - Multiple style variants (no longer "all shadcn apps look the same")
  - RTL language support (Jan 2026)
  - Block support for Radix UI and Base UI
  - Password toggle field, expanded component registry
  - Design token system for runtime theme switching
  - Community registries: dashboard templates, SaaS patterns
- **Foundation**: Built on Radix UI primitives = solid accessibility (keyboard nav, screen readers, ARIA)
- **Theming**: CSS variables + Tailwind, runtime dark/light switching

**For n0n**: Good fit. Form components, dialogs, dropdowns, tooltips map directly to our needs. The copy-into-project model means we own the code and can customize freely.

### Radix UI Primitives

- **Status**: Actively maintained, foundation of shadcn/ui
- **New**: OneTimePasswordField (Apr 2025), z-index management improvements, collision detection fixes
- **React 19**: Fully compatible

**For n0n**: Already using indirectly through shadcn/ui. No need to use directly.

### Ark UI (from Chakra team)

- **Components**: 45+ headless components, framework-agnostic (React, Solid, Vue, Svelte)
- **Extras over Radix**: Color picker, carousel, date picker, file upload, pagination, pin input, signature pad, splitter, steps, tags input, tree view
- **Design**: State machine-driven behavior
- **React 19**: Fully compatible

**For n0n**: Worth monitoring. The extra components (color picker, date picker, tree view, splitter) could be useful. Could adopt individual Ark UI components where shadcn/ui lacks them rather than switching wholesale.

### Park UI (pre-styled Ark UI)

- **What**: Professional designs on top of Ark UI, uses Panda CSS
- **Comparison**: Like shadcn/ui but for Ark UI primitives instead of Radix

**For n0n**: Not recommended as primary. We're invested in Tailwind/shadcn. Switching CSS approach (Panda CSS) not justified.

### New libraries (2025-2026)

- Float UI, Cult UI, UI Layouts, 8bitcn -- niche/specialized
- Builder.io visual component generation -- interesting for design-to-code

**For n0n**: None warrant switching. Supplementary at best.

---

## 3. Code/Expression Editor

### CodeMirror 6 -- RECOMMENDED

- **Bundle**: 30-50KB (minimal setup) -- 10x smaller than Monaco
- **Architecture**: Modular extension system. Import only what you need
- **React wrapper**: `@uiw/react-codemirror` -- well maintained, production-proven
- **Custom languages**: Lezer parser framework. Define custom grammars for n0n expressions
- **Performance**: Handles tens of thousands of lines. Renders only visible lines
- **Use cases**: Expression editor in NDV, Code node editor, JSON editing

**For n0n**: Best fit. We need embedded editors in the NDV (Node Detail View) for:
- Expression editing (custom language with `{{ }}` syntax)
- Code node (JavaScript/TypeScript)
- JSON input/output display

CodeMirror's modularity keeps bundle small. Custom language support via Lezer enables expression editor with autocomplete.

### Monaco Editor -- NOT RECOMMENDED (for web)

- **Bundle**: 500KB+ -- too heavy for embedded use in a web app
- **Features**: Full VS Code experience (IntelliSense, debugging, extensions)
- **React wrapper**: `@monaco-editor/react` -- React 19 compatible
- **Best for**: Electron apps, dedicated code editing views

**For n0n**: Overkill and too heavy. Our editors are small embedded panels, not full IDEs. CodeMirror 6 provides what we need at 1/10th the size.

### Shiki -- RECOMMENDED (for read-only)

- **What**: Build-time syntax highlighting using VS Code's TextMate grammars
- **Output**: Static HTML with syntax classes -- zero client JS
- **Use cases**: Execution logs, read-only code display, workflow definition preview

**For n0n**: Use for:
- Execution output display in run data panels
- Log viewing
- Read-only code preview in workflow sharing

Can be server-rendered if we add SSR, or used client-side via `shiki` package.

---

## 4. Routing

### React Router v7 (current) -- KEEP (Data Mode)

- **Modes in v7**:
  - **Declarative**: Basic client-side routing (what we likely use now)
  - **Data**: Route-based loaders/actions for data fetching orchestration
  - **Framework**: Full-stack Remix-like experience (SSR, server actions, Vite integration)
- **React 19**: Fully compatible
- **Framework mode**: Essentially Remix merged into React Router. Best for full-stack apps

**For n0n**: We have a separate Elysia backend. Framework mode (full-stack) doesn't apply. Stay in **library/data mode**. Consider upgrading from declarative to data mode for route-level data loading when we add TanStack Query (loaders can prefetch queries).

### TanStack Router -- CONSIDER FOR FUTURE

- **Type safety**: Route params, search params validated at TypeScript compile time
- **File-based routing**: Directory or flat (dot-notation) file organization
- **Status**: v1 stable, React 19 compatible
- **Strength**: Complex hierarchical routes with typed params (workflow/:workflowId/execution/:executionId/step/:stepId)

**For n0n**: Type-safe route params would be genuinely useful for our hierarchical URLs. However, switching routing is disruptive. Not worth the migration cost right now. Consider if starting fresh or if React Router causes type-safety pain.

---

## 5. Real-time & Data Fetching

### Native WebSocket (current) -- KEEP

- **Current implementation**: Custom WS in `@n0n/api-client` push client + `@n0n/stores` push store
- **Performance**: Minimal overhead per message, ~30% more messages/sec than Socket.IO
- **Missing vs Socket.IO**: Auto-reconnection, rooms/namespaces, HTTP fallback

**For n0n**: Already implemented and working. Our target environment (modern browsers) supports WebSocket natively. We control the infrastructure. Add reconnection logic if not already present. No need for Socket.IO's fallback mechanisms.

### Socket.IO -- NOT RECOMMENDED (for our case)

- **Advantages**: Auto-reconnect, rooms, namespaces, HTTP long-polling fallback
- **Disadvantages**: 10-20% message size overhead, extra dependency, we already have native WS working

**For n0n**: Switching would add a dependency for features we can implement incrementally. Our WS push system works. Enhance it (reconnection, exponential backoff) rather than replace.

### TanStack Query + WebSocket -- RECOMMENDED PATTERN

Integration pattern for n0n:

```
WS event received (execution.completed)
  -> queryClient.invalidateQueries({ queryKey: ['executions', executionId] })
  -> TanStack Query auto-refetches in background
  -> UI updates with fresh server data
```

Benefits:
- Server is source of truth (not WS event payloads)
- Automatic deduplication (many WS events, one refetch)
- Stale-while-revalidate (show old data while fetching new)
- No manual cache management

For high-frequency updates (execution logs streaming), consider `streamedQuery` experimental API when it stabilizes.

---

## 6. Action Plan

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
10. Evaluate TanStack Router if route type safety becomes a pain point

### Not planned
- Legend State, Jotai, TanStack Store -- no compelling reason to switch from Zustand
- Monaco Editor -- too heavy for embedded use
- Socket.IO -- already have native WS working
- Park UI / Ark UI wholesale switch -- supplement shadcn with individual Ark components if needed

---

## Sources

Key references from research:
- Zustand: https://github.com/pmndrs/zustand
- Jotai: https://jotai.org
- TanStack Query: https://tanstack.com/query
- TanStack Router: https://tanstack.com/router
- shadcn/ui changelog: https://ui.shadcn.com/docs/changelog
- Radix UI releases: https://www.radix-ui.com/primitives/docs/overview/releases
- Ark UI: https://ark-ui.com, https://github.com/chakra-ui/ark
- Park UI: https://park-ui.com
- CodeMirror 6: https://codemirror.net/docs/changelog/
- @uiw/react-codemirror: https://github.com/uiwjs/react-codemirror
- React Router v7 modes: https://reactrouter.com/start/modes
- Legend State v3 migration: https://legendapp.com/open-source/state/v3/other/migrating/
- Performance benchmarks: https://dev.to/jsgurujobs/state-management-in-2026-zustand-vs-jotai-vs-redux-toolkit-vs-signals-2gge
- WebSocket vs Socket.IO: https://ably.com/topic/socketio-vs-websocket
