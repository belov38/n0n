# Frontend Canvas — Workflow Editor

## Overview

The n8n workflow canvas is built on **Vue Flow** (a Vue 3 port of React Flow), integrated into a Vue 3 + Pinia frontend. It renders a directed graph of workflow nodes and edges, supports drag-and-drop editing, real-time execution visualization, and a node detail panel (NDV). The canvas library is `@vue-flow/core` (version in use: checked from node_modules; the API surface uses `VueFlow`, `Handle`, `BaseEdge`, `EdgeLabelRenderer`, `MiniMap`, etc.).

---

## Canvas Architecture

### Component Tree

```
NodeView.vue                                       (app/views/NodeView.vue)
  WorkflowCanvas.vue                               (canvas/components/WorkflowCanvas.vue)
    Canvas.vue                                     (canvas/components/Canvas.vue)
      VueFlow (from @vue-flow/core)
        CanvasNode.vue            per node          (canvas/components/elements/nodes/CanvasNode.vue)
          CanvasHandleRenderer.vue  per port        (…/handles/CanvasHandleRenderer.vue)
            Handle (VueFlow)
            RenderType → CanvasHandleMainInput | CanvasHandleMainOutput | CanvasHandleNonMainInput | CanvasHandleNonMainOutput
          CanvasNodeToolbar.vue                     (…/nodes/CanvasNodeToolbar.vue)
          CanvasNodeRenderer.vue                    (…/nodes/CanvasNodeRenderer.vue)
            → CanvasNodeDefault.vue                (…/nodes/render-types/CanvasNodeDefault.vue)
            → CanvasNodeStickyNote.vue
            → CanvasNodeAddNodes.vue
            → CanvasNodeChoicePrompt.vue
          CanvasNodeTrigger.vue                     (…/nodes/render-types/parts/CanvasNodeTrigger.vue)
        CanvasEdge.vue            per connection    (canvas/components/elements/edges/CanvasEdge.vue)
          BaseEdge (VueFlow)
          EdgeLabelRenderer
            CanvasEdgeToolbar.vue
        CanvasConnectionLine.vue  during drag       (…/edges/CanvasConnectionLine.vue)
        CanvasArrowHeadMarker.vue                   (…/edges/CanvasArrowHeadMarker.vue)
        CanvasBackground.vue                        (…/background/CanvasBackground.vue)
        MiniMap (VueFlow)
        CanvasControlButtons.vue                    (…/buttons/CanvasControlButtons.vue)
        ContextMenu.vue
```

---

## Data-to-Visual Mapping

### Mapping Layer

`WorkflowCanvas.vue` (`/packages/frontend/editor-ui/src/features/workflows/canvas/components/WorkflowCanvas.vue:54`) calls `useCanvasMapping()` to convert the raw workflow data model into VueFlow data structures:

```
IWorkflowDb.nodes (INodeUi[])  ──────► CanvasNode[] (VueFlow Node<CanvasNodeData>)
IWorkflowDb.connections (IConnections) ► CanvasConnection[] (VueFlow DefaultEdge<CanvasConnectionData>)
```

Source: `/packages/frontend/editor-ui/src/features/workflows/canvas/composables/useCanvasMapping.ts:71`

### INodeUi fields → CanvasNode fields

| INodeUi field | CanvasNode / CanvasNodeData field | Notes |
|---|---|---|
| `node.id` | `canvasNode.id`, `data.id` | UUID; VueFlow node identity |
| `node.name` | `canvasNode.label`, `data.name` | Used for display |
| `node.type` | `data.type`, `canvasNode.type = 'canvas-node'` | VueFlow node type always `canvas-node` |
| `node.typeVersion` | `data.typeVersion` | |
| `node.disabled` | `data.disabled` | |
| `node.position[0], [1]` | `canvasNode.position = { x, y }` | Direct copy; absolute canvas coordinates |
| Derived from node type | `data.inputs`, `data.outputs` | Via `NodeHelpers.getNodeInputs/Outputs()` |
| From execution store | `data.execution.running`, `.status`, `.waiting`, `.waitingForNext` | |
| From execution store | `data.runData.outputMap`, `.iterations`, `.visible` | |
| From document store | `data.pinnedData.count`, `.visible` | |
| From workflow type | `data.render.type` | `'default'`, `'n8n-nodes-base.stickyNote'`, `'n8n-nodes-internal.addNodes'`, `'n8n-nodes-internal.choicePrompt'` |

