# 07 — Frontend State Management Architecture

Source analysed: `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/`

---

## 1. State Management Library

n8n uses **Pinia** (Vue 3's official store library) exclusively. Every store is defined with `defineStore()` in the Composition API style (`() => { ... }` factory function), except for `useHistoryStore` which still uses the Options API style (`{ state, actions }` object). All store IDs come from the central `STORES` constant object.

- Pinia setup: bootstrapped in the Vue app entry point (not shown here, but stores are referenced via `useXxxStore()` composables throughout components and other stores).
- Store ID registry: `/Users/ib/prj-other/n0n/n8n/packages/frontend/@n8n/stores/src/constants.ts:1`

---

## 2. Store Catalog

### Core Application Stores (`packages/frontend/editor-ui/src/app/stores/`)

#### `useRootStore` — ID: `root`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/@n8n/stores/src/useRootStore.ts:37`

State held:
- `baseUrl`, `restEndpoint` — REST API base URL
- `pushRef` — unique client ID (generated via `randomString(10)`, persisted to **sessionStorage** under key `n8n-client-id`)
- `urlBaseWebhook`, `urlBaseEditor`, `timezone`, `versionCli`, `instanceId`, etc.

Key computed:
- `restUrl` = `baseUrl + restEndpoint`
- `restApiContext` = `{ baseUrl: restUrl, pushRef }` — passed to every API call

This store is the foundation: all API calls and push connections reference its values. The `pushRef` uniquely identifies the browser tab to the backend, enabling targeted push messages.

---

#### `useSettingsStore` — ID: `settings`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/stores/settings.store.ts:22`

State held:
- `settings: FrontendSettings` — full backend config blob
- `userManagement`, `api`, `mfa`, `folders`, `saveDataErrorExecution`, etc.
- `pushBackend` (`'websocket'` | `'sse'`) — determines which transport the push connection uses

Key computed: `isEnterpriseFeatureEnabled`, `isConcurrencyEnabled`, `isAiAssistantEnabled`, `isAiBuilderEnabled`, `pushBackend`, `isTemplatesEnabled`, etc.

Loaded by `initializeCore()` on first route navigation.

---

#### `useWorkflowsStore` — ID: `workflows`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/stores/workflows.store.ts:1`

The largest store in the codebase (~65 KB). Holds the currently open workflow and its execution state.

State held:
- `workflow: IWorkflowDb` — current workflow document (nodes, connections, settings)
- `workflowExecutionData: IExecutionResponse | null` — run data for the active execution
- `activeExecutionId: string | null | undefined` — `undefined`=none, `null`=starting, string=running
- `nodeMetadata: NodeMetadataMap` — per-node UI metadata
- `executingNode` — which nodes are currently executing
- `workflowObject: Workflow` — n8n-workflow runtime object

Key actions:
- `runWorkflow(runData)` — POSTs to `/workflows/:id/run`
- `fetchExecutionDataById(id)` — fetches execution from REST
- `addNodeExecutionStartedData()`, `updateNodeExecutionStatus()`, `updateNodeExecutionRunData()` — updated by push message handlers

---

#### `useWorkflowsListStore` — ID: `workflowsList`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/stores/workflowsList.store.ts:12`

State held:
- `workflowsById: Record<string, IWorkflowDb>` — cache of all known workflows
- `activeWorkflows: string[]` — list of active workflow IDs
- `totalWorkflowCount: number`

Actions: `setWorkflows`, `addWorkflow`, `removeWorkflow`, `updateWorkflowInCache`, `setWorkflowActiveInCache`, `fetchWorkflow`.

---

#### `useWorkflowDocumentStore` — ID: `workflowDocuments/<id>@<version>`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/stores/workflowDocument.store.ts:45`

A factory-pattern store — one instance per open workflow. Created via `useWorkflowDocumentStore(id)` where id is `workflowId@version`. Holds per-workflow-document state: active state (`activeVersionId`), tags, and pinned data. Disposed with `disposeWorkflowDocumentStore()` on navigation away.

---

#### `useWorkflowSaveStore` — ID: `workflowSave`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/stores/workflowSave.store.ts:15`

State held:
- `autoSaveState: AutoSaveState` — idle/pending/saving/error
- `pendingSave: Promise<boolean> | null`
- `retryCount`, `retryDelay`, `isRetrying`, `lastError`, `conflictModalShown` — exponential backoff for save retries

---

#### `useWorkflowStateStore` — ID: `workflowState`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/stores/workflowState.store.ts:8`

Thin store that exposes `executingNode` (from `useExecutingNode()` composable). Tracks which node names are currently executing. Intended as a transitional home for per-workflow state being moved out of `workflows.store`.

---

#### `usePushConnectionStore` — ID: `push`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/stores/pushConnection.store.ts:17`

State held:
- `isConnected`, `isConnecting`, `isConnectionRequested`
- `outgoingQueue: unknown[]` — messages buffered while disconnected
- `onMessageReceivedHandlers: OnPushMessageHandler[]` — fan-out subscriber list

Key methods:
- `pushConnect()` / `pushDisconnect()` — debounced to avoid race conditions during route transitions
- `addEventListener(handler)` — register a listener; returns an unsubscribe function
- `send(message)` — serializes and sends over WebSocket (or queues if disconnected)

The client backend is chosen at store initialization: `useWebSockets.value ? useWebSocketClient() : useEventSourceClient()`.

---

#### `useUIStore` — ID: `ui`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/stores/ui.store.ts:112`

State held:
- `modalsById: Record<string, ModalState>` — open/closed state + per-modal data for all 40+ modals
- `modalStack: string[]` — ordering of open modals
- `currentView: string` — current route name (set in `router.afterEach`)
- `stateIsDirty`, `hasUnsavedWorkflowChanges` — unsaved change tracking
- `processingExecutionResults: boolean` — true while fetching execution data after push event
- `nodeViewOffsetPosition`, `nodeViewInitialized`

Persistence: `theme` via `useLocalStorage(LOCAL_STORAGE_THEME)`, `sidebarMenuCollapsed` via `useLocalStorage('sidebar.collapsed')`.

---

#### `useCanvasStore` — ID: `canvas`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/stores/canvas.store.ts:7`

Lightweight store. Delegates to `useWorkflowsStore` for `nodes` and `aiNodes`. Holds `newNodeInsertPosition`, `hasRangeSelection`, and loading state from `useLoadingService`.

---

#### `useHistoryStore` — ID: `history`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/stores/history.store.ts:9`

Options API style store. Holds `undoStack`, `redoStack`, `currentBulkAction`. Limit: 100 entries per stack. Used by canvas operations for undo/redo.

---

#### `useNodeTypesStore` — ID: `nodeTypes`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/stores/nodeTypes.store.ts:40`

State held:
- `nodeTypes: NodeTypesByTypeNameAndVersion` — all installed node type descriptors
- `vettedCommunityNodeTypes: Map<string, CommunityNodeType>`

Loaded during `initializeAuthenticatedFeatures`. Updated by push messages `reloadNodeType` and `removeNodeType`.

---

#### `useLogsStore` — ID: `logs`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/stores/logs.store.ts:19`

State held:
- `isOpen` — persisted via `useLocalStorage(LOCAL_STORAGE_LOGS_PANEL_OPEN)`
- `detailsState`, `detailsStateSubNode` — also localStorage-persisted
- `isLogSelectionSyncedWithCanvas` — localStorage-persisted
- `chatSessionId`, `chatSessionMessages`

---

#### `useBackendConnectionStore` — ID: `backendConnection`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/stores/backendConnection.store.ts:7`

Minimal store: `isOnline: boolean`. Tracks app-wide backend connectivity.

---

#### `usePostHog` — ID: `posthog`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/stores/posthog.store.ts:19`

State held: `featureFlags`, `overrides`. Reads overrides from localStorage (`LOCAL_STORAGE_EXPERIMENT_OVERRIDES`). Used for A/B tests and feature flags everywhere via `getVariant(experiment)`.

---

#### `useRBACStore` — ID: `rbac`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/stores/rbac.store.ts:8`

State held: `globalRoles`, `globalScopes`, `scopesByProjectId`, `scopesByResourceId`. Used by route middleware to enforce permission checks.

---

### Feature Stores (`packages/frontend/editor-ui/src/features/`)

#### `useNDVStore` — ID: `ndv`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/features/ndv/shared/ndv.store.ts:38`

Node Detail View state:
- `activeNodeName: string | null` — which node's NDV is open
- `mainPanelDimensions` — panel size proportions
- `input`, `output` — panel data state
- `inputPanelDisplayMode` / `outputPanelDisplayMode` — persisted via `useLocalStorage`
- `localStorageMappingIsOnboarded`, etc. — onboarding flags, localStorage

---

#### `useCollaborationStore` — ID: `collaboration`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/features/collaboration/collaboration/collaboration.store.ts:30`

Real-time multi-user collaboration state:
- `collaborators: Collaborator[]` — other users viewing the same workflow
- `currentWriterLock: { userId, clientId } | null` — who holds write access
- `isCurrentTabWriter`, `isCurrentUserWriter`, `shouldBeReadOnly` (computed)
- Heartbeat timers, inactivity detection, write-lock polling

Listens to push events: `collaboratorsChanged`, `writeAccessAcquired`, `writeAccessReleased`, `workflowUpdated`. Sends: `workflowOpened`, `workflowClosed`, `writeAccessRequested`, `writeAccessReleaseRequested`, `writeAccessHeartbeat`.

---

#### `useExecutionsStore` — ID: `executions`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/features/execution/executions/executions.store.ts:30`

State held:
- `executionsById: Record<string, ExecutionSummaryWithScopes>` — paginated execution list
- `currentExecutionsById` — in-progress executions
- `activeExecution: ExecutionSummary | null`
- `filters`, `autoRefresh`, `autoRefreshDelay` (4s polling)
- `executionsCount`, `concurrentExecutionsCount`

---

#### `useCredentialsStore` — ID: `credentials`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/features/credentials/credentials.store.ts:41`

State held: `state.credentialTypes`, `state.credentials` — maps by ID. `credentialTestResults: Map<string, 'pending'|'success'|'error'>`.

---

#### `useProjectsStore` — ID: `projects`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/features/collaboration/projects/projects.store.ts:31`

State held: `projects`, `myProjects`, `personalProject`, `currentProject`, `projectsCount`. Computed `currentProjectId` reads from route params. Used by `useExecutionsStore` to scope execution queries.

---

#### `useAssistantStore` — ID: `assistant`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/features/ai/assistant/assistant.store.ts`

AI assistant conversation state.

---

#### `useBuilderStore` — ID: `builder`
**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/features/ai/assistant/builder.store.ts`

AI workflow builder state. Tracks `streaming` flag (used to suppress read-only state during streaming).

---

#### Other Feature Stores (summarized)

| Store | ID | Purpose |
|---|---|---|
| `useTemplatesStore` | `templates` | Workflow templates browsing/search |
| `useTagsStore` | `tags` | Workflow tag CRUD |
| `useVersionsStore` | `versions` | n8n version update check |
| `useUsersStore` | `users` | Current user + user list |
| `useNodeCreatorStore` | `nodeCreator` | Node picker panel state |
| `useWebhooksStore` | `webhooks` | Test webhook management |
| `useBannersStore` | `banners` | Dismissible notification banners |
| `useFocusPanelStore` | `focusPanel` | Sidebar focus panel (localStorage persisted) |
| `useInsightsStore` | `insights` | Execution analytics |
| `useEvaluationStore` | `evaluation` | AI evaluation test runs |
| `useFoldersStore` | `folders` | Workflow folder CRUD |
| `useSourceControlStore` | `sourceControl` | Git source control integration |
| `useChatStore` | `chatHub` | Chat feature state |
| `useChatPanelStore` | `chatPanel` | AI chat panel state |
| `useLogsStore` | `logs` | Execution logs panel |

---

### Persistence Summary

| Store | Persisted Key | Storage Type |
|---|---|---|
| `useRootStore` | `n8n-client-id` | sessionStorage |
| `useUIStore` | `N8N_THEME` | localStorage (via vueuse `useLocalStorage`) |
| `useUIStore` | `sidebar.collapsed` | localStorage |
| `useNDVStore` | `N8N_NDV_INPUT_PANEL_DISPLAY_MODE` | localStorage |
| `useNDVStore` | `N8N_NDV_OUTPUT_PANEL_DISPLAY_MODE` | localStorage |
| `useNDVStore` | `N8N_MAPPING_ONBOARDED`, `N8N_TABLE_HOVER_ONBOARDED`, `N8N_AUTOCOMPLETE_ONBOARDED` | localStorage |
| `useLogsStore` | `N8N_LOGS_PANEL_OPEN`, `N8N_LOGS_PANEL_DETAILS`, etc. | localStorage |
| `useFocusPanelStore` | `N8N_FOCUS_PANEL` | localStorage |
| `usePostHog` | `N8N_EXPERIMENT_OVERRIDES` | localStorage |
| `@n8n/rest-api-client` | `n8n-browserId` | localStorage (auto browser fingerprint) |

---

## 3. API Client Layer

### Transport

**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/@n8n/rest-api-client/src/utils.ts:101`

All REST calls go through `makeRestApiRequest<T>(context, method, endpoint, data?)`. This wraps **axios**. It:
1. Uses `context.baseUrl` (= `rootStore.restUrl`) as the base URL
2. Attaches `push-ref: context.pushRef` header to every request (enables backend push routing)
3. Attaches `browser-id` header (UUID stored in localStorage)
4. Unwraps the `{ data: T }` envelope from all API responses
5. Translates axios errors to `ResponseError` with `httpStatusCode`, `errorCode`, etc.
6. Throws `MfaRequiredError` when server returns `{ mfaRequired: true }`

For streaming (AI assistant): `streamRequest()` uses native `fetch()` with `credentials: 'include'`, chunked response reading split on `⧉⇋⇋➽⌑⧉§§\n`.

### Auth

No explicit auth token in request headers. Authentication uses **cookie-based sessions** (`credentials: 'include'` / `withCredentials: true` in axios for non-production). The `browser-id` header is sent for CSRF-like purposes.

### API Organization

API calls are organized into per-resource module files imported by stores:

```
packages/frontend/editor-ui/src/app/api/workflows.ts    — workflow CRUD + run
packages/frontend/editor-ui/src/app/api/workflows.ee.ts — EE-only workflow APIs
packages/frontend/editor-ui/src/features/credentials/credentials.api.ts
packages/frontend/editor-ui/src/features/credentials/credentials.ee.api.ts
packages/frontend/@n8n/rest-api-client/api/nodeTypes.ts — node type APIs
packages/frontend/@n8n/rest-api-client/api/settings.ts
packages/frontend/@n8n/rest-api-client/api/workflows.ts
```

Stores call these API modules directly (not through a service layer), passing `rootStore.restApiContext` as the first argument.

### Error Handling

- `ResponseError` carries `httpStatusCode`, `errorCode`, `serverStackTrace`, `meta`, `hint`
- `MfaRequiredError` triggers a router redirect to personal settings (in `router.beforeEach`)
- Network errors (no connection) produce `ResponseError` with `errorCode: 999`
- UI error display via `useToast().showMessage()` composable (called in push handlers or component catch blocks)

---

## 4. Real-Time / Push Architecture

### Connection Setup

`usePushConnectionStore` (`pushConnection.store.ts:17`) manages the connection. Two transports are supported:

- **WebSocket** (`useWebSockets.value === true`): `useWebSocketClient` at `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/push-connection/useWebSocketClient.ts:22`
- **Server-Sent Events**: `useEventSourceClient` at `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/push-connection/useEventSourceClient.ts:13`

The transport backend is determined by `settingsStore.pushBackend`. The URL is `{restUrl}/push?pushRef={rootStore.pushRef}`.

WebSocket features:
- Heartbeat ping every 30 seconds (`createHeartbeatMessage()`)
- Exponential backoff reconnection (`useReconnectTimer`)
- Binary data support (`socket.binaryType = 'arraybuffer'`)
- ArrayBuffer messages decoded as UTF-8 before JSON parse

SSE features:
- `EventSource` with `withCredentials: true`
- Reconnection via `useReconnectTimer`
- Send is a no-op (SSE is receive-only; use REST for outbound)

**Debounced disconnect**: `pushDisconnect` delays actual disconnect by `DEBOUNCE_TIME.CONNECTION.WEBSOCKET_DISCONNECT` ms and cancels if `pushConnect` is called in that window. Prevents dropped connections during route transitions.

**Outgoing queue**: Messages sent via `pushStore.send()` while disconnected are buffered in `outgoingQueue` and flushed on reconnect.

### Push Message Types

Defined in `packages/@n8n/api-types/src/push/index.ts:11`:

```
PushMessage =
  | ExecutionPushMessage  (executionStarted, executionFinished, executionRecovered,
                           nodeExecuteBefore, nodeExecuteAfter, nodeExecuteAfterData)
  | WorkflowPushMessage   (workflowActivated, workflowDeactivated, workflowAutoDeactivated,
                           workflowFailedToActivate, workflowUpdated)
  | HotReloadPushMessage  (reloadNodeType, removeNodeType, nodeDescriptionUpdated)
  | WebhookPushMessage    (testWebhookReceived, testWebhookDeleted)
  | WorkerPushMessage     (sendWorkerStatusMessage, sendConsoleMessage)
  | CollaborationPushMessage (collaboratorsChanged, writeAccessAcquired, writeAccessReleased)
  | DebugPushMessage
  | BuilderCreditsPushMessage (updateBuilderCredits)
  | ChatHubPushMessage
```

### Event Dispatch

`usePushConnection` composable at `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/composables/usePushConnection/usePushConnection.ts:29`:
- Calls `pushStore.addEventListener()` to subscribe
- Wraps messages in an event queue (`createEventQueue`) to serialize async handlers
- Dispatches each message type to a dedicated handler function (`processEvent`)

Handler files: `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/composables/usePushConnection/handlers/index.ts:1`

### Push Event → Store Update Mapping

| Push Event | Handler | Stores Updated |
|---|---|---|
| `nodeExecuteBefore` | `nodeExecuteBefore.ts:8` | `workflowsStore.addNodeExecutionStartedData()`, `workflowState.executingNode.addExecutingNode()` |
| `nodeExecuteAfter` | `nodeExecuteAfter.ts:13` | `workflowsStore.updateNodeExecutionStatus()` (placeholder data), `workflowState.executingNode.removeExecutingNode()`, `assistantStore.onNodeExecution()` |
| `nodeExecuteAfterData` | `nodeExecuteAfterData.ts:8` | `workflowsStore.updateNodeExecutionRunData()`, `schemaPreviewStore.trackSchemaPreviewExecution()` |
| `executionStarted` | `executionStarted.ts:9` | `workflowState.setActiveExecutionId()`, `workflowsStore.workflowExecutionData.data.resultData.runData` |
| `executionFinished` | `executionFinished.ts:65` | Fetches full execution via REST, then: `workflowsStore.setWorkflowExecutionRunData()`, `workflowState.setWorkflowExecutionData()`, `workflowState.setActiveExecutionId(undefined)`, `nodeHelpers.updateNodesExecutionIssues()`, `uiStore.setProcessingExecutionResults()` |
| `executionRecovered` | `executionRecovered.ts:15` | Same as executionFinished path |
| `workflowActivated` | `workflowActivated.ts:9` | `workflowsListStore.fetchWorkflow()`, `canvasOperations.initializeWorkspace()`, `bannersStore.removeBannerFromStack()` |
| `workflowDeactivated` | `workflowDeactivated.ts:8` | Same refetch-and-reinitialize pattern |
| `collaboratorsChanged` | `collaboration.store.ts:344` | `collaborationStore.collaborators` |
| `writeAccessAcquired` | `collaboration.store.ts:352` | `collaborationStore.currentWriterLock` |
| `writeAccessReleased` | `collaboration.store.ts:373` | `collaborationStore.currentWriterLock = null` |
| `workflowUpdated` | `collaboration.store.ts:383` | `workflowsListStore.fetchWorkflow()`, canvas refresh callback |
| `reloadNodeType` | `reloadNodeType.ts` | `nodeTypesStore` |
| `removeNodeType` | `removeNodeType.ts` | `nodeTypesStore` |
| `updateBuilderCredits` | `builderCreditsUpdated.ts` | `builderStore` |

### Multiple Subscribers

The push store uses a simple array of handlers (`onMessageReceivedHandlers`). Multiple subscribers can register independently:
- `usePushConnection` composable (main execution/workflow handlers) — registered by `NodeView.vue`
- `useCollaborationStore.initialize()` — registers its own `pushStore.addEventListener()` call for collaboration events
- `useChatPushHandler` — chat hub events

---

## 5. Workflow State Data Flows

### Load Workflow List → Display

```
WorkflowsView mounted
  → useWorkflowsListStore.fetchWorkflows()
    → makeRestApiRequest(GET /workflows)
    → workflowsById ref updated
  → allWorkflows computed derived
  → WorkflowCard components render via v-for
```

### Open Workflow Editor → Canvas Renders

```
Router navigates to /workflow/:name
  → router.beforeEach: initializeCore() + initializeAuthenticatedFeatures()
  → NodeView.vue mounts
    → useCanvasOperations().initializeWorkspace(workflowData)
      → workflowsStore.setWorkflow(workflowData)  [sets workflow ref]
      → workflowsStore builds workflowObject (Workflow instance)
    → usePushConnection({ router }).initialize()  [subscribes to push]
    → pushConnectionStore.pushConnect()           [opens WS/SSE]
    → collaborationStore.initialize()            [registers collab push listener]
      → pushStore.send({ type: 'workflowOpened', workflowId })
  → WorkflowCanvas.vue renders
    → reads workflowsStore.allNodes, connections
    → maps to Vue Flow CanvasNode[] format via useCanvasMapping
```

### Execute Workflow → Real-Time Progress

```
User clicks "Run" button
  → useRunWorkflow().runWorkflow()
    → workflowSaving.saveCurrentWorkflow() [if unsaved]
    → workflowsStore.runWorkflow(startRunData)
      → makeRestApiRequest(POST /workflows/:id/run)
      → returns { executionId } or { waitingForWebhook }
    → workflowState.setActiveExecutionId(executionId)
    → documentTitle.setDocumentTitle(name, 'EXECUTING')

  Push: 'nodeExecuteBefore' received
    → workflowState.executingNode.addExecutingNode(nodeName)
    → workflowsStore.addNodeExecutionStartedData(data)
    → Canvas node shows spinning/executing indicator

  Push: 'nodeExecuteAfter' received
    → workflowsStore.updateNodeExecutionStatus(placeholderData)
    → workflowState.executingNode.removeExecutingNode(nodeName)

  Push: 'nodeExecuteAfterData' received
    → workflowsStore.updateNodeExecutionRunData(pushData)  [real output data]
    → Canvas node shows output count badge

  Push: 'executionFinished' received
    → handler fetches full execution: makeRestApiRequest(GET /executions/:id)
    → workflowsStore.setWorkflowExecutionRunData(runExecutionData)
    → workflowState.setActiveExecutionId(undefined)
    → nodeHelpers.updateNodesExecutionIssues()
    → uiStore.setProcessingExecutionResults(false)
    → toast.showMessage(success/error)
    → documentTitle.setDocumentTitle(name, 'IDLE'|'ERROR')
```

### Execution Completes → Output Displayed

After `setWorkflowExecutionRunData()` updates the store, NDV (Node Detail View) components that are open react to the changed `workflowsStore.workflowExecutionData` computed values and re-render their output panels automatically through Vue reactivity.

---

## 6. Routing

### Router Setup

**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/router.ts:965`

Uses Vue Router with HTML5 history mode (`createWebHistory`).

### Route Guard Pipeline (`router.beforeEach`)

**File:** `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/router.ts:977`

1. `initializeCore()` — loads settings + users (idempotent)
2. `initializeAuthenticatedFeatures()` — loads node types, projects, etc. (idempotent)
3. Redirect to `/setup` if `settingsStore.showSetupPage` (first-run setup)
4. Runs named middleware chain from `route.meta.middleware`
5. `MfaRequiredError` catch → redirect to personal settings

Middleware types (`/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/utils/rbac/middleware.ts:14`):

| Name | Purpose |
|---|---|
| `authenticated` | Redirects to `/signin` if no session. Checks MFA enforcement. |
| `guest` | Redirects to home if already authenticated |
| `defaultUser` | For first-time owner setup |
| `enterprise` | Checks if enterprise feature flag is enabled |
| `rbac` | Checks specific permission scopes via `useRBACStore` |
| `role` | Checks user global role |
| `custom` | Route-specific function check |

### Route Map (Key Routes)

| Path | View Component | Middleware |
|---|---|---|
| `/` | redirect → `/home/workflows` | authenticated |
| `/home/workflows` | `WorkflowsView` | authenticated |
| `/home/credentials` | `CredentialsView` | authenticated |
| `/home/executions` | `ExecutionsView` | authenticated |
| `/workflow/new` | `NodeView` (redirects to `/workflow/:nanoid`) | authenticated |
| `/workflow/:name/:nodeId?` | `NodeView` | authenticated |
| `/workflow/:name/executions` | `WorkflowExecutionsView` | authenticated |
| `/workflow/:name/debug/:executionId` | `NodeView` | authenticated + enterprise(DebugInEditor) |
| `/workflow/:name/evaluation` | `EvaluationRootView` | authenticated |
| `/workflow/:workflowId/history/:versionId?` | `WorkflowHistory` | authenticated |
| `/workflows/templates/:id` | `NodeView` (template import) | authenticated |
| `/templates/:id` | `TemplatesWorkflowView` | authenticated |
| `/templates/:id/setup` | `SetupWorkflowFromTemplateView` | authenticated |
| `/projects/:projectId/workflows` | `WorkflowsView` | authenticated |
| `/projects/:projectId/credentials` | `CredentialsView` | authenticated |
| `/settings/users` | `SettingsUsersView` | authenticated + rbac(user:create,user:update) |
| `/settings/api` | `SettingsApiView` | authenticated + rbac(apiKey:manage) |
| `/settings/environments` | `SettingsSourceControl` | authenticated + rbac(sourceControl:manage) |
| `/settings/community-nodes` | `SettingsCommunityNodesView` | authenticated + rbac + custom |
| `/settings/workers` | `WorkerView` | authenticated + rbac(workersView:manage) |
| `/signin` | `SigninView` | guest |
| `/signup` | `SignupView` | guest |
| `/signout` | `SignoutView` | authenticated |
| `/setup` | `SetupView` | defaultUser |

All `NodeView` routes set `meta.keepWorkflowAlive: true` (Vue `<KeepAlive>`). Canvas read-only is applied via `withCanvasReadOnlyMeta()` wrapper.

---

## 7. Component ↔ Store Integration

### Reading Store State

Components use `useXxxStore()` composables directly in `<script setup>`. Reactive properties are accessed as computed properties or raw refs:

```typescript
// In NodeView.vue (line 184)
const workflowsStore = useWorkflowsStore();
const canvasReadOnly = computed(() =>
  isDemoRoute.value || collaborationStore.shouldBeReadOnly || ...
);
```

No selectors or HOC wrappers — direct store access via composables.

### Dispatching Actions

Direct method calls on store instances:

```typescript
workflowsStore.setWorkflow(data);
pushConnectionStore.pushConnect();
uiStore.openModal(WORKFLOW_SETTINGS_MODAL_KEY);
```

### Composables Pattern

Business logic is organized into composables that internally use stores:

- `useRunWorkflow({ router })` — orchestrates execution trigger, calls `workflowsStore.runWorkflow()`
- `useWorkflowHelpers()` — serialize workflow to save format
- `useWorkflowSaving({ router })` — auto-save, manual save, conflict resolution
- `useCanvasOperations()` — all canvas mutation operations (add/delete/move nodes, connections)
- `useNodeHelpers({ workflowState })` — node validation, execution issue display
- `usePushConnection({ router, workflowState })` — push event registration and routing

Composables accept `workflowState` as a parameter to enable injection of per-view state vs. singleton state.

### `WorkflowState` Injection

`useWorkflowState()` (`/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/composables/useWorkflowState.ts`) provides per-NodeView workflow execution state via Vue `provide`/`inject`. This allows composables deep in the tree to access the correct workflow state without prop drilling. `injectWorkflowState()` retrieves it.

### Local Component State

Components use local `ref()` for:
- Loading indicators, animation states
- Temporary form values before save
- DOM refs (`useTemplateRef`)

Intentionally not in stores: drag state, tooltip hover, accordion open/close, modal animation state.

---

## 8. Build & Bundle

### Build Tool

**Vite** with the `@vitejs/plugin-vue` plugin.

Config: `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/vite.config.mts`

Dev server command: `cross-env VUE_APP_URL_BASE_API=http://localhost:5678/ vite --host 0.0.0.0 --port 8080 dev`

### Key Config Details

**Proxy**: No explicit Vite proxy configuration. In dev, `VUE_APP_URL_BASE_API=http://localhost:5678/` is set as an env var, which `useRootStore` reads as `state.baseUrl`. API calls go directly to the backend at port 5678. No WS proxy setup (the backend handles SSE/WS directly at port 5678).

**Aliases** (from `vite.config.mts:27`):
- `@` → `src/`
- `@n8n/i18n`, `@n8n/stores`, `@n8n/design-system`, etc. → source directories (avoids building packages, enables HMR across packages)
- `stream` → `stream-browserify` (polyfill)

**Env vars**: `envPrefix: ['VUE', 'N8N_ENV_FEAT']` — only vars with these prefixes are exposed to the client.

**Plugins**:
- `@vitejs/plugin-vue` — SFC compilation
- `vite-svg-loader` — SVG as Vue components
- `unplugin-icons` — icon sets as Vue components
- `vite-plugin-node-polyfills` — `fs`, `path`, `url`, `util`, `timers` polyfills
- Istanbul — code coverage instrumentation (when `BUILD_WITH_COVERAGE=true`)
- Sentry — source map upload on release builds
- `@vitejs/plugin-legacy` — polyfills for older browsers (release builds only)
- Custom `i18n-locales-hmr` — hot-reload i18n locale JSON files without page reload

**Chunks**: No manual chunk splitting configured; Vite uses default automatic code splitting. All async route components (`const NodeView = async () => await import(...)`) create lazy chunks per route.

**Worker format**: `worker.format: 'es'` — web workers as ES modules.

---

## Data Flow Diagrams

### Workflow List Load

```
WorkflowsView.vue onMounted
  └─ useWorkflowsListStore().fetchWorkflows()
       └─ GET /workflows  (makeRestApiRequest)
            └─ workflowsById ref ← response.data
                 └─ allWorkflows computed triggers
                      └─ WorkflowCard components re-render
```

### Workflow Editor Open

```
Router /workflow/:id
  └─ router.beforeEach
       ├─ initializeCore()  →  settingsStore.initialize()
       ├─ initializeAuthenticatedFeatures()  →  nodeTypesStore.loadNodeTypes()
       └─ next()
  └─ NodeView.vue setup()
       ├─ useCanvasOperations().initializeWorkspace(workflowData)
       │    └─ workflowsStore.setWorkflow(data)
       │    └─ workflowsStore.workflowObject = new Workflow(...)
       ├─ pushConnectionStore.pushConnect()   →  WS/SSE open
       ├─ usePushConnection.initialize()      →  addEventListener registered
       └─ collaborationStore.initialize()     →  sends 'workflowOpened'
  └─ WorkflowCanvas.vue renders
       └─ useCanvasMapping() converts store nodes→CanvasNode[]→Vue Flow
```

### Execution Real-Time Flow

```
User → "Run" button
  └─ useRunWorkflow().runWorkflow()
       ├─ workflowSaving.saveCurrentWorkflow() [if dirty]
       ├─ POST /workflows/:id/run
       └─ workflowState.setActiveExecutionId(null → executionId)

  Server push → 'nodeExecuteBefore' { nodeName }
    └─ workflowState.executingNode.addExecutingNode(nodeName)
    └─ workflowsStore.addNodeExecutionStartedData(data)
    └─ Canvas: node shows spinner

  Server push → 'nodeExecuteAfter' { nodeName, itemCountByConnectionType }
    └─ workflowsStore.updateNodeExecutionStatus(placeholderData)
    └─ workflowState.executingNode.removeExecutingNode(nodeName)

  Server push → 'nodeExecuteAfterData' { nodeName, data }
    └─ workflowsStore.updateNodeExecutionRunData(data)
    └─ Canvas: node shows item count

  Server push → 'executionFinished' { executionId, status }
    └─ GET /executions/:id  (fetch full run data)
    └─ workflowsStore.setWorkflowExecutionRunData(runExecutionData)
    └─ workflowState.setActiveExecutionId(undefined)
    └─ nodeHelpers.updateNodesExecutionIssues()
    └─ toast.showMessage(success|error)
    └─ documentTitle → 'IDLE' | 'ERROR'
    └─ NDV panels re-render with output data (Vue reactivity)
```

---

## Key Files

| File | Description |
|---|---|
| `/Users/ib/prj-other/n0n/n8n/packages/frontend/@n8n/stores/src/constants.ts` | Central `STORES` enum with all Pinia store IDs |
| `/Users/ib/prj-other/n0n/n8n/packages/frontend/@n8n/stores/src/useRootStore.ts` | Root store: REST base URL, pushRef (tab ID), server config |
| `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/stores/pushConnection.store.ts` | Push connection lifecycle, message fan-out to subscribers |
| `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/push-connection/useWebSocketClient.ts` | WebSocket transport with heartbeat and reconnect logic |
| `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/push-connection/useEventSourceClient.ts` | SSE transport with reconnect logic |
| `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/composables/usePushConnection/usePushConnection.ts` | Dispatches push events to per-type handler functions |
| `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/composables/usePushConnection/handlers/executionFinished.ts` | Main execution completion handler: fetches data, updates all stores, shows toast |
| `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/stores/workflows.store.ts` | Core workflow store: current workflow, execution data, node states |
| `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/stores/workflowsList.store.ts` | Workflow list cache; updated by push events and direct API calls |
| `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/stores/workflowDocument.store.ts` | Per-workflow document store factory (pinData, tags, active state) |
| `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/stores/ui.store.ts` | Modal registry, theme, dirty state, UI layout flags |
| `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/stores/settings.store.ts` | Backend feature flags, push transport choice, enterprise features |
| `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/features/collaboration/collaboration/collaboration.store.ts` | Real-time multi-user collaboration: write locks, collaborator list |
| `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/router.ts` | All route definitions, middleware chain, guards |
| `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/init.ts` | App bootstrap: `initializeCore()` and `initializeAuthenticatedFeatures()` |
| `/Users/ib/prj-other/n0n/n8n/packages/frontend/@n8n/rest-api-client/src/utils.ts` | `makeRestApiRequest`: axios wrapper, auth headers, error normalization |
| `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/composables/useRunWorkflow.ts` | Execution trigger composable: save-then-run, push-ref check, chat handling |
| `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/app/views/NodeView.vue` | Main workflow editor view: mounts canvas, registers push listeners, coordinates stores |
| `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/src/features/collaboration/projects/projects.routes.ts` | Project-scoped route definitions (home, shared, /projects/:id) |
| `/Users/ib/prj-other/n0n/n8n/packages/@n8n/api-types/src/push/index.ts` | `PushMessage` discriminated union — all push event types |
| `/Users/ib/prj-other/n0n/n8n/packages/frontend/editor-ui/vite.config.mts` | Vite build config: aliases, plugins, env prefix, dev server |
