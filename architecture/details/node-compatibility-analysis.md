# n8n Node Compatibility Analysis for n0n

**Date:** 2026-02-27
**n8n version analyzed:** 2.10.0
**Analysis scope:** Feasibility of reusing n8n's 400+ node integrations in n0n

---

## Executive Summary

Reusing n8n's 400+ node integrations in n0n is **technically feasible but requires significant effort**. The node interface contract lives entirely in `n8n-workflow` (a pure TypeScript package with zero server dependencies). 95%+ of nodes import only from `n8n-workflow`, making them portable. The core challenge is not the node class itself but the **execution context object** (`IExecuteFunctions`) which exposes ~80 methods that n0n's engine must implement faithfully.

**Key insight:** You cannot just "copy paste" the node files. The nodes are simple classes — what makes them work is the execution context injected as `this` by the engine. That context is where all the complexity lives.

---

## Can We Just Copy-Paste n8n Nodes?

**Short answer: Almost.** Here's what works and what doesn't:

### What Works (Direct Reuse)

95% of nodes in `nodes-base` import only from `n8n-workflow`:

```typescript
// Typical node imports — ALL from n8n-workflow, zero server coupling
import type { IExecuteFunctions, INodeExecutionData, INodeType } from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
```

Verified clean nodes: Set, If, HTTP Request, Slack, Postgres, Google Sheets, Okta, Gmail, Notion, Airtable, and virtually every API integration node.

### What Doesn't Work

| Node | Problem | Fix |
|------|---------|-----|
| **Code** | Imports `@n8n/di` (Container), `@n8n/config` | Fork: replace 3 lines of DI calls |
| **ExecuteWorkflow** | Calls `additionalData.executeWorkflow()` — needs CLI | Implement sub-workflow in n0n engine |
| **LangChain nodes** (all) | Deep AI sub-node connection system | Separate evaluation needed |

---

## The Real Challenge: The Execution Context

Nodes are simple — a class with a `description` object and an `execute()` method. The complexity is in `this`:

```typescript
// n8n calls nodes like this:
node.execute.call(executionContext);
// Inside execute(), `this` IS the executionContext
```

That `executionContext` implements `IExecuteFunctions` (`packages/workflow/src/interfaces.ts:1030`) with **~80 methods**. Here are the ones that matter most:

### Tier 1 — Must implement to run ANY node

| Method | What it does | Effort |
|--------|-------------|--------|
| `this.getInputData()` | Get items from input port | Trivial |
| `this.getNodeParameter(name, itemIndex)` | Resolve parameter value (with expressions) | Moderate — needs expression engine |
| `this.getCredentials(type)` | Decrypt and return credentials | Moderate — needs encryption |
| `this.continueOnFail()` | Check error handling mode | Trivial |
| `this.getNode()` | Return node metadata | Trivial |
| `this.getWorkflow()` | Return workflow metadata | Trivial |
| `this.helpers.httpRequest(options)` | Make HTTP call | Trivial — wrap fetch |
| `this.helpers.returnJsonArray(data)` | Wrap objects as INodeExecutionData[] | Trivial |

### Tier 2 — Needed for authenticated API nodes (~80% of catalog)

| Method | What it does | Effort |
|--------|-------------|--------|
| `this.helpers.httpRequestWithAuthentication(credType, options)` | HTTP + credential injection | Moderate |
| `this.helpers.requestWithAuthenticationPaginated()` | Automated pagination | Moderate |
| `this.helpers.constructExecutionMetaData(items, itemData)` | Paired item tracking | Trivial |

### Tier 3 — Needed for file/binary nodes

| Method | What it does | Effort |
|--------|-------------|--------|
| `this.helpers.prepareBinaryData(buffer, filename, mimeType)` | Store binary data | Moderate — needs storage backend |
| `this.helpers.getBinaryDataBuffer(itemIndex, propertyName)` | Retrieve binary buffer | Moderate |
| `this.helpers.assertBinaryData(itemIndex, propertyName)` | Validate binary exists | Trivial |

### Tier 4 — Needed for polling/trigger nodes

| Method | What it does | Effort |
|--------|-------------|--------|
| `this.getWorkflowStaticData(type)` | Persistent per-node storage across runs | Moderate — needs DB |
| `this.helpers.checkProcessedAndRecord(items, scope)` | Deduplication | Moderate |

---

## Strategy: How to Make n0n Compatible

### Option A — Adopt n8n's Interface Natively (Recommended)

n0n's engine directly implements `IExecuteFunctions`. Node classes from `n8n-nodes-base` work without modification.