Key mapping function:
`/packages/frontend/editor-ui/src/features/workflows/canvas/composables/useCanvasMapping.ts:681` — `mappedNodes` computed property assembles the complete `CanvasNode[]`.

### IConnections → CanvasConnection[]

`/packages/frontend/editor-ui/src/features/workflows/canvas/canvas.utils.ts:18` — `mapLegacyConnectionsToCanvasConnections()`

The legacy n8n connections format (`{ [fromNodeName]: { main: [[{ node, type, index }]] } }`) is converted to VueFlow edges. Node names are resolved to node IDs via a `Map<name, id>`.

Handle IDs are encoded strings: `outputs__main__0`, `inputs__main__0` (mode + type + index).
Parsing: `/packages/frontend/editor-ui/src/features/workflows/canvas/canvas.utils.ts:parseCanvasConnectionHandleString`.

### Connection Status Coloring

`/packages/frontend/editor-ui/src/features/workflows/canvas/composables/useCanvasMapping.ts:758` — `getConnectionData()`

| Status | Condition |
|---|---|
| `'running'` | Source node is executing AND no output data yet |
| `'pinned'` | Source has pinned data AND execution data |
| `'error'` | Source node has issues |
| `'success'` | `runDataTotal > 0` AND target also executed (for non-main edges) |

Edge label shows item count from `nodeExecutionRunDataOutputMapById` (throttled watch at `useCanvasMapping.ts:386`).

---

## Interaction Model

| User Interaction | Canvas Event | Handler | Data Mutation |
|---|---|---|---|
| Click node | `@node-click` → `onNodeClick` | `Canvas.vue:457` | Emits `click:node` → `NodeView` opens NDV via `ndvStore.setActiveNodeName()` |
| Double-click node | `@dblclick` on `CanvasNodeDefault.vue:148` | `onActivate` | Emits `activate` → `Canvas.vue` emits `update:node:activated` → NDV opens |
| Drag node | `@node-drag-stop` → `onNodeDragStop` | `Canvas.vue:453` | Emits `update:nodes:position` → `useCanvasOperations.updateNodesPosition()` → writes to workflow store |
| Right-click node | `@contextmenu` on node | `onOpenNodeContextMenu` | Opens `ContextMenu.vue` with node actions |
| Connect drag (start) | `@connect-start` → `onConnectStart` | `Canvas.vue:578` | Sets `connectingHandle` ref (provided via inject key) |
| Connect drag (end on handle) | `@connect` → `onConnect` | `Canvas.vue:585` | Emits `create:connection` → `useCanvasOperations.createConnection()` |
| Connect drag (end on empty) | `@connect-end` → `onConnectEnd` | `Canvas.vue:592` | Emits `create:connection:cancelled` — may open node creator |
| Delete key | keybinding `delete\|backspace` | `Canvas.vue:367` | Emits `delete:nodes` → `useCanvasOperations.deleteNodes()` |
| D key | keybinding `d` | `Canvas.vue:369` | Emits `update:nodes:enabled` (toggle disabled) |
| P key | keybinding `p` | `Canvas.vue:370` | Emits `update:nodes:pin` |
| Ctrl+A | keybinding | `Canvas.vue:344` | `addSelectedNodes(graphNodes.value)` — all selected |
| Ctrl+C / Ctrl+X | keybinding | `Canvas.vue:366` | Emits `copy:nodes` / `cut:nodes` |
| Ctrl+D | keybinding | `Canvas.vue:368` | Emits `duplicate:nodes` |
| Zoom in/out | keyboard `+`/`-` or scroll | VueFlow built-in + `Canvas.vue:727-732` | VueFlow internal viewport |
| Fit view | keyboard `1` | `Canvas.vue:349` | `fitView()` via VueFlow |
| Panning | Space+drag, middle-click drag | `panningKeyCode`, `panningMouseButton` refs | VueFlow internal |
| Tidy up layout | Shift+Alt+T or canvas button | `Canvas.vue:385` | `layout(target)` → Dagre → emits `tidy-up` → `updateNodesPosition()` |
| Drag node to canvas (add) | `@drop` → `onDrop` | `Canvas.vue:882` | Emits `drag-and-drop` → node creator |
| Arrow keys | keybindings | `Canvas.vue:350-357` | `addSelectedNodes` on next/prev/sibling node |

