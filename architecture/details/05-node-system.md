# n8n Node System — Complete Analysis

This document describes how the n8n node (plugin) system works: interfaces, parameter types,
node lifecycle, registration, credential injection, expressions, versioning, and how to add a new node.

---

## 1. Node Interface Contract

### Core `INodeType` Interface

Every node must either implement `INodeType` (plain interface) or extend the abstract `Node` class.

**File:** `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/interfaces.ts:1866`

```typescript
export interface INodeType {
  // Required: full node descriptor (metadata, parameters, I/O)
  description: INodeTypeDescription;

  // Implement ONE of the following execution methods:
  execute?(this: IExecuteFunctions, response?: EngineResponse): Promise<NodeOutput>;
  poll?(this: IPollFunctions): Promise<INodeExecutionData[][] | null>;
  trigger?(this: ITriggerFunctions): Promise<ITriggerResponse | undefined>;
  webhook?(this: IWebhookFunctions): Promise<IWebhookResponseData>;

  // For AI sub-nodes that supply data to parent nodes (LLM, memory, tools, etc.)
  supplyData?(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData>;

  // Called when an AI agent node receives a chat message
  onMessage?(context: IExecuteFunctions, data: INodeExecutionData): Promise<NodeOutput>;

  // Optional dynamic methods
  methods?: {
    loadOptions?: {
      [key: string]: (this: ILoadOptionsFunctions) => Promise<INodePropertyOptions[]>;
    };
    listSearch?: {
      [key: string]: (
        this: ILoadOptionsFunctions,
        filter?: string,
        paginationToken?: string,
      ) => Promise<INodeListSearchResult>;
    };
    credentialTest?: {
      [functionName: string]: ICredentialTestFunction;
    };
    resourceMapping?: {
      [functionName: string]: (this: ILoadOptionsFunctions) => Promise<ResourceMapperFields>;
    };
    localResourceMapping?: {
      [functionName: string]: (this: ILocalLoadOptionsFunctions) => Promise<ResourceMapperFields>;
    };
    actionHandler?: {
      [functionName: string]: (
        this: ILoadOptionsFunctions,
        payload: IDataObject | string | undefined,
      ) => Promise<NodeParameterValueType>;
    };
  };

  // For webhook trigger nodes: manage webhook registration lifecycle
  webhookMethods?: {
    [name in WebhookType]?: {
      checkExists(this: IHookFunctions): Promise<boolean>;
      create(this: IHookFunctions): Promise<boolean>;
      delete(this: IHookFunctions): Promise<boolean>;
    };
  };

  // For declarative nodes: custom per-resource/operation execute functions
  customOperations?: {
    [resource: string]: {
      [operation: string]: (this: IExecuteFunctions) => Promise<NodeOutput>;
    };
  };
}
```

### Abstract `Node` Class (New-style API)

**File:** `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/interfaces.ts:2015`

```typescript
export abstract class Node {
  abstract description: INodeTypeDescription;
  execute?(context: IExecuteFunctions, response?: EngineResponse): Promise<INodeExecutionData[][] | EngineRequest>;
  webhook?(context: IWebhookFunctions): Promise<IWebhookResponseData>;
  poll?(context: IPollFunctions): Promise<INodeExecutionData[][] | null>;
}
```

The new-style `Node` abstract class passes the context as an explicit argument rather than binding it as `this`. Both approaches coexist.

---

## 2. Node Description Structure

### `INodeTypeDescription`

**File:** `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/interfaces.ts:2348`

```typescript
export interface INodeTypeDescription extends INodeTypeBaseDescription {
  // Numeric version or array of numeric versions supported by this implementation
  version: number | number[];

  // Default values for newly placed nodes (name, color)
  defaults: NodeDefaults;

  // Displayed in UI when workflow is inactive (for trigger nodes)
  eventTriggerDescription?: string;
  activationMessage?: string;

  // Connection types for inputs; can be dynamic via expression string like ={{...}}
  inputs: Array<NodeConnectionType | INodeInputConfiguration> | ExpressionString;
  requiredInputs?: string | number[] | number;
  inputNames?: string[];

  // Connection types for outputs; can be dynamic via expression string
  outputs: Array<NodeConnectionType | INodeOutputConfiguration> | ExpressionString;
  outputNames?: string[];

  // All parameter definitions rendered in the UI
  properties: INodeProperties[];

  // Credential types this node can use
  credentials?: INodeCredentialDescription[];

  // Max instances in a workflow (e.g. trigger nodes: 1)
  maxNodes?: number;

  // Marks polling nodes (adds polling interval parameters automatically)
  polling?: true;

  // Marks CORS-enabled webhook nodes
  supportsCORS?: true;

  // For declarative nodes: default request settings applied to all operations
  requestDefaults?: DeclarativeRestApiSettings.HttpRequestOptions;

  // For declarative nodes: shared request operation config
  requestOperations?: IN8nRequestOperations;

  // Webhook lifecycle hook descriptions (activate/deactivate)
  hooks?: {
    activate?: INodeHookDescription[];
    deactivate?: INodeHookDescription[];
  };

  // Webhook endpoint descriptions (path, method, etc.)
  webhooks?: IWebhookDescription[];

  // Translation data for i18n
  translation?: { [key: string]: object };

  // UI for trigger nodes: panels, hints, help text
  triggerPanel?: TriggerPanelDefinition | boolean;

  // Credential type this node's credential extends (for credential-only nodes)
  extendsCredential?: string;

  // Contextual hints shown in the NDV output panel
  hints?: NodeHint[];

  // For community nodes: the package version
  communityNodePackageVersion?: string;

  // Tooltip for wait state
  waitingNodeTooltip?: string;

  // Load options method names (for build-time validation only)
  __loadOptionsMethods?: string[];

  // Skip auto-generated node name from resource/operation
  skipNameGeneration?: boolean;

  // Feature flags for versioned behavior inside a single node implementation
  features?: NodeFeaturesDefinition;

  // AI workflow builder hints for type generation
  builderHint?: IBuilderHint;
}
```

