# Canvas Editor — React Flow 12

**Decision date:** 2026-02-27 | **Framework:** React 19

## Choice: React Flow 12 (@xyflow/react)

React Flow is the dominant React node-based graph editor. 35K+ GitHub stars, 4.8M weekly npm downloads. No competing library comes close for workflow automation canvas needs.

### Why React Flow

1. **Unchallenged leader.** 4.83M weekly downloads, 35K+ stars. Largest community, most examples, best documentation for workflow editors.

2. **React 19 + Zustand compatible.** Full compatibility confirmed (July 2025). Works with Zustand 4.5.6+ and Tailwind 4.

3. **SVG rendering is correct for our scale.** SVG and Canvas perform identically up to ~400 nodes (Horak et al., TU Dresden). Our target: 100-500 node workflows. SVG gives DOM/CSS/DevTools access.

4. **Custom nodes = React components.** Any React content works inside nodes: forms, charts, shadcn/ui components. Custom edges render SVG paths. Multiple handles per node supported natively.

5. **v12 features we need.** SSR support, `colorMode` (dark/light/system), `useHandleConnections` + `useNodesData` for computing flows, `EdgeReconnectAnchor`, improved TypeScript types.

### Key Specs

| Metric | Value |
|--------|-------|
| Version | 12.10.1+ (early 2026) |
| npm weekly | ~4.83M |
| License | MIT (core) |
| Rendering | SVG |
| Layout integration | dagre, elkjs, d3-hierarchy |
| Accessibility | Keyboard nav, ARIA, auto-focus panning |

### Performance (with optimization)

| Scenario | Without React.memo | With React.memo |
|----------|-------------------|-----------------|
| Simple text node (drag FPS) | ~10 FPS | ~55 FPS |
| Complex node (drag FPS) | ~2 FPS | ~25 FPS |

Critical optimizations:
1. Wrap ALL custom node/edge components in `React.memo`
2. Use granular Zustand selectors (never `state => state.nodes`)
3. Avoid anonymous functions in event handlers
4. Viewport-aware rendering for 500+ node flows

### Implementation Notes for n0n

- Connection validation via `isValidConnection` for typed port enforcement
- Layout: dagre.js (hierarchical, LR direction, 16px grid snapping) — matches n8n's approach
- Execution visualization: animated borders on running nodes, green edges with item count for success
- `useHandleConnections` + `useNodesData` for reactive data propagation between nodes

### Alternatives Considered

| Library | Why Not |
|---------|---------|
| **React Diagrams** | No React 19 official support. Canvas rendering (no DOM/CSS). Smaller community. |
| **Rete.js** | CC-BY-NC-SA license on some plugins. Heavier abstraction. Overkill for workflow automation. |
| **Flume** | Small community, rough edges, unclear React 19 support. Not production-ready. |
| **JointJS/GoJS** | Commercial licenses, jQuery-based internals, not React-native. |

### Sources

- [React Flow docs](https://reactflow.dev)
- [xyflow GitHub](https://github.com/xyflow/xyflow)
- [React Flow v12 changelog](https://reactflow.dev/whats-new/2024-11-20)
- Horak et al., "Graph Performance" (TU Dresden) — SVG vs Canvas comparison