---

## Node Detail View (NDV)

### Opening the NDV

`NodeView.vue` handles `@update:node:activated` from the canvas:
- Calls `ndvStore.setActiveNodeName(nodeName, source)` (`ndv.store.ts:233`)
- Vue-router also navigates to the NDV route in some cases

NDV is loaded as an async component:
- Standard: `LazyNodeDetailsView` → `NodeDetailsView.vue` (`/src/features/ndv/shared/views/NodeDetailsView.vue`)
- Experimental embedded: `ExperimentalEmbeddedNodeDetails.vue` rendered inside the node itself when `isExperimentalNdvActive` is true

### NDV Structure

`NodeDetailsView.vue` renders:
- `NDVDraggablePanels.vue` with 3 panels (or 2 for trigger nodes):
  - `InputPanel.vue` — shows data flowing into the active node
  - `NodeSettings.vue` — parameter forms
  - `OutputPanel.vue` (or `TriggerPanel.vue`) — shows execution output

### Parameter Changes → Workflow Data

`NodeSettings.vue` → `ParameterInputList.vue` → `ParameterInput.vue` → individual inputs emit `valueChanged`.

Flow: parameter change → `NodeDetailsView.vue` emits `valueChanged` → `NodeView.vue` calls `useCanvasOperations.setNodeParameters()` → updates workflow store → `useCanvasMapping` recomputes `mappedNodes` reactively.

NDV store tracks: `activeNodeName`, `input.nodeName`, `input.run`, `input.branch`, `output.run`, panel display modes (persisted to localStorage).

---

## Execution Visualization

### State Machine on Nodes

Each canvas node has an `execution` object in `CanvasNodeData` (`canvas.types.ts:123`):

```typescript
execution: {
  status?: ExecutionStatus;   // 'new' | 'waiting' | 'running' | 'success' | 'error' | 'canceled' | 'crashed' | 'unknown'
  waiting?: string;           // human-readable waiting message
  running: boolean;
  waitingForNext?: boolean;
}
```

### CSS State Classes on Nodes

`CanvasNodeDefault.vue` applies CSS classes based on execution state (`canvas/components/elements/nodes/render-types/CanvasNodeDefault.vue:62`):

| Class | Condition | Visual Effect |
|---|---|---|
| `.success` | `hasRunData && executionStatus === 'success'` | Green 2px border |
| `.error` | `hasExecutionErrors` | Red/danger border |
| `.warning` | `dirtiness !== undefined` | Orange 2px border |
| `.pinned` | `hasPinnedData` | Secondary color 2px border |
| `.running` | `executionRunning OR executionWaitingForNext` | Animated conic-gradient border ring (1.5s rotation) |
| `.waiting` | `executionWaiting OR executionStatus === 'waiting'` | Animated conic-gradient border ring (4.5s rotation, slower) |
| `.disabled` | `isDisabled` | Gray foreground border |
| `.selected` | `isSelected` | Box shadow glow |

The `.running` and `.waiting` animations use a CSS `@property --node--gradient-angle` trick with a conic gradient pseudo-element (`CanvasNodeDefault.vue:358–398`).

### Status Icons

`CanvasNodeStatusIcons.vue` (`canvas/components/elements/nodes/render-types/parts/CanvasNodeStatusIcons.vue:1`) renders bottom-right icons:
- Hard-drive-download icon — community node not installed
- Power icon — disabled
- Error icon with tooltip — execution errors
- Validation-error icon — parameter issues
- Pin icon — pinned data
- Warning icon — dirty (parameters changed since last run)
- Check icon + iteration count — success with run data

### Edge Status

`CanvasEdge.vue` uses `status` from `CanvasConnectionData.status`:
- `'success'` → `--canvas-edge--color: var(--color--success)` (green)
- `'pinned'` → `--canvas-edge--color: var(--color--secondary)` (orange/yellow)
- `'running'` / `'error'` / undefined → lightness-based neutral color

Non-main connections use `strokeDasharray: '5,6'` (dashed line).

Edge label shows item count: e.g. "3 items" or "12 items total (3 runs)".

