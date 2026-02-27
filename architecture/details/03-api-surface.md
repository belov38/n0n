# n8n API Surface Analysis

> Complete mapping of HTTP routes, WebSocket events, and external integration points in the n8n workflow automation platform.

## Overview

n8n exposes three distinct API surfaces:
1. **Internal REST API** - Core workflow, execution, credential, and user management
2. **Public API** - OpenAPI-compliant external integration layer with API key authentication
3. **WebSocket/Push Channel** - Bidirectional real-time event streaming for UI updates and collaboration
4. **Webhooks** - Incoming webhook endpoints for form responses and manual workflow triggers

The backend uses:
- **Framework**: Express.js (packages/cli/src)
- **Architecture**: Controller-Service-Repository pattern with @n8n/di dependency injection
- **Authentication**: Session-based JWT cookies + API keys
- **Error Handling**: Centralized ResponseError class hierarchy

---

## REST API Reference

### Authentication & Session Management

#### POST /auth/login
- **Path**: `/api/v1/auth/login`
- **Auth**: None (skipAuth: true)
- **Rate Limit**: IP-based (1000/5min) + email-based (5/1min keyed on `emailOrLdapLoginId`)
- **Request Body**: LoginRequestDto
  - `emailOrLdapLoginId: string` - Email or LDAP login ID
  - `password: string` - User password
  - `mfaCode?: string` - Optional MFA code
  - `mfaRecoveryCode?: string` - Optional recovery code
- **Response**: PublicUser
  - User profile with `id`, `email`, `firstName`, `lastName`, `role`, `mfaEnabled`, `isPending`, `isOwner`, `signInType`, `scopes`
- **Sets**: HttpOnly JWT cookie (`n8n-auth`) with `browserId` validation
- **Events**: `user-logged-in`, `user-login-failed`
- **File**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/controllers/auth.controller.ts:67

#### GET /auth/login
- **Path**: `/api/v1/auth/login`
- **Auth**: Required (allowSkipMFA: true)
- **Response**: PublicUser (current authenticated user)
- **Purpose**: Check if user is already logged in
- **File**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/controllers/auth.controller.ts:187

#### POST /auth/logout
- **Path**: `/api/v1/auth/logout`
- **Auth**: Required
- **Response**: `{ loggedOut: true }`
- **Clears**: JWT cookie + invalidates token
- **File**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/controllers/auth.controller.ts:266

#### GET /auth/resolve-signup-token
- **Path**: `/api/v1/auth/resolve-signup-token`
- **Auth**: None (skipAuth: true)
- **Query Params**: ResolveSignupTokenQueryDto
- **Response**: `{ inviter: { firstName, lastName } }`
- **Purpose**: Validate invite token before user signup
- **Events**: `user-invite-email-click`
- **File**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/controllers/auth.controller.ts:200

---

### User Management

**Base Path**: `/api/v1/users`
**Controller**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/controllers/users.controller.ts

#### GET /users/
- **Auth**: Required (Global Admin/Owner scope)
- **Query Params**: UsersListFilterDto
  - `limit?: number`
  - `offset?: number`
  - `select?: string[]` - Fields to return
  - `filter?: object` - Filter criteria
- **Response**: Array of PublicUser (paginated)
- **File**: Line 103-130

#### POST /users/
- **Auth**: Required (Global Admin/Owner scope)
- **Request**: User creation payload
- **Response**: PublicUser + full user details
- **File**: Line ~131

#### GET /users/:userId
- **Auth**: Required
- **Response**: PublicUser with full profile
- **File**: Line ~150

#### PATCH /users/:userId
- **Auth**: Required (must be owner or admin)
- **Request**: UserUpdateRequestDto
  - `email?: string`
  - `firstName?: string`
  - `lastName?: string`
  - `role?: string`
- **Response**: Updated PublicUser
- **File**: Line ~170

#### DELETE /users/:userId
- **Auth**: Required (Owner scope)
- **Response**: `{ success: true }`
- **Events**: `user-deleted`
- **File**: Line ~200

#### POST /users/:userId/change-role
- **Auth**: Required (Global Admin scope)
- **Request**: RoleChangeRequestDto
  - `role: string` - New role (e.g., 'global:member', 'global:admin')
- **Response**: Updated user with new role
- **File**: Line ~220

---

### Workflow Management

**Base Path**: `/api/v1/workflows`
**Controller**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/workflows/workflows.controller.ts

#### POST /workflows/
- **Auth**: Required
- **Request**: CreateWorkflowDto
  - `id?: string` - Workflow UUID
  - `name: string`
  - `nodes: Node[]`
  - `connections: Connections`
  - `active: boolean`
  - `settings?: WorkflowSettings`
- **Response**: WorkflowEntity with `id`, `name`, `nodes`, `connections`, `active`, `checksum`, `scopes`
- **Events**: `workflow-created`, `workflow-saved`
- **File**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/workflows/workflows.controller.ts:103

#### GET /workflows/
- **Auth**: Required
- **Query Params**: Pagination + filtering
  - `filter?: object` - Filter by name, tags, status
  - `limit?: number`
  - `offset?: number`
- **Response**: Array of WorkflowEntity with scopes and checksum
- **Middleware**: listQueryMiddleware
- **File**: Line 266

#### GET /workflows/new
- **Auth**: Required
- **Query Params**: `projectId?: string`
- **Response**: `{ name: "Workflow 1" }` - Auto-generated unique name
- **File**: Line 291

#### GET /workflows/from-url
- **Auth**: Required
- **Query Params**: `url: string` - URL to import workflow JSON from
- **Response**: Imported WorkflowEntity
- **File**: Line 307

#### GET /workflows/:workflowId
- **Auth**: Required (workflow:read scope)
- **Response**: Full WorkflowEntity with execution data
- **File**: Line 345

#### GET /workflows/:workflowId/exists
- **Auth**: Required
- **Response**: `{ exists: boolean }`
- **File**: Line 429