### `INodeTypeBaseDescription`

**File:** `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/interfaces.ts:2099`

```typescript
export interface INodeTypeBaseDescription {
  displayName: string;           // Human-readable name shown in UI
  name: string;                  // Internal identifier (e.g. 'httpRequest')
  icon?: Icon;                   // 'fa:clock' | 'file:icon.svg' | themed variant
  iconColor?: ThemeIconColor;    // Preset color from design system
  iconUrl?: Themed<string>;      // Resolved URL (set by loader, not manually)
  group: NodeGroupType[];        // ['trigger'] | ['transform'] | ['output'] etc.
  description: string;           // Short description shown in node creator
  documentationUrl?: string;
  subtitle?: string;             // Dynamic subtitle expression
  defaultVersion?: number;       // Which version to use when adding new node
  codex?: CodexData;             // Search metadata: categories, aliases
  parameterPane?: 'wide';
  hidden?: true;                 // Hide from node creator (deprecated nodes)
  usableAsTool?: true | UsableAsToolDescription;  // Can be wrapped as AI tool
  builderHint?: IBuilderHint;
  schemaPath?: string;
}
```

---

## 3. Parameter Type System

### `NodePropertyTypes` — Complete List

**File:** `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/interfaces.ts:1445`

```typescript
export type NodePropertyTypes =
  | 'boolean'           // Checkbox
  | 'button'            // Clickable button (triggers actions or AI)
  | 'collection'        // Collapsible key-value section
  | 'color'             // Color picker
  | 'dateTime'          // Date and/or time picker
  | 'fixedCollection'   // Structured sub-object with named groups (can be multiValue)
  | 'hidden'            // Not shown in UI; carries invisible config
  | 'icon'              // Icon selector
  | 'json'              // JSON editor
  | 'callout'           // Info/warning callout block
  | 'notice'            // Inline notice text
  | 'multiOptions'      // Multi-select dropdown
  | 'number'            // Numeric input
  | 'options'           // Single-select dropdown (static or dynamic)
  | 'string'            // Text input (single/multi-line, code editor, SQL, etc.)
  | 'credentialsSelect' // Credential picker
  | 'resourceLocator'   // Pick resource by list/ID/URL
  | 'curlImport'        // Import from curl command
  | 'resourceMapper'    // Field mapper for DB-like operations
  | 'filter'            // Filter condition builder
  | 'assignmentCollection' // Assignment-style key-value pairs
  | 'credentials'       // Credentials display
  | 'workflowSelector'; // Workflow picker
```

### `INodeProperties` — Full Field Definition

**File:** `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/interfaces.ts:1654`

```typescript
export interface INodeProperties {
  displayName: string;
  name: string;
  type: NodePropertyTypes;
  typeOptions?: INodePropertyTypeOptions;   // Type-specific options (see below)
  default: NodeParameterValueType;
  description?: string;
  hint?: string;
  builderHint?: IParameterBuilderHint;      // AI builder usage hints
  disabledOptions?: IDisplayOptions;
  displayOptions?: IDisplayOptions;         // Conditional show/hide logic
  options?: Array<INodePropertyOptions | INodeProperties | INodePropertyCollection>;
  placeholder?: string;
  isNodeSetting?: boolean;                  // Shown as a node-level setting
  noDataExpression?: boolean;               // Disallow expressions for this field
  required?: boolean;
  routing?: INodePropertyRouting;           // For declarative nodes: how to use value in request
  credentialTypes?: Array<'extends:oAuth2Api' | 'extends:oAuth1Api' | 'has:authenticate' | 'has:genericAuth'>;
  extractValue?: INodePropertyValueExtractor;  // Regex to extract value (for resourceLocator)
  modes?: INodePropertyMode[];              // For resourceLocator: list/id/url modes
  requiresDataPath?: 'single' | 'multiple';
  doNotInherit?: boolean;
  validateType?: FieldType;
  ignoreValidationDuringExecution?: boolean;
  allowArbitraryValues?: boolean;           // For options/multiOptions: skip enum validation
  resolvableField?: boolean;                // For dynamic credential setup
}
```

### `INodePropertyTypeOptions` — Type-Specific Config

**File:** `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/interfaces.ts:1513`

Key fields:
- `loadOptionsMethod?: string` — method name in `methods.loadOptions` to populate dropdown
- `loadOptionsDependsOn?: string[]` — parameters this load depends on
- `multipleValues?: boolean` — allow arrays (works with any type)
- `multipleValueButtonText?: string`
- `sortable?: boolean` — allow drag-to-sort when multipleValues
- `rows?: number` — for string: number of textarea rows
- `editor?: EditorType` — for string: 'codeNodeEditor' | 'jsEditor' | 'htmlEditor' | 'sqlEditor' | 'cssEditor'
- `password?: boolean` — for string: mask input
- `minValue? / maxValue? / numberPrecision?` — for number
- `resourceMapper?: ResourceMapperTypeOptions` — for resourceMapper type
- `filter?: FilterTypeOptions` — for filter type
- `expirable?: boolean` — for hidden: credential expiry
- `fixedCollection?: { itemTitle?: string }` — for fixedCollection: item title template