### Real-Time Execution Updates (Push/WebSocket)

The server sends push messages via WebSocket (or SSE). The connection is managed by `usePushConnectionStore` (`/src/app/stores/pushConnection.store.ts:17`) using either `useWebSocketClient` or `useEventSourceClient`.

Push messages are dispatched in `usePushConnection.ts` (`/src/app/composables/usePushConnection/usePushConnection.ts:61`):

| Push Message | Handler | Effect |
|---|---|---|
| `nodeExecuteBefore` | `nodeExecuteBefore.ts:8` | `workflowState.executingNode.addExecutingNode(nodeName)` → sets `execution.running = true` on node |
| `nodeExecuteAfter` | `nodeExecuteAfter.ts` | `executingNode.removeExecutingNode(nodeName)`, stores task data |
| `nodeExecuteAfterData` | `nodeExecuteAfterData.ts` | Streams partial execution data |
| `executionStarted` | `executionStarted.ts` | Sets `isWorkflowRunning = true` |
| `executionFinished` | `executionFinished.ts` | Stores full execution result, clears running state |
| `executionRecovered` | `executionRecovered.ts` | Handles recovered partial execution |

`useCanvasMapping.ts` reads `workflowState.executingNode.isNodeExecuting(nodeName)` reactively, so when `addExecutingNode()` is called, the `mappedNodes` computed property reacts and `CanvasNodeData.execution.running` becomes `true`, which triggers the spinning border animation.

The `nodeExecutionRunDataOutputMapById` in `useCanvasMapping.ts:384` is updated via a throttled watch (`CANVAS_EXECUTION_DATA_THROTTLE_DURATION`) on `workflowsStore.workflowExecutionResultDataLastUpdate`.

---

## Coordinate System and Layout

### Node Positions

Nodes are stored with absolute pixel coordinates in `INodeUi.position: [x, y]` (a tuple).

In VueFlow, positions become `{ x, y }` objects on `CanvasNode.position`. The canvas uses an infinite scrollable coordinate space; VueFlow manages the transformation between canvas coordinates and screen pixels via a viewport transform `{ x, y, zoom }`.

Grid snapping: `GRID_SIZE = 16` pixels (`nodeViewUtils.ts:37`). VueFlow is configured with `snap-to-grid` and `:snap-grid="[GRID_SIZE, GRID_SIZE]"` (`Canvas.vue:1035`).

Default node sizes:
- Regular node: `96 × 96` px (`DEFAULT_NODE_SIZE = [16*6, 16*6]`)
- Configurable (AI tool parent): `256 × 96` px (`CONFIGURABLE_NODE_SIZE = [16*16, 16*6]`)
- Configuration (AI tool child): `80 × 80` px (circle, `CONFIGURATION_NODE_SIZE = [40, 40]`)

### Auto-Layout (Tidy Up)

Algorithm: **Dagre** (`@dagrejs/dagre`) with left-to-right layout (`rankdir: 'LR'`).

Source: `/packages/frontend/editor-ui/src/features/workflows/canvas/composables/useCanvasLayout.ts`

Layout steps:
1. Filter out sticky notes; compute bounding box before layout.
2. Build Dagre graph with node sizes.
3. Use `dagre.graphlib.alg.components()` to split the graph into disconnected subgraphs.
4. For each subgraph, identify AI (configurable) parent nodes and run a separate top-to-bottom (`TB`) Dagre sub-layout for AI config nodes, expanding the parent's bounding box.
5. Run left-to-right layout on each subgraph.
6. Combine subgraphs vertically with another Dagre TB layout of bounding boxes.
7. Post-process AI sub-layouts: attempt top-alignment without overlap.
8. Reposition sticky notes relative to the nodes they cover.
9. Anchor the result to preserve the original bounding box origin (no scroll shift).

Spacing constants (`useCanvasLayout.ts:45`):
- `NODE_X_SPACING = 128` px (8 × GRID_SIZE)
- `NODE_Y_SPACING = 96` px (6 × GRID_SIZE)
- `SUBGRAPH_SPACING = 128` px
- `AI_X_SPACING = 48`, `AI_Y_SPACING = 128`

### Viewport Persistence