#### PATCH /workflows/:workflowId
- **Auth**: Required (workflow:update scope)
- **Request**: UpdateWorkflowDto
  - `name?: string`
  - `nodes: Node[]`
  - `connections: Connections`
  - `active?: boolean`
  - `settings?: WorkflowSettings`
- **Response**: Updated WorkflowEntity with checksum
- **Events**: `workflow-updated`, `workflow-saved`
- **File**: Line 435

#### DELETE /workflows/:workflowId
- **Auth**: Required (workflow:delete scope)
- **Response**: `true`
- **Events**: `workflow-deleted`
- **File**: Line 501

#### POST /workflows/:workflowId/activate
- **Auth**: Required (workflow:publish scope)
- **Request**: ActivateWorkflowDto
- **Response**: Activated WorkflowEntity
- **Events**: `workflow-activated`
- **File**: Line 590

#### POST /workflows/:workflowId/deactivate
- **Auth**: Required (workflow:unpublish scope)
- **Request**: DeactivateWorkflowDto
- **Response**: Deactivated WorkflowEntity
- **Events**: `workflow-deactivated`
- **File**: Line 624

#### POST /workflows/:workflowId/run
- **Auth**: Required (workflow:execute scope)
- **Request**: WorkflowRequest.ManualRun
  - `workflowData: IWorkflow` - Full workflow definition
  - `startNode?: string`
  - `destinationNode?: string`
  - `runData?: Record<string, ITaskData[]>`
- **Response**: Execution with initial run data
- **Execution**: Synchronous or queued based on config
- **File**: Line 655

#### POST /workflows/:workflowId/archive
- **Auth**: Required (workflow:delete scope)
- **Request**: ArchiveWorkflowDto
- **Response**: Archived WorkflowEntity
- **File**: Line 522

#### POST /workflows/:workflowId/unarchive
- **Auth**: Required (workflow:delete scope)
- **Request**: ArchiveWorkflowDto
- **Response**: Unarchived WorkflowEntity
- **File**: Line 556

#### PUT /workflows/:workflowId/share
- **Auth**: Required (Licensed: feat:sharing)
- **Request**: WorkflowRequest.Share
  - `shareWithIds: string[]` - User IDs to share with
- **Response**: Array of SharedWorkflow records
- **File**: Line 703

#### PUT /workflows/:workflowId/transfer
- **Auth**: Required (workflow:move scope)
- **Request**: TransferWorkflowBodyDto
  - `destinationProjectId: string`
- **Response**: Transferred WorkflowEntity
- **File**: Line 785

#### GET /workflows/:workflowId/executions/last-successful
- **Auth**: Required (workflow:read scope)
- **Response**: ExecutionEntity or null
- **File**: Line 802

#### GET /workflows/:workflowId/collaboration/write-lock
- **Auth**: Required (workflow:read scope)
- **Response**: `{ userId: string, clientId: string } | null` - Who has write lock
- **File**: Line 490

#### POST /workflows/with-node-types
- **Auth**: Required (Owner/Admin only)
- **Request**: Workflow query
- **Response**: Workflows with embedded node types
- **File**: Line 814

---

### Execution Management

**Base Path**: `/api/v1/executions`
**Controller**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/executions/executions.controller.ts

#### GET /executions/
- **Auth**: Required (workflow:read scope)
- **Query Params**: ExecutionRequest.GetMany
  - `workflowId?: string`
  - `status?: ExecutionStatus[]` - success, error, running, waiting
  - `range?: { firstId, lastId }`
  - `limit?: number`
  - `metadata?: object` - Advanced filters (licensed)
  - `annotationTags?: string[]` - Advanced filters (licensed)
- **Response**:
  ```json
  {
    "count": number,
    "estimated": boolean,
    "results": ExecutionSummary[],
    "concurrentExecutionsCount": number
  }
  ```
- **Middleware**: parseRangeQuery
- **File**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/executions/executions.controller.ts:37

#### GET /executions/:id
- **Auth**: Required (workflow:read scope)
- **Response**: Full ExecutionEntity with all run data
- **File**: Line 90

#### POST /executions/:id/stop
- **Auth**: Required (workflow:execute scope)
- **Request**: ExecutionRequest.Stop
- **Response**: `{ stopped: 1 }`
- **File**: Line 105

#### POST /executions/stopMany
- **Auth**: Required (workflow:execute scope)
- **Request**: ExecutionRequest.StopMany
  - `executionIds: string[]`
- **Response**: `{ stopped: number }`
- **File**: Line 121

#### POST /executions/:id/retry
- **Auth**: Required (workflow:execute scope)
- **Request**: ExecutionRequest.Retry
- **Response**: New ExecutionEntity
- **File**: Line 132

#### POST /executions/delete
- **Auth**: Required (workflow:execute scope)
- **Request**: ExecutionRequest.Delete
  - `executionIds?: string[]`
- **Response**: `{ count: number }`
- **File**: Line 141

#### PATCH /executions/:id
- **Auth**: Required
- **Request**: ExecutionRequest.Update
  - `annotation?: string` - Add annotation
  - `tags?: string[]` - Execution tags
- **Response**: Updated ExecutionEntity
- **File**: Line 150

---

### Credential Management

**Base Path**: `/api/v1/credentials`
**Controller**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/credentials/credentials.controller.ts

#### GET /credentials/
- **Auth**: Required (credential:read scope)
- **Query Params**: CredentialsGetManyRequestQuery
  - `limit?: number`
  - `offset?: number`
  - `includeScopes?: boolean`
  - `includeData?: boolean` - Include decrypted credential data
  - `onlySharedWithMe?: boolean`
  - `includeGlobal?: boolean`
  - `externalSecretsStore?: boolean`
- **Response**: Array of CredentialEntity
- **Middleware**: listQueryMiddleware
- **File**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/credentials/credentials.controller.ts:66

#### GET /credentials/for-workflow
- **Auth**: Required
- **Query Params**:
  - `workflowId?: string` OR
  - `projectId?: string`