### `IDisplayOptions` — Conditional Visibility

**File:** `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/interfaces.ts:1629`

```typescript
export interface IDisplayOptions {
  hide?: {
    [parameterName: string]: Array<NodeParameterValue | DisplayCondition> | undefined;
  };
  show?: {
    '@version'?: Array<number | DisplayCondition>;  // Show only for specific node versions
    '@feature'?: Array<string | DisplayCondition>;  // Feature flag conditions
    '@tool'?: boolean[];                             // Show only when used as AI tool
    [parameterName: string]: Array<NodeParameterValue | DisplayCondition> | undefined;
  };
  hideOnCloud?: boolean;
}
```

`DisplayCondition` operators: `eq`, `not`, `gte`, `lte`, `gt`, `lt`, `between`, `startsWith`, `endsWith`, `includes`, `regex`, `exists`.

### Declarative Routing (`INodePropertyRouting`)

**File:** `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/interfaces.ts:2150`

Declarative nodes use `routing` on parameters to map values to HTTP requests without writing an `execute` function:

```typescript
export interface INodePropertyRouting {
  request?: DeclarativeRestApiSettings.HttpRequestOptions;  // Merge into request
  send?: INodeRequestSend;     // How to send this parameter (body/query/header)
  output?: INodeRequestOutput; // Post-receive processing steps
  operations?: IN8nRequestOperations;
}
```

### `INodePropertyOptions` — Dropdown Item

**File:** `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/interfaces.ts:1755`

```typescript
export interface INodePropertyOptions {
  name: string;
  value: string | number | boolean;
  action?: string;
  description?: string;
  routing?: INodePropertyRouting;      // Per-option declarative routing
  outputConnectionType?: NodeConnectionType;
  displayOptions?: IDisplayOptions;
}
```

### `INodePropertyCollection` — fixedCollection Group

**File:** `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/interfaces.ts:1780`

```typescript
export interface INodePropertyCollection {
  displayName: string;
  name: string;
  values: INodeProperties[];
}
```

---

## 4. Connection Types

**File:** `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/interfaces.ts:2248`

```typescript
export const NodeConnectionTypes = {
  AiAgent: 'ai_agent',
  AiChain: 'ai_chain',
  AiDocument: 'ai_document',
  AiEmbedding: 'ai_embedding',
  AiLanguageModel: 'ai_languageModel',
  AiMemory: 'ai_memory',
  AiOutputParser: 'ai_outputParser',
  AiRetriever: 'ai_retriever',
  AiReranker: 'ai_reranker',
  AiTextSplitter: 'ai_textSplitter',
  AiTool: 'ai_tool',
  AiVectorStore: 'ai_vectorStore',
  Main: 'main',
} as const;
```

The `Main` type is used by regular nodes. All `ai_*` types are used by AI sub-nodes that plug into LangChain chains/agents via `supplyData`.

---

## 5. Credential System

### Declaring Credentials on a Node

**File:** `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/interfaces.ts:2042`

```typescript
export interface INodeCredentialDescription {
  name: string;               // Internal credential type name (e.g. 'githubApi')
  required?: boolean;
  displayName?: string;
  disabledOptions?: ICredentialsDisplayOptions;
  displayOptions?: ICredentialsDisplayOptions;  // Show/hide this cred based on parameters
  testedBy?: ICredentialTestRequest | string;   // Test function or inline request
}
```

Example in node description:
```typescript
credentials: [
  {
    name: 'xAiApi',
    required: true,
  },
],
```

### Accessing Credentials at Runtime

Nodes call `this.getCredentials<T>('credentialTypeName', itemIndex)` (or `await this.getCredentials<T>('type')` in trigger/poll/webhook contexts).

**File:** `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/node-execution-context/base-execute-context.ts:95`

The implementation calls `_getCredentials` on `NodeExecutionContext`:

**File:** `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/node-execution-context/node-execution-context.ts:286`

The credential flow:
1. Check that credential type is declared in `description.credentials`
2. Verify `displayOptions` to confirm credential is currently relevant
3. Check that node instance has credentials set (`node.credentials[type]`)
4. Call `additionalData.credentialsHelper.getDecrypted(...)` to decrypt
5. Return `ICredentialDataDecryptedObject`

Only the HTTP Request node has `fullAccess` to any credential type. All other nodes can only access their declared credential types.

### `ICredentialType` — Credential Definition

**File:** `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/interfaces.ts:346`

```typescript
export interface ICredentialType {
  name: string;
  displayName: string;
  icon?: Icon;
  extends?: string[];                      // Inherit from parent credential type
  properties: INodeProperties[];           // Credential input fields
  documentationUrl?: string;
  authenticate?: IAuthenticate;            // How to inject credentials into requests
  preAuthentication?: (this: IHttpRequestHelper, credentials) => Promise<IDataObject>;
  test?: ICredentialTestRequest;           // How to verify credentials work
  genericAuth?: boolean;                   // Shown in HTTP Request node predefined auth
  httpRequestNode?: ICredentialHttpRequestNode;
  supportedNodes?: string[];               // Auto-inferred from usage
}
```

---