**Steps:**
1. Add `n8n-workflow` as a dependency (pure TS package, no server deps)
2. Add `n8n-nodes-base` as a dependency (the 400+ nodes)
3. Implement `IExecuteFunctions` in n0n's engine — start with Tier 1 methods (8 methods covers basic nodes)
4. Load nodes using the `n8n.nodes` field from `n8n-nodes-base/package.json`
5. Call `node.execute.call(n0nContext)` where `n0nContext` conforms to `IExecuteFunctions`

**Why this works:** `n8n-workflow` is a pure package. It exports types, utilities (`NodeOperationError`, `jsonParse`), and the expression engine. No Express, no TypeORM, no Redis.

### Option B — Adapter Layer (Not Recommended)

Keep n0n's native interface, build a translation layer. This requires mapping 80+ methods — nearly the same effort as Option A but with two interfaces to maintain.

---

## Credential System: Clean Interface Boundary

Nodes declare credentials in their description:
```typescript
credentials: [{ name: 'slackOAuth2Api', required: true }]
```

At runtime, nodes call `this.getCredentials('slackOAuth2Api')` and receive a plain decrypted object. The node never handles encryption, token refresh, or OAuth flows.

The boundary is `ICredentialsHelper` (`interfaces.ts:209`):
```typescript
export abstract class ICredentialsHelper {
  abstract getDecrypted(...): Promise<ICredentialDataDecryptedObject>;
  abstract authenticate(credentials, typeName, requestOptions, ...): Promise<IHttpRequestOptions>;
  abstract preAuthentication(...): Promise<...>;  // token refresh
}
```

n0n implements this interface with its own storage. As long as `getDecrypted()` returns the right object, nodes work unchanged.

**OAuth2 complexity:** Token refresh logic is ~300 lines in `n8n-core/src/credentials.ts`. Non-trivial but well-bounded. Can be deferred — start with API key credentials first.

---

## Expression System: Zero Work Needed

Expressions are **completely transparent to nodes**. When a node calls:
```typescript
const url = this.getNodeParameter('url', 0);
```
The context resolves `={{ $json.host }}/api` to `example.com/api` before the node sees it.

The entire expression engine (AST parser, security sandbox, context variables) lives inside `n8n-workflow`. n0n imports it directly — no reimplementation needed.

---

## Declarative (Routing) Nodes: ~20% of Catalog

Nodes without `execute()` use declarative routing:

```typescript
// Okta.node.ts — no execute() method
description: {
  requestDefaults: { baseURL: '={{$credentials.url}}' },
  properties: [{
    name: 'operation',
    routing: {
      request: { method: 'GET', url: '/api/v1/users' },
      output: { postReceive: [{ type: 'rootProperty', properties: { property: 'users' } }] },
    },
  }],
}
```

The `RoutingNode` class (`packages/core/src/execution-engine/routing-node.ts:44`, ~600 lines) handles these by translating routing config into HTTP calls. It depends on `IExecuteFunctions` — once that's implemented, porting `RoutingNode` is straightforward.

---

## Community Nodes: Same Mechanism

Community nodes are npm packages with a special `package.json` field:
```json
{
  "name": "n8n-nodes-mypkg",
  "n8n": {
    "nodes": ["dist/nodes/MyNode/MyNode.node.js"],
    "credentials": ["dist/credentials/MyApi.credentials.js"]
  }
}
```

The loader (`PackageDirectoryLoader`, ~100 lines) reads this field, `require()`s each file, instantiates the class. Bun supports CommonJS `require()`.

**Prerequisite:** n0n must ship `n8n-workflow` as a resolvable dependency so community node imports resolve at runtime.

---

## Phased Implementation Plan

### Phase 1 — Run Top 20 Nodes (4-6 weeks)

| Task | Effort | Result |
|------|--------|--------|
| Add `n8n-workflow` + `n8n-nodes-base` as deps | 1 day | Access to all types and node classes |
| Implement Tier 1 context methods (8 methods) | 2 weeks | Set, If, HTTP Request (no auth) work |
| Implement basic credential storage (API keys) | 1 week | Slack (token), Postgres (password) work |
| Implement `helpers.httpRequestWithAuthentication` | 1 week | All basic auth API nodes work |
| Node loader from `n8n.nodes` field | 2 days | Can load any n8n-nodes-base node |

**Milestone:** ~20 nodes running: Set, If, Merge, HTTP Request, Slack, Postgres, MySQL, Redis, Webhook, Schedule, etc.