- **Response**: Array of CredentialEntity usable in workflow
- **File**: Line 89

#### GET /credentials/new
- **Auth**: Required
- **Query Params**: `type?: string` - Credential type
- **Response**: `{ name: "Credential 1" }` - Auto-generated unique name
- **File**: Line 97

#### GET /credentials/:credentialId
- **Auth**: Required (credential:read scope)
- **Query Params**: CredentialsGetOneRequestQuery
  - `includeData?: boolean`
- **Response**: CredentialEntity with optional decrypted data
- **File**: Line 110

#### POST /credentials/test
- **Auth**: Required
- **Request**: CredentialRequest.Test
  - `credentials: ICredentialDataDecryptedObject`
  - `credentialType: string`
- **Response**: `{ status: 'OK' }` or error details
- **File**: Line 138

#### POST /credentials/
- **Auth**: Required
- **Request**: CreateCredentialDto
  - `name: string`
  - `type: string`
  - `data: ICredentialDataDecryptedObject` - Encrypted before storage
  - `projectId?: string`
- **Response**: CredentialEntity
- **Events**: `credential-created`
- **File**: Line 176

#### PATCH /credentials/:credentialId
- **Auth**: Required (credential:update scope)
- **Request**: UpdateCredentialDto
  - `name?: string`
  - `data?: ICredentialDataDecryptedObject`
- **Response**: Updated CredentialEntity
- **Events**: `credential-updated`
- **File**: Line 205

#### PUT /credentials/:credentialId
- **Auth**: Required (credential:update scope)
- **Request**: Full credential update (replace entire data)
- **Response**: Updated CredentialEntity
- **File**: Line ~230

#### DELETE /credentials/:credentialId
- **Auth**: Required (credential:delete scope)
- **Response**: `{ success: true }`
- **Events**: `credential-deleted`
- **File**: Line ~250

#### POST /credentials/:credentialId/share
- **Auth**: Required (Licensed: feat:sharing)
- **Request**: ShareCredentialDto
  - `shareWithIds: string[]`
- **Response**: Array of SharedCredentials
- **File**: Line ~270

---

### OAuth Callbacks

**OAuth1 Flow**:
- GET `/oauth1-credential/auth` - Get authorization URL
- GET `/oauth1-credential/callback?oauth_token=...&oauth_verifier=...&state=...` - Callback handler
- **File**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/controllers/oauth/oauth1-credential.controller.ts:23

**OAuth2 Flow**:
- GET `/oauth2-credential/auth` - Get authorization URL with PKCE support
- GET `/oauth2-credential/callback?code=...&state=...` - Callback handler
- **File**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/controllers/oauth/oauth2-credential.controller.ts:25

Both callbacks:
- **Auth**: skipAuthOnOAuthCallback (stateless via encrypted state param)
- **Response**: HTML page (renderOAuthCallback) or error page
- **Credential Update**: Decrypts and stores OAuth tokens automatically

---

### User Profile & Settings

**Base Path**: `/api/v1/me`
**Controller**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/controllers/me.controller.ts

#### PATCH /me/
- **Auth**: Required
- **Request**: UserUpdateRequestDto
  - `email?: string`
  - `firstName?: string`
  - `lastName?: string`
- **Response**: Updated PublicUser
- **Validation**: SSO users cannot change profile
- **File**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/controllers/me.controller.ts:44

#### POST /me/password
- **Auth**: Required
- **Request**: PasswordUpdateRequestDto
  - `currentPassword: string`
  - `newPassword: string` - Must meet passwordSchema requirements
- **Response**: `{ success: true }`
- **Events**: `user-password-updated`
- **File**: Line ~100

#### PATCH /me/settings
- **Auth**: Required
- **Request**: UserSelfSettingsUpdateRequestDto
  - `firstName?: string`
  - `lastName?: string`
  - `email?: string`
- **Response**: Updated user settings
- **File**: Line ~130

#### POST /me/personalization
- **Auth**: Required
- **Request**: PersonalizationSurveyAnswersV4
- **Response**: `{ success: true }`
- **Events**: `user-personalization-survey-submitted`
- **File**: Line ~160

---

### Projects (Team/Enterprise)

**Base Path**: `/api/v1/projects`
**Controller**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/controllers/project.controller.ts

#### GET /projects/
- **Auth**: Required
- **Response**: Array of Project
- **File**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/controllers/project.controller.ts:49

#### POST /projects/
- **Auth**: Required (project:create scope)
- **License**: feat:projectRole:admin
- **Request**: CreateProjectDto
  - `name: string`
  - `description?: string`
  - `uiContext?: string` - UI origin of creation
- **Response**: Project with `id`, `name`, `description`, `role` (project:admin)
- **Events**: `team-project-created`
- **File**: Line 59

#### PATCH /projects/:projectId
- **Auth**: Required (project:update scope)
- **Request**: UpdateProjectDto
- **Response**: Updated Project
- **File**: Line ~100

#### DELETE /projects/:projectId
- **Auth**: Required (project:delete scope)
- **Request**: DeleteProjectDto
- **Response**: `{ success: true }`
- **File**: Line ~120

#### POST /projects/:projectId/members
- **Auth**: Required (project:manage-members scope)
- **Request**: AddUsersToProjectDto
  - `userIds: string[]`
  - `role: string`
- **Response**: Array of added members
- **Events**: `project-members-added`
- **File**: Line ~140

#### PATCH /projects/:projectId/members/:userId
- **Auth**: Required (project:manage-members scope)
- **Request**: ChangeUserRoleInProject
  - `role: string` - project:admin, project:editor, project:viewer
- **Response**: Updated member
- **Events**: `project-member-role-updated`
- **File**: Line ~160

#### DELETE /projects/:projectId/members/:userId
- **Auth**: Required (project:manage-members scope)
- **Response**: `{ success: true }`
- **Events**: `project-member-removed`
- **File**: Line ~180

---

### API Keys (Public API)