## 6. Execution Contexts

Each node execution method receives a different context type:

| Method | Context Interface | Context Class |
|--------|------------------|---------------|
| `execute` | `IExecuteFunctions` | `ExecuteContext` |
| `supplyData` | `ISupplyDataFunctions` | `SupplyDataContext` |
| `poll` | `IPollFunctions` | `PollContext` |
| `trigger` | `ITriggerFunctions` | `TriggerContext` |
| `webhook` | `IWebhookFunctions` | `WebhookContext` |
| `methods.loadOptions.*` | `ILoadOptionsFunctions` | `LoadOptionsContext` |
| `webhookMethods.*.*` | `IHookFunctions` | `HookContext` |

**Context class files:**
- `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/node-execution-context/execute-context.ts:48`
- `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/node-execution-context/supply-data-context.ts:43`
- `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/node-execution-context/poll-context.ts`
- `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/node-execution-context/trigger-context.ts:31`
- `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/node-execution-context/webhook-context.ts`

All contexts extend `NodeExecutionContext` (base) → `BaseExecuteContext` (for execute/supply/poll).

Key methods available on `IExecuteFunctions`:

```typescript
// Data access
getInputData(inputIndex?, connectionType?): INodeExecutionData[]
getNodeParameter(name: string, itemIndex: number, fallbackValue?): NodeParameterValueType
getCredentials<T>(type: string, itemIndex: number): Promise<T>
getNode(): INode
getWorkflow(): IWorkflowMetadata

// Execution control
putExecutionToWait(waitTill: Date): Promise<void>
executeWorkflow(workflowInfo, inputData?, options?): Promise<ExecuteWorkflowData>

// HTTP helpers
helpers.httpRequest(options): Promise<IN8nHttpFullResponse | IN8nHttpResponse>
helpers.httpRequestWithAuthentication(credentialsType, options): Promise<...>
helpers.requestOAuth1(credentialsType, options): Promise<...>
helpers.requestOAuth2(credentialsType, options): Promise<...>

// Binary data
helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName): Promise<Buffer>
helpers.prepareBinaryData(buffer, fileName?, mimeType?): Promise<IBinaryData>

// AI sub-node data retrieval
getInputConnectionData(connectionType: AINodeConnectionType, itemIndex: number): Promise<unknown>

// Node state
getWorkflowStaticData(type: 'global' | 'node'): IDataObject
getContext(type: ContextType): IContextObject
```

---

## 7. Node Lifecycle

### Registration (Startup)

1. `LoadNodesAndCredentials.init()` runs at server startup.
   **File:** `/Users/ib/prj-other/n0n/n8n/packages/cli/src/load-nodes-and-credentials.ts:66`

2. It scans `node_modules` for packages named `n8n-nodes-*`, `@*/n8n-nodes-*`, plus always loads `n8n-nodes-base` and `@n8n/n8n-nodes-langchain`.

3. For each package it creates a `LazyPackageDirectoryLoader`:
   **File:** `/Users/ib/prj-other/n0n/n8n/packages/core/src/nodes-loader/lazy-package-directory-loader.ts:6`

4. Lazy loading reads `dist/known/nodes.json`, `dist/types/nodes.json` without importing JS.

5. Actual class import happens on first request via `loader.getNode()`.
   **File:** `/Users/ib/prj-other/n0n/n8n/packages/core/src/nodes-loader/directory-loader.ts:239`

6. After all loaders run, `postProcessLoaders()` merges everything, injects "Custom API Call" options, injects dynamic credential hooks, and generates AI tool wrappers.
   **File:** `/Users/ib/prj-other/n0n/n8n/packages/cli/src/load-nodes-and-credentials.ts:491`

### Discovery — package.json `n8n` Key

**File:** `/Users/ib/prj-other/n0n/n8n/packages/core/src/nodes-loader/package-directory-loader.ts:27`

```json
{
  "n8n": {
    "nodes": ["dist/nodes/Foo/Foo.node.js"],
    "credentials": ["dist/credentials/FooApi.credentials.js"]
  }
}
```

The loader reads `packageJson.n8n.nodes` and calls `loadNodeFromFile()` for each path.

### Node Class Loading

**File:** `/Users/ib/prj-other/n0n/n8n/packages/core/src/nodes-loader/directory-loader.ts:163`

When a node file is loaded:
1. Import the file, instantiate the class (first exported class with matching name)
2. If it's a `VersionedNodeType`: process all versions individually
3. Add codex data (categories, aliases) from adjacent `.json` file
4. Fix icon paths (convert `file:icon.svg` to served URL)
5. Apply special parameters: polling nodes get polling interval fields automatically; CORS nodes get CORS parameters
6. Declarative nodes get `requestOptions` parameter automatically
7. Register in `known.nodes`, `nodeTypes`, `types.nodes`

### Workflow Execution — Node Dispatch

**File:** `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/workflow-execute.ts:1186`

The `runNode()` method dispatches to the right executor:

```
if nodeType.execute || customOperation  →  executeNode()      (standard programmatic)
if nodeType.poll                        →  executePollNode()   (poll mode)
if nodeType.trigger                     →  executeTriggerNode() (trigger mode)
else (declarative, no execute)          →  executeDeclarativeNodeInTest()
```

For disabled nodes: pass through input unchanged.
For webhook nodes in non-test mode: pass through input (webhook already handled by WebhookService).

### Trigger Activation