The viewport transform is tracked reactively in `NodeView.vue:1357`:
```typescript
const viewportTransform = ref<ViewportTransform>({ x: 0, y: 0, zoom: 1 });
```

On `@viewport:change` from `Canvas.vue`, `NodeView.vue:1364` stores:
- `viewportTransform.value` (used to compute viewport boundaries for node placement)
- `uiStore.nodeViewOffsetPosition = [viewport.x, viewport.y]`

The viewport is NOT persisted to the database — it resets on page reload. When a workflow loads, `Canvas.vue` calls `fitView()` after nodes are initialized (`onPaneReady`, line 960).

The experimental NDV mode introduces a "zoom mode" (`experimentalNdv.store.ts`) where the viewport zooms into a selected node; this sets a custom `maxCanvasZoom` and `--canvas-zoom-compensation-factor` CSS variable used to scale handles and edge widths inversely with zoom.

---

## Edge / Connection Rendering

### Path Calculation

`getEdgeRenderData.ts` (`/src/features/workflows/canvas/components/elements/edges/utils/getEdgeRenderData.ts:13`):

- **Forward connections** (source is left of target): Single Bezier curve via VueFlow's `getBezierPath()`.
- **Backward connections** (target is to the left of source, i.e. looping back): Two-segment smooth-step path that routes downward 130px below the source to avoid node overlap, then routes to the target.

### Handle Positions

Main inputs: `Position.Left` — handles placed at `top: X%` offsets evenly distributed.
Main outputs: `Position.Right` — handles placed at `top: X%` offsets.
Non-main inputs (AI tools): `Position.Bottom` — handles at `left: X%` offsets with `CONFIGURATION_NODE_RADIUS` spacing.
Non-main outputs (AI tools): `Position.Top` — handles at `left: X%` offsets.

Source: `CanvasNode.vue:216–238`.

### Connection Drag

When dragging a connection from a handle:
1. VueFlow fires `@connect-start`, `Canvas.vue:578` stores `connectingHandle`.
2. `CanvasConnectionLine.vue` renders the drag preview path (same `getEdgeRenderData` logic).
3. On drop over a valid handle, VueFlow fires `@connect`, `Canvas.vue:585` → `onConnect()`.
4. `NodeView.vue` handles `create:connection` → `useCanvasOperations.createConnection()`.
5. If dropped on empty canvas, `create:connection:cancelled` is emitted; this may open the node creator panel.

Validity: `CanvasHandleRenderer.vue:53–67` — handles are not connectable if `maxConnections` is reached. Main inputs are non-draggable starts (output handles initiate connections). Non-main handles are bidirectional.

---

## Provide / Inject Pattern

The canvas uses Vue's provide/inject to pass data down without prop drilling:

| Key | Provider | Data |
|---|---|---|
| `CanvasKey` | `Canvas.vue:1009` | `{ connectingHandle, isExecuting, initialized, viewport, isExperimentalNdvActive, isPaneMoving }` |
| `CanvasNodeKey` | `CanvasNode.vue:308` | `{ id, data, label, selected, readOnly, eventBus }` |
| `CanvasNodeHandleKey` | `CanvasHandleRenderer.vue:130` | `{ label, mode, type, index, runData, isRequired, isConnected, isConnecting, isReadOnly, maxConnections }` |

Child components access canvas state via `useCanvas()` (`canvas/composables/useCanvas.ts:4`) and node state via `useCanvasNode()` (`canvas/composables/useCanvasNode.ts:8`).

---

## Design System

Design system components come from `@n8n/design-system` (package at `packages/frontend/@n8n/design-system`). On the canvas, the main design system components used are:
- `N8nIcon` — status icons in `CanvasNodeStatusIcons.vue`
- `N8nTooltip` — status icon tooltips
- `N8nText` — in various dialogs

CSS variables from the design system control all canvas colors; canvas-specific variables:
- `--canvas-node--color--background` — node background
- `--canvas--color--selected-transparent` — selection glow
- `--canvas--color--background` — canvas background
- `--canvas-zoom-compensation-factor` — scales handles/edges with zoom (set to 0.5 in experimental NDV zoom mode)
- `--canvas-edge--color--lightness--light/dark` — edge color per light/dark mode

---

## Key Files