**Base Path**: `/api/v1/api-keys`
**Controller**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/controllers/api-keys.controller.ts

#### POST /api-keys/
- **Auth**: Required (apiKey:manage global scope)
- **License**: Gated by API Key Scopes feature
- **Request**: CreateApiKeyRequestDto
  - `label: string`
  - `scopes: ApiKeyScope[]` - e.g., 'workflow:read', 'execution:list'
  - `expiresAt?: string` - ISO 8601 date
- **Response**:
  ```json
  {
    "id": "uuid",
    "label": "string",
    "rawApiKey": "string (only in response)",
    "apiKey": "***redacted***",
    "scopes": ["workflow:read"],
    "expiresAt": "ISO 8601 date"
  }
  ```
- **File**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/controllers/api-keys.controller.ts:43

#### GET /api-keys/
- **Auth**: Required (apiKey:manage scope)
- **Response**: Array of API key objects (all fields redacted except label)
- **File**: Line 74

#### PATCH /api-keys/:id
- **Auth**: Required (apiKey:manage scope)
- **Request**: UpdateApiKeyRequestDto
  - `label?: string`
  - `scopes?: ApiKeyScope[]`
  - `expiresAt?: string`
- **Response**: `{ success: true }`
- **File**: Line 97

#### DELETE /api-keys/:id
- **Auth**: Required (apiKey:manage scope)
- **Response**: `{ success: true }`
- **File**: Line 84

#### GET /api-keys/scopes
- **Auth**: Required (apiKey:manage scope)
- **Response**: Array of ApiKeyScope strings available for user's role
- **File**: Line 119

---

### Chat Hub (AI Chat Interface)

**Base Path**: `/api/v1/chat`
**Controller**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/modules/chat-hub/chat-hub.controller.ts

#### POST /chat/models
- **Auth**: Required (chatHub:message scope)
- **Request**: ChatModelsRequestDto
  - `credentials?: ICredentialDataDecryptedObject` - Optional override credentials
- **Response**: ChatModelsResponse
  - Array of available LLM models
- **File**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/modules/chat-hub/chat-hub.controller.ts:58

#### GET /chat/conversations
- **Auth**: Required (chatHub:message scope)
- **Query Params**: ChatHubConversationsRequest
  - `limit?: number` - Default 50
  - `cursor?: string` - Pagination cursor
- **Response**: ChatHubConversationsResponse
  - Array of ChatHubSessionDto with summary
- **File**: Line 68

#### GET /chat/conversations/:sessionId
- **Auth**: Required (chatHub:message scope)
- **Response**: ChatHubConversationResponse
  - Full conversation with all messages
- **File**: Line 78

#### GET /chat/conversations/:sessionId/messages/:messageId/attachments/:index
- **Auth**: Required (chatHub:message scope)
- **Response**: Binary attachment data (mime type from ViewableMimeTypes)
- **File**: Line 88

#### POST /chat/conversations/:sessionId/messages
- **Auth**: Required (chatHub:message scope)
- **Request**: ChatHubSendMessageRequest
  - `message: string`
  - `attachments?: ChatAttachment[]`
  - `agentId?: string`
- **Response**: ChatSendMessageResponse
  - Streaming server-sent events with message updates
- **File**: Line ~110

#### POST /chat/conversations/:sessionId/messages/:messageId/regenerate
- **Auth**: Required (chatHub:message scope)
- **Request**: ChatHubRegenerateMessageRequest
- **Response**: ChatSendMessageResponse (streaming)
- **File**: Line ~130

#### PATCH /chat/conversations/:sessionId/messages/:messageId
- **Auth**: Required (chatHub:message scope)
- **Request**: ChatHubEditMessageRequest
  - `message: string`
- **Response**: ChatSendMessageResponse (streaming)
- **File**: Line ~150

#### PATCH /chat/conversations/:sessionId
- **Auth**: Required (chatHub:message scope)
- **Request**: ChatHubUpdateConversationRequest
  - `title?: string`
- **Response**: ChatHubConversationResponse
- **File**: Line ~170

#### DELETE /chat/conversations/:sessionId
- **Auth**: Required (chatHub:message scope)
- **Response**: `{ success: true }`
- **File**: Line ~180

#### GET /chat/agents
- **Auth**: Required (chatHub:agent scope)
- **Response**: Array of ChatHubAgentDto
- **File**: Line ~200

#### POST /chat/agents
- **Auth**: Required (chatHub:agent scope)
- **License**: feat:chatHub:agents
- **Request**: ChatHubCreateAgentRequest
  - `name: string`
  - `description?: string`
  - `icon?: string`
  - `tools?: ChatHubToolDto[]`
- **Response**: Created ChatHubAgentDto
- **File**: Line ~210

#### PATCH /chat/agents/:agentId
- **Auth**: Required (chatHub:agent scope)
- **Request**: ChatHubUpdateAgentRequest
- **Response**: Updated ChatHubAgentDto
- **File**: Line ~225

#### DELETE /chat/agents/:agentId
- **Auth**: Required (chatHub:agent scope)
- **Response**: `{ success: true }`
- **File**: Line ~235

---

### Webhooks Discovery

**Base Path**: `/api/v1/webhooks`
**Controller**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/webhooks/webhooks.controller.ts

#### POST /webhooks/find
- **Auth**: Internal (used by webhook router)
- **Request**:
  ```json
  {
    "path": "string",
    "method": "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS"
  }
  ```
- **Response**: Webhook details or null if not found
- **File**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/webhooks/webhooks.controller.ts:12

---

### Webhook Entry Points (Dynamic)

These are not traditional routes but dynamically matched endpoints:

**Live Webhooks**:
- **Path**: `/{webhookEndpoint}/*path` (configurable, default: `webhook`)
- **Methods**: ALL (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
- **Auth**: None (webhook validation via secret)
- **Flow**:
  1. Request matches webhook by method + path
  2. Triggers workflow if active
  3. Returns workflow response
- **Request Body**: JSON or form data passed to workflow
- **Response**: Workflow output or webhook response

**Test Webhooks**:
- **Path**: `/{webhookTestEndpoint}/*path` (configurable, default: `webhook-test`)
- **Methods**: ALL
- **Purpose**: Test webhook execution before activation
- **Request**: Same as live webhooks
- **Response**: Execution result

**Waiting Webhooks**:
- **Path**: `/{webhookWaitingEndpoint}/:path{/:suffix}` (configurable, default: `webhook-waiting`)
- **Purpose**: Resume workflow execution on external callback
- **Request Body**: Data to pass back to workflow

**Forms**:
- **Path**: `/{formEndpoint}/*path` (configurable, default: `form`)
- **Methods**: ALL
- **Purpose**: Public form submission webhook
- **Response**: Form submission acknowledgment or custom response

**Waiting Forms**:
- **Path**: `/{formWaitingEndpoint}/:path{/:suffix}` (configurable, default: `form-waiting`)
- **Purpose**: Resume workflow after form response

**MCP (Model Context Protocol) Servers**:
- **Path**: `/{mcpEndpoint}/*path` (configurable, default: `mcp`)
- **Methods**: ALL
- **Purpose**: External MCP server integration

**Handler**: createWebhookHandlerFor()
- **File**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/abstract-server.ts:225

---

## WebSocket / Server-Sent Events

### Push Channel (Bidirectional WebSocket)

**Endpoint**: `/{restEndpoint}/push`
**Handler**: WebSocketPush / Push service
**File**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/push/websocket.push.ts

#### Connection
- **Auth**: Required (JWT cookie or URL query param)
- **Query Params**: `pushRef=<clientId>` - Unique client reference ID
- **Protocol**: WebSocket with JSON frames

#### Client → Server Messages

**Heartbeat** (client-initiated):
```json
{
  "type": "heartbeat"
}
```
- **Purpose**: Keep connection alive, detect stale connections
- **Schema**: heartbeatMessageSchema
- **File**: /Users/ib/prj-other/n0n/n8n/packages/@n8n/api-types/src/push/heartbeat.ts

#### Server → Client Messages (Push Types)

All messages follow the pattern:
```json
{
  "type": "<PushType>",
  "data": { ... }
}
```

**Execution Events** (ExecutionPushMessage):
- **executionStarted** - Workflow execution begins
  ```json
  {
    "type": "executionStarted",
    "data": {
      "executionId": "string",
      "mode": "manual|webhook|ui|trigger",
      "startedAt": "ISO 8601",
      "workflowId": "string",
      "workflowName": "string",
      "retryOf": "execution_id",
      "flattedRunData": "JSON string"
    }
  }
  ```

- **executionWaiting** - Execution paused waiting for response
  ```json
  {
    "type": "executionWaiting",
    "data": {
      "executionId": "string"
    }
  }
  ```

- **executionFinished** - Execution completed
  ```json
  {
    "type": "executionFinished",
    "data": {
      "executionId": "string",
      "workflowId": "string",
      "status": "success|error|running|waiting"
    }
  }
  ```

- **executionRecovered** - Execution recovered from crash
  ```json
  {
    "type": "executionRecovered",
    "data": {
      "executionId": "string"
    }
  }
  ```

- **nodeExecuteBefore** - Before node execution
  ```json
  {
    "type": "nodeExecuteBefore",
    "data": {
      "executionId": "string",
      "nodeName": "string",
      "data": { "code": 0 }
    }
  }
  ```

- **nodeExecuteAfter** - After node execution (metadata only)
  ```json
  {
    "type": "nodeExecuteAfter",
    "data": {
      "executionId": "string",
      "nodeName": "string",
      "data": { "code": 0, "startTime": number, "executionTime": number },
      "itemCountByConnectionType": { "main": [5] }
    }
  }
  ```

- **nodeExecuteAfterData** - Node output data
  ```json
  {
    "type": "nodeExecuteAfterData",
    "data": {
      "executionId": "string",
      "nodeName": "string",
      "data": { "main": [[{ ... }]] },
      "itemCountByConnectionType": { "main": [5] }
    }
  }
  ```

**File**: /Users/ib/prj-other/n0n/n8n/packages/@n8n/api-types/src/push/execution.ts

---

**Workflow Events** (WorkflowPushMessage):

- **workflowActivated** - Workflow activated/published
  ```json
  {
    "type": "workflowActivated",
    "data": {
      "workflowId": "string",
      "activeVersionId": "string"
    }
  }
  ```

- **workflowFailedToActivate** - Activation failed
  ```json
  {
    "type": "workflowFailedToActivate",
    "data": {
      "workflowId": "string",
      "errorMessage": "string"
    }
  }
  ```

- **workflowDeactivated** - Workflow deactivated/unpublished
  ```json
  {
    "type": "workflowDeactivated",
    "data": {
      "workflowId": "string"
    }
  }
  ```

- **workflowAutoDeactivated** - Auto-deactivated (e.g., due to errors)
  ```json
  {
    "type": "workflowAutoDeactivated",
    "data": {
      "workflowId": "string"
    }
  }
  ```

- **workflowUpdated** - Workflow definition changed
  ```json
  {
    "type": "workflowUpdated",
    "data": {
      "workflowId": "string",
      "userId": "string"
    }
  }
  ```

**File**: /Users/ib/prj-other/n0n/n8n/packages/@n8n/api-types/src/push/workflow.ts

---

**Collaboration Events** (CollaborationPushMessage):

- **collaboratorsChanged** - Users editing workflow changed
  ```json
  {
    "type": "collaboratorsChanged",
    "data": {
      "workflowId": "string",
      "collaborators": [
        {
          "user": { "id": "string", "email": "string", "firstName": "string", "lastName": "string" },
          "lastSeen": "ISO 8601"
        }
      ]
    }
  }
  ```

- **writeAccessAcquired** - User gained write lock
  ```json
  {
    "type": "writeAccessAcquired",
    "data": {
      "workflowId": "string",
      "userId": "string",
      "clientId": "string"
    }
  }
  ```

- **writeAccessReleased** - User released write lock
  ```json
  {
    "type": "writeAccessReleased",
    "data": {
      "workflowId": "string"
    }
  }
  ```

**File**: /Users/ib/prj-other/n0n/n8n/packages/@n8n/api-types/src/push/collaboration.ts

---

**Webhook Events** (WebhookPushMessage):

- **webhookDeleted** - Webhook removed
  ```json
  {
    "type": "webhookDeleted",
    "data": {
      "workflowId": "string"
    }
  }
  ```

- **webhookTestRequest** - Test webhook received
  ```json
  {
    "type": "webhookTestRequest",
    "data": { ... }
  }
  ```

**File**: /Users/ib/prj-other/n0n/n8n/packages/@n8n/api-types/src/push/webhook.ts

---

**Hot Reload** (HotReloadPushMessage):

- **nodeDescriptionUpdated** - Node definitions changed
  ```json
  {
    "type": "nodeDescriptionUpdated",
    "data": {}
  }
  ```

**File**: /Users/ib/prj-other/n0n/n8n/packages/@n8n/api-types/src/push/hot-reload.ts

---

**Chat Hub Events** (ChatHubPushMessage):

- **chatHubStreamEvent** - LLM response streaming
  ```json
  {
    "type": "chatHubStreamEvent",
    "data": {
      "sessionId": "string",
      "messageId": "string",
      "event": { "type": "begin|chunk|end|error", "content": "..." }
    }
  }
  ```

- **chatHubExecutionEvent** - Chat execution status
  ```json
  {
    "type": "chatHubExecutionEvent",
    "data": {
      "sessionId": "string",
      "messageId": "string",
      "event": { ... }
    }
  }
  ```

- **chatHubHumanMessageCreated** - User sent message
- **chatHubMessageEdited** - Message edited

**File**: /Users/ib/prj-other/n0n/n8n/packages/@n8n/api-types/src/push/chat-hub.ts

---

**Worker Status** (SendWorkerStatusMessage):

- **sendWorkerStatusMessage** - Worker availability update
  ```json
  {
    "type": "sendWorkerStatusMessage",
    "data": {
      "isWorkerAvailable": boolean,
      "workerId": "string"
    }
  }
  ```

**File**: /Users/ib/prj-other/n0n/n8n/packages/@n8n/api-types/src/push/worker.ts

---

**Builder Credits** (BuilderCreditsPushMessage):

- **builderCreditsUpdated** - Builder credits changed
  ```json
  {
    "type": "builderCreditsUpdated",
    "data": {
      "creditsRemaining": number,
      "creditsUsed": number
    }
  }
  ```

**File**: /Users/ib/prj-other/n0n/n8n/packages/@n8n/api-types/src/push/builder-credits.ts

---

**Debug Events** (DebugPushMessage):

- **debugMessage** - Internal debug information (dev only)
  ```json
  {
    "type": "debugMessage",
    "data": { ... }
  }
  ```

**File**: /Users/ib/prj-other/n0n/n8n/packages/@n8n/api-types/src/push/debug.ts

---

**Meta Events**:

- **heartbeat** - Server-initiated keep-alive (protocol level)
  - Sent by server every 60 seconds
  - Client responds with `pong` frame
  - File: /Users/ib/prj-other/n0n/n8n/packages/cli/src/push/websocket.push.ts:75

---

### Connection Lifecycle

1. **Client connects** with `pushRef` (unique session ID)
2. **Server validates** authentication
3. **Server sends** initial state/cached messages
4. **Bidirectional flow** of messages
5. **Client heartbeat** every N seconds (application-level JSON)
6. **Server ping** every 60 seconds (protocol-level)
7. **Client disconnects** → server cleans up session

**Connection State**: Stored in memory per `pushRef`, synced across workers via pub/sub (Redis)

---

## Middleware Stack

The Express middleware stack executes in this order:

### 1. Global Middleware (all routes)

1. **Helmet** - Security headers (CSP, X-Frame-Options, etc.)
   - File: /Users/ib/prj-other/n0n/n8n/packages/cli/src/server.ts:371
   - Configurable CSP directives per security config

2. **Compression** - Gzip response compression
   - File: /Users/ib/prj-other/n0n/n8n/packages/cli/src/abstract-server.ts:117

3. **Raw Body Reader** - Capture raw request body for webhooks
   - File: /Users/ib/prj-other/n0n/n8n/packages/cli/src/middlewares

4. **Cookie Parser** - Parse JWT auth cookies
   - File: /Users/ib/prj-other/n0n/n8n/packages/cli/src/server.ts:6

5. **CORS Middleware** - Cross-origin handling (dev only)
   - File: /Users/ib/prj-other/n0n/n8n/packages/cli/src/abstract-server.ts:124

### 2. Path-Specific Middleware

**Webhook Paths** (`/webhook/*`, `/form/*`, `/mcp/*`, etc.):
- **createWebhookHandlerFor()** - Routes request to live/test/waiting webhook handler
- **No authentication** - Webhook validation via secret in path

**Health Check** (`/health`, `/health/readiness`):
- DB connection check
- No other middleware

### 3. Route-Level Middleware (per controller method)

**Authentication Middleware**:
- **Default**: Required (all routes)
- **Opts**: `skipAuth: true` - No auth required (login, signup)
- **Opts**: `allowUnauthenticated: true` - Optional auth
- **Opts**: `allowSkipMFA: true` - MFA not enforced
- Validates JWT cookie + browser ID check
- File: /Users/ib/prj-other/n0n/n8n/packages/cli/src/auth/auth.service.ts:96

**Rate Limiting**:
- **IP-based**: General request rate limit
- **Keyed-based**: Per-email rate limit for login (5/min)
- File: /Users/ib/prj-other/n0n/n8n/packages/@n8n/decorators/src/controller/rate-limit.ts

**Scope Authorization**:
- **@GlobalScope('scope:action')** - Global permission check
- **@ProjectScope('scope:action')** - Project-scoped permission
- Checks user.scopes or role-based access
- File: /Users/ib/prj-other/n0n/n8n/packages/@n8n/decorators/src/controller/scoped.ts

**List Query Middleware**:
- Parses pagination, filtering, sorting parameters
- Sets `req.listQueryOptions` on request
- File: /Users/ib/prj-other/n0n/n8n/packages/cli/src/middlewares

**Licensed Middleware**:
- **@Licensed('feat:sharing')** - Feature flag check
- Returns 403 if not licensed
- File: /Users/ib/prj-other/n0n/n8n/packages/@n8n/decorators/src/controller/licensed.ts

### 4. Body Parsing (applied after webhooks)

- **JSON Parser** - Parse `Content-Type: application/json`
- **Form Parser** - Parse `multipart/form-data`
- **Limits**: Configurable body size limit
- File: /Users/ib/prj-other/n0n/n8n/packages/cli/src/abstract-server.ts:285

### 5. Error Handling

**Express Error Handler** (Sentry integration):
- Catches all thrown errors
- Converts ResponseError → HTTP response
- File: /Users/ib/prj-other/n0n/n8n/packages/cli/src/abstract-server.ts:107

**Custom Error Handler**:
- Maps errors to appropriate HTTP status codes
- Includes hint message for debugging
- File: ResponseHelper.sendErrorResponse()

---

## Error Response Format

All errors follow this structure:

```json
{
  "message": "Human-readable error message",
  "code": 404,
  "hint": "Additional debugging hint (optional)",
  "meta": {
    "customField": "value"
  }
}
```

### HTTP Status Codes & Errors

| Code | Class | Example |
|------|-------|---------|
| 400 | BadRequestError | Invalid workflow syntax |
| 401 | AuthError | Invalid credentials / MFA error |
| 403 | ForbiddenError | Insufficient permissions |
| 404 | NotFoundError | Workflow not found |
| 409 | ConflictError | Duplicate resource |
| 413 | ContentTooLargeError | Request body too large |
| 423 | LockedError | Resource locked by another user |
| 429 | TooManyRequestsError | Rate limit exceeded |
| 500 | InternalServerError | Server error |
| 501 | NotImplementedError | Feature not implemented |
| 503 | ServiceUnavailableError | Database unavailable |

**File**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/errors/response-errors/

---

## Authentication Flow

### Session-Based (JWT Cookies)

1. **POST /auth/login** with email + password
2. Server validates credentials against user table
3. Creates JWT token:
   ```json
   {
     "id": "userId",
     "hash": "bcrypt(email + password)",
     "browserId": "unique client ID",
     "usedMfa": false,
     "exp": "timestamp + 7 days"
   }
   ```
4. Sets HttpOnly cookie: `n8n-auth=<jwt>`
5. Cookie sent with every request for authentication

**JWT Service**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/services/jwt.service.ts

### API Key Authentication (Public API)

1. **POST /api-keys/** to create API key
2. Returns one-time readable `rawApiKey`
3. Client uses: `Authorization: Bearer <apiKey>` header
4. Server looks up API key in database
5. Verifies scopes against endpoint permissions

**Public API Key Service**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/services/public-api-key.service.ts

### OAuth2/OAuth1 (Third-party Credentials)

1. **GET /oauth2-credential/auth** - Get authorization URL
2. Client redirects to provider (Google, GitHub, etc.)
3. Provider redirects to **GET /oauth2-credential/callback?code=...&state=...**
4. Server exchanges code for token via provider API
5. Server encrypts token + stores in credentials table
6. Token retrieved on-demand during workflow execution

**OAuth Service**: /Users/ib/prj-other/n0n/n8n/packages/cli/src/oauth/oauth.service.ts

---

## API Versioning & Design Patterns

### REST API Version
- **Current**: v1 (`/api/v1/...`)
- **Base path**: Configurable via `N8N_API_ENDPOINTS_REST` (default: `api/v1`)

### Public API Version
- **Current**: v1 (`/api/v1/...`)
- **OpenAPI Spec**: Validated via express-openapi-validator
- **Handlers**: Directory-based routing in `/public-api/v1/handlers/**/*`
- **Spec File**: OpenAPI YAML (lazy-loaded)

### Pagination

```json
GET /api/v1/workflows?limit=20&offset=0

Response:
{
  "data": [...],
  "count": 100,
  "total": 100,
  "limit": 20,
  "offset": 0
}
```

### Filtering

```json
GET /api/v1/workflows?filter[name]=my-workflow&filter[tags]=important

Query Parameter: filter[key]=value
```

### Sorting

```json
GET /api/v1/workflows?sort=name:asc,createdAt:desc

Query Parameter: sort=field1:direction,field2:direction
```

### Batch Operations

```json
POST /api/v1/executions/stopMany
{
  "executionIds": ["id1", "id2", "id3"]
}

POST /api/v1/executions/delete
{
  "executionIds": ["id1", "id2"]
}
```

---

## Scope-Based Authorization

### Global Scopes
- `project:create` - Create team projects
- `project:read` - View team projects
- `project:update` - Edit team projects
- `project:delete` - Delete team projects
- `workflow:read` - List all workflows
- `workflow:create` - Create workflows
- `credential:read` - List all credentials
- `apiKey:manage` - Create/manage API keys
- `chatHub:message` - Send chat messages
- `chatHub:agent` - Create chat agents

### Project Scopes
- `workflow:read` - View workflow in project
- `workflow:create` - Create workflow in project
- `workflow:update` - Edit workflow
- `workflow:delete` - Delete workflow
- `workflow:execute` - Run workflow
- `workflow:publish` - Activate workflow
- `workflow:unpublish` - Deactivate workflow
- `workflow:move` - Transfer to another project
- `credential:read` - View credentials in project
- `credential:create` - Create credentials
- `credential:update` - Edit credentials
- `credential:delete` - Delete credentials

### Roles & Scope Assignment
- **Global Owner** - All global scopes
- **Global Admin** - Most global scopes (no invite/project:create on unlicensed)
- **Global Member** - Limited read-only scopes
- **Project Admin** - All project scopes
- **Project Editor** - Edit + execute scopes
- **Project Viewer** - Read-only scopes

---

## Key API Files

| File | Purpose | Why It Matters |
|------|---------|----------------|
| `/packages/cli/src/server.ts:1-200` | Main Express app setup + controller registration | Entry point for all HTTP routing; loads all controllers dynamically |
| `/packages/cli/src/abstract-server.ts:1-300` | Base server class with middleware stack | Defines webhook paths, health checks, global middleware order |
| `/packages/cli/src/controllers/auth.controller.ts` | Login, logout, session management | Core auth flow for web UI + API cookie validation |
| `/packages/cli/src/workflows/workflows.controller.ts` | Workflow CRUD + activation/execution | Main workflow management API surface |
| `/packages/cli/src/executions/executions.controller.ts` | Execution listing, stopping, retry | Execution monitoring and control API |
| `/packages/cli/src/credentials/credentials.controller.ts` | Credential CRUD + encryption/decryption | Secure credential management; handles data encryption before storage |
| `/packages/cli/src/controllers/api-keys.controller.ts` | Public API key management | API key generation and scope validation for external integrations |
| `/packages/cli/src/auth/auth.service.ts:96-200` | Auth middleware creation + JWT validation | Cookie + JWT token validation; browser ID check for session hijacking prevention |
| `/packages/cli/src/push/websocket.push.ts` | WebSocket connection handler | Bidirectional push event streaming; heartbeat management |
| `/packages/@n8n/api-types/src/push/*.ts` | Push event type definitions | Defines all server→client message shapes for real-time updates |
| `/packages/@n8n/api-types/src/dto/**/*.ts` | Request/response DTOs | Type-safe endpoint contracts; defines all request/response shapes |
| `/packages/cli/src/controllers/oauth/oauth2-credential.controller.ts` | OAuth2 flow (auth + callback) | Handles OAuth2 authorization code exchange and token storage |
| `/packages/cli/src/controllers/oauth/oauth1-credential.controller.ts` | OAuth1 flow (auth + callback) | Handles OAuth1 3-leg auth flow and token storage |
| `/packages/cli/src/modules/chat-hub/chat-hub.controller.ts` | Chat API endpoints + streaming | AI chat interface; server-sent events for LLM streaming |
| `/packages/@n8n/decorators/src/controller/` | Controller/route decorator implementation | Defines @RestController, @Get/@Post/@Patch/@Delete decorators; scope + license middleware |
| `/packages/cli/src/public-api/index.ts` | Public API setup + OpenAPI validation | Lazy-loads OpenAPI spec + applies request/response validation |
| `/packages/cli/src/webhooks/webhooks.controller.ts` | Webhook discovery endpoint | Finds webhook definition by path + method for routing |
| `/packages/cli/src/middlewares` | Auth, rate limiting, list query parsing | Core middleware implementations for pagination, filtering, auth |
| `/packages/cli/src/errors/response-errors/` | Error hierarchy (21 error types) | Consistent error response format; all errors extend ResponseError |
| `/packages/@n8n/permissions/src` | Scope + role definitions | Role-based access control; scope combination logic |

---

## Integration Points

### Outbound HTTP
- **OAuth providers** - GET/POST to Google, GitHub, Azure, etc. for token exchange
- **Webhook notifications** - POST to external systems with execution results
- **Node integrations** - HTTP nodes make requests to external APIs during workflow execution

### Database
- PostgreSQL / SQLite for all persistent state
- TypeORM entities: User, Workflow, Execution, Credential, etc.

### Message Queue
- BullMQ (Redis) for async job processing
- Queue name: `n8n-executions` (no colons allowed in BullMQ queue names)

### Pub/Sub (Multi-instance)
- Redis for cross-worker push events
- Pub/sub topic: execution updates, workflow events, push notifications

### External Services
- **Sentry** - Error reporting
- **PostHog** - Feature flags + analytics
- **Auth Providers** - LDAP, SAML, OIDC, OAuth2

---

## Security Considerations

### CORS
- Configured per environment (dev: all origins, prod: specific origins)
- Controlled by security config

### CSRF Protection
- N/A for API (stateless token-based)
- Form endpoints use state parameter for OAuth redirect security

### Rate Limiting
- Login endpoint: 5 requests/min per email (prevents brute force)
- General API: IP-based limit (configurable)
- Implemented via express-rate-limit

### Body Size Limits
- JSON: 50MB default
- Form: 50MB default
- Configurable per security settings

### Headers
- **X-Powered-By**: Disabled (Helmet)
- **CSP**: Content Security Policy (configurable directives)
- **HSTS**: Strict-Transport-Security (Helmet)
- **X-Frame-Options**: DENY (Helmet)

### Credential Encryption
- AES-256-GCM encryption
- Master key: Loaded from `N8N_ENCRYPTION_KEY` or auto-generated
- Decrypted only when needed for execution

### Browser ID Check
- Unique ID generated per browser session
- Sent with JWT to prevent session hijacking
- Exempted endpoints: `/push`, `/binary-data/`, OAuth callbacks, types endpoints

---

## Testing Entry Points

### Public API
- **Swagger UI**: `/{publicApiEndpoint}/{version}/docs`
- **OpenAPI Spec**: YAML file lazy-loaded + validated
- **Request validation**: express-openapi-validator (runtime)

### Health Check
- **Status**: GET `/health` → `{ status: 'ok' }`
- **Readiness**: GET `/health/readiness` → DB connected + migrated check

### Manual Testing
- Use Postman/curl with cookie: `Cookie: n8n-auth=<jwt>`
- Or API key header: `Authorization: Bearer <api-key>`