When a workflow is activated, trigger nodes go through:
1. `TriggersAndPollers.runTrigger()` — calls `nodeType.trigger.call(triggerFunctions)`
   **File:** `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/triggers-and-pollers.ts:26`
2. The trigger node sets up its listener (cron job, AMQP consumer, etc.)
3. Returns an `ITriggerResponse` with a `closeFunction` and optionally a `manualTriggerFunction`
4. When data arrives, the node calls `this.emit(data)` to start a workflow execution

For webhook triggers, `webhookMethods.checkExists/create/delete` are called during activation/deactivation. The WebhookService registers the URL and routes incoming requests to `nodeType.webhook()`.

---

## 8. Trigger Nodes vs Regular Nodes

| Aspect | Regular (execute) | Trigger | Poll Trigger |
|--------|------------------|---------|--------------|
| Execution method | `execute()` | `trigger()` | `poll()` |
| Activation | None | `webhookMethods` or `trigger()` setup | Scheduled interval |
| Input connections | `[Main]` | `[]` | `[]` |
| Data source | Upstream nodes | External event (webhook, queue, etc.) | Periodic HTTP check |
| Description flag | (none) | `group: ['trigger']` | `polling: true` |
| Special parameters | None | `triggerPanel` config | Auto-injected polling params |
| Context | `IExecuteFunctions` | `ITriggerFunctions` | `IPollFunctions` |

**Poll triggers:**
- Set `polling: true` in description
- System auto-injects polling interval parameters via `applySpecialNodeParameters`
  **File:** `/Users/ib/prj-other/n0n/n8n/packages/core/src/nodes-loader/directory-loader.ts:401`
- `poll()` returns data if new items exist since last check, or `null` if nothing new
- State persisted across runs via `this.getWorkflowStaticData('node')`

**Generic triggers (`trigger()`):**
- Set up a long-lived connection (WebSocket, AMQP, MQTT, SSE, etc.)
- Call `this.emit(data)` when events arrive
- Return a `closeFunction` to tear down the connection

**Webhook triggers:**
- Have `webhooks` array in description; `webhookMethods` for lifecycle
- `checkExists()` — verify webhook still registered with external service
- `create()` — register webhook with external service
- `delete()` — unregister webhook
- `webhook()` — handle incoming HTTP request and return response

---

## 9. Declarative Nodes

A node without `execute`, `poll`, `trigger`, or `webhook` is a declarative node. It uses `requestDefaults` and parameter `routing` to describe API calls as data rather than code.

**Example (PostBin):**
**File:** `/Users/ib/prj-other/n0n/n8n/packages/nodes-base/nodes/PostBin/PostBin.node.ts:7`

```typescript
export class PostBin implements INodeType {
  description: INodeTypeDescription = {
    requestDefaults: { baseURL: 'https://www.postb.in' },
    properties: [
      {
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [{ name: 'Bin', value: 'bin' }],
        default: 'bin',
      },
      // ...operations and fields with routing config
    ],
  };
}
```

The `RoutingNode` class handles declarative execution:
**File:** `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/routing-node.ts:44`

At startup, `shouldAssignExecuteMethod()` detects declarative nodes and assigns a real `execute` function that invokes `RoutingNode.runNode()`.
**File:** `/Users/ib/prj-other/n0n/n8n/packages/cli/src/node-types.ts:88`

Declarative node post-receive actions: `rootProperty`, `setKeyValue`, `filter`, `limit`, `sort`, `set`, `binaryData`.

---

## 10. AI Sub-Nodes Pattern

AI sub-nodes are the LangChain integration mechanism. They use `supplyData` instead of `execute` and output an AI connection type instead of `Main`.

**Example (xAI Grok Chat Model):**
**File:** `/Users/ib/prj-other/n0n/n8n/packages/@n8n/nodes-langchain/nodes/llms/LmChatXAiGrok/LmChatXAiGrok.node.ts:16`

```typescript
export class LmChatXAiGrok implements INodeType {
  description: INodeTypeDescription = {
    inputs: [],
    outputs: [NodeConnectionTypes.AiLanguageModel],  // ai_languageModel
    // ...
  };

  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
    const credentials = await this.getCredentials('xAiApi');
    const model = new ChatOpenAI({ /* LangChain model */ });
    return { response: model };
  }
}
```

Parent nodes (e.g. LLM Chain, AI Agent) call:
```typescript
const model = await this.getInputConnectionData(NodeConnectionTypes.AiLanguageModel, 0);
```

This triggers `supplyData` on the connected sub-node and returns whatever `response` it returned.

The AI connection types enable the following sub-node categories:
- `ai_languageModel` — LLM models (OpenAI, Anthropic, Grok, etc.)
- `ai_memory` — Conversation memory buffers
- `ai_tool` — Tools the agent can call
- `ai_vectorStore` — Vector database retrieval
- `ai_embedding` — Embedding models
- `ai_textSplitter` — Document chunkers
- `ai_retriever` — RAG retrievers
- `ai_outputParser` — Output format parsers

---

## 11. Node Versioning

### Light Versioning (Multiple Versions, One Implementation)

Set `version` to an array and use `@version` in `displayOptions.show` to vary behavior:

```typescript
description: INodeTypeDescription = {
  version: [1, 1.1, 1.2, 1.3],
  defaultVersion: 1.3,
  properties: [
    {
      displayOptions: {
        show: { '@version': [{ _cnd: { gte: 1.1 } }] }
      }
    }
  ],
};
```