### Phase 2 — Broad Compatibility (2-3 months)

| Task | Effort | Result |
|------|--------|--------|
| Complete all ~50 IExecuteFunctions methods | 3 weeks | All programmatic nodes supported |
| Port `RoutingNode` (~600 lines) | 1 week | Declarative nodes (Okta, etc.) work |
| Implement binary data helpers | 2 weeks | File/image nodes work |
| Implement OAuth2 token refresh | 2 weeks | Google, GitHub, Slack OAuth nodes work |
| Implement `getWorkflowStaticData` | 1 week | Polling triggers (Gmail, RSS) work |
| Implement deduplication helper | 1 week | Polling triggers fully functional |

**Milestone:** ~200+ nodes running, community nodes loadable.

### Phase 3 — Full Ecosystem (1-2 months)

| Task | Effort | Result |
|------|--------|--------|
| Community node loader | 3 days | `npm install n8n-nodes-*` works |
| `ITriggerFunctions` + `IPollFunctions` | 2 weeks | All trigger types supported |
| `IWebhookFunctions` + `IHookFunctions` | 2 weeks | Webhook lifecycle (register/deregister) |
| `VersionedNodeType` support | 3 days | Multi-version nodes load correctly |
| Fork Code node (strip @n8n/di) | 2 days | Code node works in n0n |

**Milestone:** Full n8n node ecosystem compatibility.

---

## What n0n's Current Engine Needs to Change

Based on MEMORY.md, n0n already has a stack-based executor with `ExecutionHooks`. Key changes needed:

| Current n0n Pattern | Required Change |
|---------------------|----------------|
| `ExecutionHooks` pattern | Keep — similar to n8n's `LifecycleHooks` |
| n0n's node interface (6 nodes) | Replace with `INodeType` from `n8n-workflow` |
| n0n's execution context | Reimplement as `IExecuteFunctions` conforming to n8n's interface |
| `ConnectionMap` keyed by node names | Keep — matches n8n's `IConnections` format |
| Drizzle ORM | Keep for n0n's own data; add credential encryption compatible with n8n's AES-256 |

The engine architecture (stack-based loop, hooks pattern) is already aligned with n8n. The main work is replacing the node/context interface layer.

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| n8n changes INodeType in a future version | Nodes stop loading | Pin `n8n-workflow` version; update quarterly |
| n8n-nodes-base has transitive server deps | Build fails | Already verified: nodes-base depends only on n8n-workflow + npm libs |
| OAuth2 flows behave differently in Bun | Token refresh fails | Test OAuth flows early in Phase 1 |
| Expression engine assumes Node.js globals | Expressions break in Bun | Bun is Node.js compatible; low risk |
| Community nodes use undocumented APIs | Runtime crashes | Test top 20 community nodes in Phase 3 |
| License: n8n is Sustainable Use License | Legal risk | Review license terms for embedding nodes-base as dependency |

---

## Key Files for Implementation

| File | Purpose | Line |
|------|---------|------|
| `packages/workflow/src/interfaces.ts` | All node/context interfaces | `INodeType:1866`, `IExecuteFunctions:1030`, `ICredentialType:346`, `FunctionsBase:947`, `RequestHelperFunctions:830`, `BinaryHelperFunctions:753` |
| `packages/core/src/execution-engine/routing-node.ts` | Declarative node executor | `:44` (~600 lines) |
| `packages/core/src/execution-engine/node-execution-context/execute-context.ts` | Reference IExecuteFunctions implementation | `:48` |
| `packages/core/src/nodes-loader/package-directory-loader.ts` | Node loader from package.json | `:12` |
| `packages/core/src/nodes-loader/types.ts` | `n8n.PackageJson` spec | `:1` |
| `packages/workflow/src/expression.ts` | Expression engine (importable directly) | `:1` |
| `packages/workflow/src/workflow-data-proxy.ts` | Expression context ($json, $input, etc.) | `:759` |
| `packages/nodes-base/nodes/Code/Code.node.ts` | The one server-coupled node | `:1` |
| `packages/nodes-base/nodes/Okta/Okta.node.ts` | Clean declarative node example | `:7` |
| `packages/nodes-base/nodes/Postgres/v2/PostgresV2.node.ts` | Clean programmatic node example | `:13` |
| `packages/nodes-base/credentials/GoogleOAuth2Api.credentials.ts` | OAuth2 credential inheritance | `:3` |
| `packages/cli/src/modules/community-packages/community-packages.service.ts` | Community package management | `:57` |