| File | Description |
|---|---|
| `/packages/frontend/editor-ui/src/features/workflows/canvas/components/Canvas.vue` | Root canvas component; wraps VueFlow, registers all event handlers, provides CanvasKey context, manages keybindings, minimap, context menu |
| `/packages/frontend/editor-ui/src/features/workflows/canvas/components/WorkflowCanvas.vue` | Bridge between workflow data (`IWorkflowDb`) and Canvas; calls `useCanvasMapping`, throttles updates during execution |
| `/packages/frontend/editor-ui/src/features/workflows/canvas/canvas.types.ts` | All TypeScript interfaces for canvas: `CanvasNode`, `CanvasNodeData`, `CanvasConnection`, `CanvasConnectionData`, `CanvasNodeRenderType`, `CanvasNodeDirtiness`, injection data shapes |
| `/packages/frontend/editor-ui/src/features/workflows/canvas/composables/useCanvasMapping.ts` | Core data mapping layer: converts `INodeUi[]` + `IConnections` to `CanvasNode[]` + `CanvasConnection[]`; computes all execution state, run data, validation errors, pinned data |
| `/packages/frontend/editor-ui/src/features/workflows/canvas/composables/useCanvasLayout.ts` | Dagre-based auto-layout ("tidy up"); handles AI config node sub-layouts, sticky note repositioning |
| `/packages/frontend/editor-ui/src/features/workflows/canvas/components/elements/nodes/CanvasNode.vue` | Per-node wrapper: maps ports to handles, manages toolbar visibility, provides CanvasNodeKey injection |
| `/packages/frontend/editor-ui/src/features/workflows/canvas/components/elements/nodes/render-types/CanvasNodeDefault.vue` | Standard node visual: icon, label, subtitle, status classes, animated running/waiting border ring |
| `/packages/frontend/editor-ui/src/features/workflows/canvas/components/elements/nodes/render-types/parts/CanvasNodeStatusIcons.vue` | Status icon set: running spinner, success check, error/validation/pin/dirty icons |
| `/packages/frontend/editor-ui/src/features/workflows/canvas/components/elements/edges/CanvasEdge.vue` | Connection renderer: Bezier/smooth-step paths, status coloring, item-count label, hover toolbar |
| `/packages/frontend/editor-ui/src/features/workflows/canvas/components/elements/edges/utils/getEdgeRenderData.ts` | Edge path algorithm: forward = single Bezier; backward = two-segment smooth-step to avoid overlap |
| `/packages/frontend/editor-ui/src/features/workflows/canvas/components/elements/handles/CanvasHandleRenderer.vue` | VueFlow `Handle` wrapper; routes to main/non-main, input/output render components; enforces max connection limits |
| `/packages/frontend/editor-ui/src/features/workflows/canvas/canvas.utils.ts` | Utility functions: `mapLegacyConnectionsToCanvasConnections`, `parseCanvasConnectionHandleString`, `createCanvasConnectionHandleString` |
| `/packages/frontend/editor-ui/src/app/composables/useCanvasOperations.ts` | All canvas mutation operations: add/delete/move nodes, create/delete connections, copy/paste, import workflow, set parameters |
| `/packages/frontend/editor-ui/src/app/views/NodeView.vue` | Top-level view: mounts WorkflowCanvas, NDV, node creator; routes all canvas events to `useCanvasOperations`; handles push connection for execution updates |
| `/packages/frontend/editor-ui/src/features/ndv/shared/ndv.store.ts` | NDV Pinia store: `activeNodeName`, input/output panel state, draggable mapping state, panel dimensions |
| `/packages/frontend/editor-ui/src/features/ndv/shared/views/NodeDetailsView.vue` | NDV root component: renders draggable panels with input, parameters, output panels |
| `/packages/frontend/editor-ui/src/app/composables/usePushConnection/usePushConnection.ts` | WebSocket/SSE push message dispatcher; routes `nodeExecuteBefore/After`, `executionFinished` etc. to store mutations that drive canvas updates |
| `/packages/frontend/editor-ui/src/app/utils/nodeViewUtils.ts` | Canvas constants (`GRID_SIZE=16`, node sizes), layout utilities, viewport boundary calculations |
| `/packages/frontend/editor-ui/src/app/stores/canvas.store.ts` | Minimal Pinia store: `newNodeInsertPosition`, loading state, AI node list |