**File (example):** `/Users/ib/prj-other/n0n/n8n/packages/nodes-base/nodes/Webhook/Webhook.node.ts:49`

### Full Versioning (Separate Implementation per Version)

Use the `VersionedNodeType` class with a map of version → `INodeType`:

**File:** `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/versioned-node-type.ts:3`

```typescript
export class VersionedNodeType implements IVersionedNodeType {
  nodeVersions: { [key: number]: INodeType };
  currentVersion: number;
  description: INodeTypeBaseDescription;

  getNodeType(version?: number): INodeType { ... }
}
```

**File (example):** `/Users/ib/prj-other/n0n/n8n/packages/nodes-base/nodes/HttpRequest/HttpRequest.node.ts:8`

```typescript
export class HttpRequest extends VersionedNodeType {
  constructor() {
    const baseDescription: INodeTypeBaseDescription = { /* shared metadata */ };
    const nodeVersions = {
      1: new HttpRequestV1(baseDescription),
      2: new HttpRequestV2(baseDescription),
      3: new HttpRequestV3(baseDescription),
      4: new HttpRequestV3(baseDescription),
      4.4: new HttpRequestV3(baseDescription),
    };
    super(nodeVersions, baseDescription);
  }
}
```

Existing workflow nodes store their `typeVersion` in the workflow JSON and the engine always loads that exact version:
```typescript
workflow.nodeTypes.getByNameAndVersion(node.type, node.typeVersion)
```

**File:** `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/workflow-execute.ts:1203`

---

## 12. Expression System

### Expression Syntax

Expressions use `={{ ... }}` syntax in parameter values. The content is JavaScript executed in a sandboxed evaluator.

**Expression type alias:** `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/interfaces.ts:2301`
```typescript
export type ExpressionString = `={{${string}}}`;
```

### Available Variables

**File:** `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/workflow-data-proxy.ts`

| Variable | Description |
|----------|-------------|
| `$json` | Current item's JSON data |
| `$binary` | Current item's binary data |
| `$input` | Input data access (`$input.first()`, `$input.all()`, `$input.item`) |
| `$node` | Access other nodes' output data |
| `$items(nodeName, outputIndex, runIndex)` | Legacy multi-item access |
| `$parameter` | Current node's parameter values |
| `$env` | Environment variables |
| `$prevNode` | Previous node name/output |
| `$runIndex` | Current run index |
| `$workflow` | Workflow metadata |
| `$execution` | Execution metadata |
| `$now` | Current timestamp (luxon DateTime) |
| `$today` | Today's date |
| `$fromAi(...)` | AI input function for agent tools |

Sandbox denies: `eval`, `Function`, `setTimeout`, `fetch`, `XMLHttpRequest`, `Promise`, `Reflect`, `Proxy`, `global`, `globalThis`, `window`.

### Expression Evaluation

**File:** `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/expression.ts:167`

The `Expression` class uses `tmpl` (expression evaluator proxy) with custom extension methods on strings, numbers, arrays, and objects. Expressions are resolved by the engine before being passed to node `getNodeParameter()` calls.

---

## 13. Node Discovery and Loading Summary

```
Server startup
  └── LoadNodesAndCredentials.init()
        ├── Scan node_modules for n8n-nodes-* and @*/n8n-nodes-* packages
        ├── Always load n8n-nodes-base and @n8n/n8n-nodes-langchain
        ├── Load custom directories from N8N_CUSTOM_EXTENSIONS env var
        └── For each package:
              └── LazyPackageDirectoryLoader.loadAll()
                    ├── Read dist/known/nodes.json        (node class locations)
                    ├── Read dist/types/nodes.json        (node descriptions)
                    └── Defer actual JS import until first getNode() call

  └── LoadNodesAndCredentials.postProcessLoaders()
        ├── Merge all loaders' known/types into global maps
        ├── Prefix node names with packageName (e.g. 'n8n-nodes-base.httpRequest')
        ├── Inject "Custom API Call" option on compatible nodes
        ├── createAiTools() — generate *Tool variants for usableAsTool nodes
        ├── createHitlTools() — generate *HitlTool variants
        └── Run post-processors

Runtime (node execution)
  └── NodeTypes.getByNameAndVersion(type, version)
        ├── If type ends in 'Tool': strip suffix, load base node, wrap as AI tool
        └── If declarative (no execute): assign execute = RoutingNode.runNode
```

The build pipeline generates `dist/known/nodes.json` and `dist/types/nodes.json` via the `n8n-generate-metadata` script in each node package.

---

## 14. Built-in Node Catalog

### Core / Flow Control

| Node | Type | Key Parameters | Purpose |
|------|------|---------------|---------|
| Manual Trigger | trigger | — | Start workflow manually |
| Schedule Trigger | trigger (interval/cron) | Trigger rules (seconds/minutes/hours/days/weeks/months/cron) | Run on schedule |
| Webhook | webhook | Path, HTTP method, auth, response mode | Accept HTTP requests |
| If | flow | Conditions (filter-type) | Branch: true/false |
| Switch | flow | Mode, value, routing rules | Multi-way branch |
| Merge | flow | Mode (merge-by-key, append, combine) | Combine data streams |
| Loop Over Items | flow | Batch size | Iterate over items |
| Wait | flow | Wait time / webhook resume | Pause execution |
| Execute Workflow | action | Workflow ID, input data | Call sub-workflow |
| Execute Command | action | Command, execute once | Run shell command |
| Error Trigger | trigger | — | Handle workflow errors |

### Data Transformation

| Node | Type | Key Parameters | Purpose |
|------|------|---------------|---------|
| Code | programmatic | Language (JS/Python), mode (runOnce/each) | Custom code execution |
| Set | programmatic | Assignments (field + value pairs) | Set/transform fields |
| Edit Fields (Set v3) | programmatic | Assignments, include/exclude | Modern field editing |
| Filter | programmatic | Conditions | Filter items |
| Item Lists | programmatic | Operation (splitOutItems/aggregateItems/sort/removeDuplicates) | Array operations |
| Compare Datasets | programmatic | Mode, keys | Diff two datasets |
| Aggregate | programmatic | Fields to aggregate | Combine items |
| Sort | programmatic | Fields, order | Sort items |
| Limit | programmatic | Max items | Slice output |
| Remove Duplicates | programmatic | Key fields | Deduplicate |
| Rename Keys | programmatic | Key mappings | Rename fields |
| Extract from File | programmatic | Format (CSV, JSON, etc.) | Parse binary files |
| Convert to File | programmatic | Format | Binary output |

### HTTP / Network

| Node | Type | Key Parameters | Purpose |
|------|------|---------------|---------|
| HTTP Request | programmatic (versioned) | Method, URL, auth, body, headers, pagination | Generic HTTP |
| GraphQL | programmatic | Endpoint, query, variables | GraphQL calls |
| HTML Extract | programmatic | CSS selectors | Scrape HTML |
| FTP | programmatic | Operation, path | FTP file transfer |
| SSH | programmatic | Command | SSH execution |

### Utilities

| Node | Type | Key Parameters | Purpose |
|------|------|---------------|---------|
| Crypto | programmatic | Action (hash/hmac/sign/generate-key) | Cryptographic ops |
| DateTime | programmatic | Operation, value, timezone | Date manipulation |
| Markdown | programmatic | Mode (toHtml/toMarkdown), content | Convert formats |
| Email Send | programmatic | To, subject, body, attachments | SMTP email |
| Read/Write File | programmatic | Operation, path | Local file I/O |
| JWT | programmatic | Operation, algorithm, secret | JWT tokens |
| Compression | programmatic | Operation, format | Zip/Gzip |
| Edit Image | programmatic | Operation (resize/crop/text/etc.) | Image manipulation |
| PDF | programmatic | Operation | PDF handling |

### Third-Party Integrations (400+)

Examples spanning trigger + action pairs:
- Gmail, Google Sheets, Google Drive, Google Calendar
- Slack, Discord, Mattermost, Teams, Telegram
- GitHub, GitLab, Bitbucket, Jira, Linear, ClickUp, Asana
- Hubspot, Salesforce, Pipedrive, ActiveCampaign
- Airtable, Notion, Coda, Baserow
- AWS (S3, Lambda, SQS, DynamoDB, SES, etc.)
- Stripe, Chargebee, QuickBooks
- MySQL, PostgreSQL, MongoDB, Redis, Elasticsearch

---

## 15. How to Add a New Node — Step-by-Step

### Step 1: Create Node Directory

```
packages/nodes-base/nodes/MyService/
├── MyService.node.ts      (main node class)
├── myservice.svg          (icon)
├── MyService.credentials.ts  (optional, in credentials/)
└── GenericFunctions.ts    (API helpers, optional)
```

Credentials go in: `packages/nodes-base/credentials/MyServiceApi.credentials.ts`

### Step 2: Implement the Node Class

For a simple programmatic node:

```typescript
import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

export class MyService implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'My Service',
    name: 'myService',
    icon: 'file:myservice.svg',
    group: ['transform'],
    version: 1,
    description: 'Interact with My Service',
    defaults: { name: 'My Service' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      { name: 'myServiceApi', required: true },
    ],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [{ name: 'Item', value: 'item' }],
        default: 'item',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['item'] } },
        options: [{ name: 'Get', value: 'get', action: 'Get an item' }],
        default: 'get',
      },
      {
        displayName: 'Item ID',
        name: 'itemId',
        type: 'string',
        displayOptions: { show: { resource: ['item'], operation: ['get'] } },
        default: '',
        required: true,
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const credentials = await this.getCredentials('myServiceApi', i);
      const resource = this.getNodeParameter('resource', i) as string;
      const operation = this.getNodeParameter('operation', i) as string;

      if (resource === 'item' && operation === 'get') {
        const itemId = this.getNodeParameter('itemId', i) as string;
        const response = await this.helpers.httpRequest({
          method: 'GET',
          url: `https://api.myservice.com/items/${itemId}`,
          headers: { Authorization: `Bearer ${credentials.apiKey}` },
        });
        returnData.push({ json: response as object });
      }
    }

    return [returnData];
  }
}
```

### Step 3: Implement Credentials (if needed)

```typescript
// packages/nodes-base/credentials/MyServiceApi.credentials.ts
import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class MyServiceApi implements ICredentialType {
  name = 'myServiceApi';
  displayName = 'My Service API';
  documentationUrl = 'https://docs.myservice.com/api';
  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
    },
  ];
  authenticate = {
    type: 'generic' as const,
    properties: {
      headers: { Authorization: '=Bearer {{$credentials.apiKey}}' },
    },
  };
  test = {
    request: { baseURL: 'https://api.myservice.com', url: '/me' },
  };
}
```

### Step 4: Register in package.json

**File:** `/Users/ib/prj-other/n0n/n8n/packages/nodes-base/package.json:24`

Add to the `n8n.nodes` array:
```json
"n8n": {
  "nodes": [
    "dist/nodes/MyService/MyService.node.js"
  ],
  "credentials": [
    "dist/credentials/MyServiceApi.credentials.js"
  ]
}
```

### Step 5: Add Codex File (optional, for search/categories)

```json
// packages/nodes-base/nodes/MyService/MyService.node.json
{
  "node": "n8n-nodes-base.myService",
  "nodeVersion": "1.0",
  "codexVersion": "1.0",
  "categories": ["Development"],
  "subcategories": { "Development": ["APIs"] },
  "alias": ["my service", "myservice"],
  "resources": {
    "primaryDocumentation": [{ "url": "https://docs.n8n.io/..." }],
    "credentialDocumentation": [{ "url": "https://docs.n8n.io/..." }]
  }
}
```

### Step 6: Build and Test

```bash
cd packages/nodes-base
pnpm build
pnpm test
```

For hot reload during development: `pnpm dev` — watches source files and reloads the server automatically via the parcel watcher.
**File:** `/Users/ib/prj-other/n0n/n8n/packages/cli/src/load-nodes-and-credentials.ts:625`

---

## 16. Community Nodes

Community nodes are npm packages following the same pattern. They must:
1. Have a `package.json` with `n8n.nodes` and `n8n.credentials` arrays
2. Use npm package names matching `n8n-nodes-*` or `@scope/n8n-nodes-*`
3. Be installed in `~/.n8n/nodes/node_modules/`

The `CustomDirectoryLoader` handles loading from custom paths.
**File:** `/Users/ib/prj-other/n0n/n8n/packages/core/src/nodes-loader/directory-loader.ts`

---

## Key Files

| File | Description |
|------|-------------|
| `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/interfaces.ts` | Central definition of all node interfaces: `INodeType`, `INodeTypeDescription`, `INodeProperties`, `NodePropertyTypes`, `IExecuteFunctions`, `ITriggerFunctions`, `IPollFunctions`, `IWebhookFunctions`, `ISupplyDataFunctions`, `IVersionedNodeType`, `ICredentialType`, `NodeConnectionTypes` — the single most important file |
| `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/versioned-node-type.ts` | `VersionedNodeType` base class for multi-version nodes; dispatches `getNodeType(version)` |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/load-nodes-and-credentials.ts` | Orchestrates all node loading, hot reload, AI tool injection, custom API call injection |
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/nodes-loader/directory-loader.ts` | Base loader: loads node classes from files, fixes icons, applies special parameters, codex data |
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/nodes-loader/package-directory-loader.ts` | Reads `package.json n8n.nodes` array and loads each listed file |
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/nodes-loader/lazy-package-directory-loader.ts` | Production loader: reads pre-built JSON manifests, imports JS only on demand |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/node-types.ts` | `NodeTypes` service: resolves node by name+version, wraps declarative nodes with execute, generates Tool variants |
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/workflow-execute.ts` | Core execution engine: `runNode()` dispatches to execute/poll/trigger/declarative; `executeNode()` creates ExecuteContext and calls `nodeType.execute` |
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/routing-node.ts` | Declarative node executor: reads `routing` configs on parameters and makes HTTP requests |
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/triggers-and-pollers.ts` | Runs trigger and poll nodes; handles `emit` override for manual testing |
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/node-execution-context/execute-context.ts` | `ExecuteContext` class implementing `IExecuteFunctions` — the full execution API |
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/node-execution-context/trigger-context.ts` | `TriggerContext` implementing `ITriggerFunctions` with `emit/emitError` |
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/node-execution-context/supply-data-context.ts` | `SupplyDataContext` implementing `ISupplyDataFunctions` for AI sub-nodes |
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/node-execution-context/node-execution-context.ts` | Base context class: `_getCredentials`, `getNodeParameter`, common node helpers |
| `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/expression.ts` | `Expression` class: sandboxed JS evaluator, global context setup, allowed/denied globals |
| `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/workflow-data-proxy.ts` | Creates `$json`, `$input`, `$node`, `$parameter`, `$env`, etc. proxy objects for expressions |
| `/Users/ib/prj-other/n0n/n8n/packages/nodes-base/nodes/Webhook/Webhook.node.ts` | Reference implementation of a webhook trigger node using new `Node` abstract class |
| `/Users/ib/prj-other/n0n/n8n/packages/nodes-base/nodes/Schedule/ScheduleTrigger.node.ts` | Reference implementation of a poll/schedule trigger with `trigger()` method |
| `/Users/ib/prj-other/n0n/n8n/packages/nodes-base/nodes/HttpRequest/HttpRequest.node.ts` | Reference of `VersionedNodeType` with multiple full-version implementations |
| `/Users/ib/prj-other/n0n/n8n/packages/@n8n/nodes-langchain/nodes/llms/LmChatXAiGrok/LmChatXAiGrok.node.ts` | Minimal AI sub-node using `supplyData` with `ai_languageModel` output |
| `/Users/ib/prj-other/n0n/n8n/packages/nodes-base/nodes/PostBin/PostBin.node.ts` | Minimal declarative node using `requestDefaults` and parameter `routing` |
| `/Users/ib/prj-other/n0n/n8n/packages/nodes-base/package.json` | Authoritative list of all built-in nodes and credentials via `n8n.nodes` / `n8n.credentials` arrays |
