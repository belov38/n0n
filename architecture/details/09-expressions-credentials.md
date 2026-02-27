# n8n: Expression Engine and Credential Management

Deep technical analysis of two cross-cutting systems in the n8n codebase: the expression/templating engine that allows users to reference runtime data in node parameters, and the credential management system that securely stores and injects API keys and secrets.

---

## Part A: Expression Engine

### Syntax

Expressions are ordinary parameter values that begin with the `=` character. The rest of the value is a JavaScript expression fragment. When displayed in the UI it is typically written inside double curly braces for readability in template strings, but the actual wire format is always the `=` prefix.

```
=                    → sentinel character marking an expression
={{ $json.name }}    → template-like display form (the `=` + `{{ ... }}` is common in docs)
=$json.name          → equivalent bare form
```

Detection is a simple character check performed in `isExpression`:

```typescript
// packages/workflow/src/expressions/expression-helpers.ts:5
export const isExpression = (expr: unknown): expr is string => {
  if (typeof expr !== 'string') return false;
  return expr.charAt(0) === '=';
};
```

After detection the leading `=` is stripped and the remainder is passed to the expression evaluator as a JavaScript expression.

Inside credentials the same syntax applies but with `$credentials` as the context variable:

```
=https://{{$credentials.subdomain}}.wufoo.com
={{$credentials.apiKey}}
```

### Evaluation Engine: Tournament

The core evaluator is the `@n8n/tournament` package — an AST-based JS expression runner. It is not `eval`. Tournament parses the expression into an AST, applies security hooks (before and after), and then evaluates the transformed AST inside a controlled scope.

**Entry point** — `packages/workflow/src/expression-evaluator-proxy.ts`:

```typescript
// /Users/ib/prj-other/n0n/n8n/packages/workflow/src/expression-evaluator-proxy.ts:1-21
import { Tournament } from '@n8n/tournament';
import { DollarSignValidator, ThisSanitizer, PrototypeSanitizer } from './expression-sandboxing';

const tournamentEvaluator = new Tournament(errorHandler, undefined, undefined, {
  before: [ThisSanitizer],
  after: [PrototypeSanitizer, DollarSignValidator],
});

export const evaluateExpression: Evaluator = (expr, data) => {
  return evaluator(expr, data);
};
```

**High-level call chain:**

```
node parameter string starting with "="
  → WorkflowExpression.resolveSimpleParameterValue()      [workflow-expression.ts:30]
    → WorkflowDataProxy.getDataProxy()                    [workflow-data-proxy.ts:759]
    → Expression.resolveSimpleParameterValue()            [expression.ts:354]
      → extendSyntax(parameterValue)                      [expression-extension.ts]  (rewrite extension calls)
      → evaluateExpression(extendedExpression, data)      [expression-evaluator-proxy.ts:19]
        → Tournament.execute()                            [@n8n/tournament]
```

### Security Model

Security operates at two levels: AST transformation and runtime context denylisting.

**AST-level hooks** (`/Users/ib/prj-other/n0n/n8n/packages/workflow/src/expression-sandboxing.ts`):

| Hook | Direction | Purpose |
|------|-----------|---------|
| `ThisSanitizer` | Before eval | Rewrites `this` references to a safe empty-context object `{ process: {} }`. Wraps IIFEs with `.call(safeCtx)` and callbacks with `.bind(safeCtx)` to prevent arrow functions inheriting the Node.js global. |
| `PrototypeSanitizer` | After AST transform | Blocks dangerous property accesses: `__proto__`, `prototype`, `constructor`, etc. via `isSafeObjectProperty`. Blocks class extension from `Function`, `GeneratorFunction`, `AsyncFunction`. Blocks `with` statements. Wraps dynamic computed property access with `__sanitize()`. |
| `DollarSignValidator` | After AST transform | Ensures `$` is only used as a call (`$(...)`) not as a bare identifier or object access (`$.something`). |

**Runtime context denylisting** (`/Users/ib/prj-other/n0n/n8n/packages/workflow/src/expression.ts:174-301`, `Expression.initializeGlobalContext`):

The data proxy passed to `evaluateExpression` is mutated before evaluation. Dangerous globals are set to `{}` (an empty object that has no methods), blocking their use:

- `eval`, `Function`, `uneval` — blocks code generation
- `setTimeout`, `setInterval` — blocks async escape
- `fetch`, `XMLHttpRequest` — blocks network requests
- `Promise`, `Generator`, `AsyncFunction`, `AsyncGenerator`, `AsyncGeneratorFunction` — blocks control-flow abstraction
- `WebAssembly` — blocks WASM execution
- `Reflect`, `Proxy` — blocks meta-programming
- `document`, `window`, `global`, `globalThis`, `self` — blocks DOM/global access
- `alert`, `prompt`, `confirm` — blocks UI
- `escape`, `unescape` — deprecated globals

Safe globals are explicitly whitelisted: `Date`, `DateTime`, `Interval`, `Duration`, `Math`, `Number`, `String`, `RegExp`, `JSON`, `Array`, typed arrays, `Map`, `Set`, `WeakMap`, `WeakSet`, `Intl`, `Symbol`, `Boolean`, `BigInt`, standard encode/decode functions.

Error classes use safe proxies that remove `captureStackTrace` and `prepareStackTrace` (which would allow V8 stack-trace API abuse as a sandbox-escape vector):

```typescript
// expression.ts:124-143
const createSafeError = (): typeof Error => {
  return new Proxy(Error, {
    get(target, prop, receiver) {
      if (blockedErrorProperties.has(prop as string)) return undefined;
      return Reflect.get(target, prop, receiver);
    },
    set() { return false; },
    defineProperty() { return false; },
  });
};
```

Object is also wrapped to block `defineProperty`, `defineProperties`, `setPrototypeOf`, `getOwnPropertyDescriptor(s)`, `__defineGetter__`, `__defineSetter__`:

```typescript
// expression.ts:53-96
const createSafeObject = (): typeof Object => { ... };
```

`.constructor` access in the raw expression string is explicitly blocked via a regex check before evaluation:

```typescript
// expression.ts:399-406
const constructorValidation = new RegExp(/\.\s*constructor/gm);
if (parameterValue.match(constructorValidation)) {
  throw new ExpressionError('Expression contains invalid constructor function call', ...);
}
```

**`process.env` access** is controlled via the `N8N_BLOCK_ENV_ACCESS_IN_NODE` environment variable:

```typescript
// expression.ts:371-383
data.process = typeof process !== 'undefined'
  ? {
      arch: process.arch,
      env: process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE !== 'false' ? {} : process.env,
      ...
    }
  : {};
```

The default blocks env access (`N8N_BLOCK_ENV_ACCESS_IN_NODE !== 'false'` is true unless the var equals the string `'false'`). The `$env` proxy in `WorkflowDataProxy` adds a second independent guard:

```typescript
// workflow-data-proxy-env-provider.ts:15-19
const isEnvAccessBlocked = isProcessAvailable
  ? process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE !== 'false'
  : false;
```

### Context Variables Available in Expressions

The `WorkflowDataProxy.getDataProxy()` method (`/Users/ib/prj-other/n0n/n8n/packages/workflow/src/workflow-data-proxy.ts:759`) constructs the data object that becomes the expression scope. All properties on this object are accessible as top-level identifiers inside expressions.

| Variable | Type | Description |
|----------|------|-------------|
| `$json` | `IDataObject` | JSON data of the current input item (`connectionInputData[itemIndex].json`). Alias: `$data`. |
| `$binary` | `object` | Binary metadata of the current input item (not the raw data bytes). Keys correspond to binary attachment names. |
| `$input` | `ProxyInput` | Methods to access the current node's input: `.item`, `.first()`, `.last()`, `.all()`, `.context`, `.params`. |
| `$("NodeName")` | `Proxy` | Access data from a specific named node. Returns object with `.first()`, `.last()`, `.all()`, `.pairedItem()`, `.itemMatching()`, `.item`, `.isExecuted`, `.context`, `.params`. |
| `$node` | `Proxy` | Map of all nodes by name. `$node["NodeName"].json`, `.binary`, `.context`, `.parameter`, `.runIndex`. |
| `$parameter` | `Proxy` | Parameters of the active node (with expression resolution). |
| `$rawParameter` | `Proxy` | Parameters of the active node (raw, without expression resolution). |
| `$prevNode` | `Proxy` | Previous node information: `.name`, `.outputIndex`, `.runIndex`. |
| `$workflow` | `Proxy` | Current workflow metadata: `.active`, `.id`, `.name`. |
| `$execution` | `object` | Execution metadata: `.id`, `.mode`, `.resumeUrl`, `.resumeFormUrl`, `.customData.set/get`. |
| `$env` | `Proxy` | Environment variables (blocked by default via `N8N_BLOCK_ENV_ACCESS_IN_NODE`). |
| `$vars` | `object` | Static workflow variables defined in n8n settings. |
| `$secrets` | `Proxy` | External secrets proxy (only available when credential owner is admin/owner). Access pattern: `$secrets.providerName.secretName`. |
| `$runIndex` | `number` | Current run index (loop iteration). |
| `$itemIndex` | `number` | Current item index within the run. |
| `$mode` | `WorkflowExecuteMode` | Execution mode string (e.g., `'manual'`, `'webhook'`, `'trigger'`). |
| `$now` | `DateTime` | Current Luxon DateTime. |
| `$today` | `DateTime` | Midnight of today as Luxon DateTime. |
| `$jmesPath($jmespath)` | `function` | JMESPath query on a data object. Deprecated alias also available. |
| `$item(index, runIndex?)` | `function` | Legacy. Returns WorkflowDataProxy for a different item index. |
| `$items(nodeName?, output?, run?)` | `function` | Legacy. Returns execution data array. |
| `$fromAI(key, desc?, type?, default?)` | `function` | AI-injected parameter values (used in AI agent tool nodes). |
| `$evaluateExpression(expr, itemIndex?)` | `function` | Evaluate a sub-expression programmatically. |
| `$self` | `Proxy` | Self-data (used in sub-workflow / looping scenarios). |
| `$agentInfo` | `object` | Agent tool configuration info (only on LangChain Agent nodes). |
| `$nodeId` | `string` | UUID of the current node. |
| `$nodeVersion` | `number` | Type version of the current node. |
| `$webhookId` | `string` | Webhook ID of the current node (if applicable). |
| `DateTime`, `Interval`, `Duration` | Luxon classes | Date/time utilities from the Luxon library. |

**Additional context injected via `getAdditionalKeys`** (`/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/node-execution-context/utils/get-additional-keys.ts:20`):

These are merged into the data proxy via `that.additionalKeys` at the end of `getDataProxy`:
- `$execution.id`, `$execution.mode`, `$execution.resumeUrl`, `$execution.resumeFormUrl`, `$execution.customData`
- `$vars`
- `$secrets`
- Deprecated: `$executionId`, `$resumeWebhookUrl`

### Extension Functions (Method-style)

Expressions support method-chaining syntax on built-in types through n8n's extension system. The `extendSyntax()` function rewrites calls to known extension methods into calls to `extend()` or `extendOptional()` helper functions, which dispatch to the extension implementations.

Extension modules live in `packages/workflow/src/extensions/`:

| Extension | Methods (examples) |
|-----------|-------------------|
| `string-extensions.ts` | `.toDateTime()`, `.toInt()`, `.toFloat()`, `.toBoolean()`, `.length()`, `.trim()`, `.hash(algo)`, `.base64Encode()`, `.base64Decode()`, `.urlDecode()`, `.urlEncode()`, `.extractDomain()`, `.extractEmail()`, `.extractUrl()`, `.replaceAll()`, `.removeMarkdown()`, `.toTitleCase()`, `.transliterate()` |
| `number-extensions.ts` | `.round(decimals)`, `.floor()`, `.ceil()`, `.toDateTime()`, `.isEven()`, `.isOdd()`, `.toFixed()`, `.abs()`, `.clamp()`, `.percentage()` |
| `array-extensions.ts` | `.first()`, `.last()`, `.shuffle()`, `.unique()`, `.flatten()`, `.filter()`, `.map()`, `.sum()`, `.average()`, `.min()`, `.max()`, `.contains()`, `.isEmpty()`, `.chunk()`, `.pluck()`, `.union()`, `.intersection()`, `.difference()` |
| `date-extensions.ts` | `.format(fmt)`, `.startOf(unit)`, `.endOf(unit)`, `.plus(obj)`, `.minus(obj)`, `.diff(date, unit)`, `.isAfter()`, `.isBefore()`, `.isBetween()`, `.toMillis()`, `.toSeconds()` |
| `object-extensions.ts` | `.keys()`, `.values()`, `.hasField(key)`, `.removeField(key)`, `.removeFieldsContaining(val)`, `.keepFieldsMatching(regex)`, `.compact()`, `.urlEncode()`, `.toQueryString()`, `.isEmpty()` |
| `boolean-extensions.ts` | `.toString()`, `.toInt()`, `.toFloat()`, `.not()` |

**Top-level global functions** injected via `extendedFunctions` (`/Users/ib/prj-other/n0n/n8n/packages/workflow/src/extensions/extended-functions.ts:73`):

```
min, max, not, average, numberList, zip
$min, $max, $average, $not, $ifEmpty
```

### When Are Expressions Evaluated?

Expressions are evaluated **at node execution time**, per item. The engine iterates over each input item and evaluates all parameter expressions with that item's data as context.

Credentials expressions are evaluated during `CredentialsHelper.applyDefaultsAndOverwrites()` (`/Users/ib/prj-other/n0n/n8n/packages/cli/src/credentials-helper.ts:404`), which is called from `CredentialsHelper.getDecrypted()`. This happens **inside the node execution context**, after the node has started executing but before the node's code accesses the decrypted credential values.

Importantly, credentials are decrypted and expressions within them resolved **after** credential injection is initialized. The resolved credential data is passed to node code via `getCredentials(type)` in the node execution context.

### Expression Examples from the Codebase

**1. Accessing current item's JSON field** — used everywhere in Set, HTTP Request, etc.

```
={{ $json.email }}
```

**2. Accessing data from a specific upstream node**

```
={{ $("HTTP Request").first().json.accessToken }}
```

**3. Credential authenticate field using `$credentials`**

```typescript
// packages/nodes-base/credentials/WufooApi.credentials.ts:31-38
authenticate: IAuthenticateGeneric = {
  type: 'generic',
  properties: {
    auth: {
      username: '={{$credentials.apiKey}}',
      password: 'not-needed',
    },
  },
};
```

**4. Credential test request URL using `$credentials`**

```typescript
// packages/nodes-base/credentials/WufooApi.credentials.ts:42-45
test: ICredentialTestRequest = {
  request: {
    baseURL: '=https://{{$credentials.subdomain}}.wufoo.com',
    url: '/api/v3/forms.json',
  },
};
```

**5. Referencing environment variables or workflow variables**

```
={{ $env.MY_API_ENDPOINT }}
={{ $vars.defaultRegion }}
={{ $secrets.vault.OPENAI_API_KEY }}
```

**6. Using Luxon DateTime helpers**

```
={{ $now.minus({ days: 7 }).toISO() }}
={{ DateTime.fromISO($json.createdAt).toFormat('yyyy-MM-dd') }}
```

**7. Using string extension methods**

```
={{ $json.email.extractDomain() }}
={{ $json.content.hash('sha256') }}
```

---

## Part B: Credential Management System

### ICredentialType Interface

Every credential type in `packages/nodes-base/credentials/` implements this interface (`/Users/ib/prj-other/n0n/n8n/packages/workflow/src/interfaces.ts:346`):

```typescript
export interface ICredentialType {
  // Internal identifier used in node `credentials` field and DB
  name: string;

  // Human-readable label shown in UI
  displayName: string;

  // Icon for the credential (file path, URL, or themed)
  icon?: Icon;
  iconColor?: ThemeIconColor;
  iconUrl?: Themed<string>;
  iconBasePath?: string;

  // Inheritance: this credential extends one or more parent types
  // (most OAuth2 credentials extend 'oAuth2Api')
  extends?: string[];

  // Credential form fields (same type as node parameters)
  properties: INodeProperties[];

  // Link to external docs
  documentationUrl?: string;

  // Properties overwritten by admin via environment-based overwrites
  __overwrittenProperties?: string[];

  // Authentication method (declarative or programmatic)
  authenticate?: IAuthenticate;

  // Optional async hook called before authentication to refresh tokens
  preAuthentication?: (
    this: IHttpRequestHelper,
    credentials: ICredentialDataDecryptedObject,
  ) => Promise<IDataObject>;

  // Test request used to verify the credential
  test?: ICredentialTestRequest;

  // Whether to use the generic HTTP authentication handler
  genericAuth?: boolean;

  // Node that makes HTTP requests using this credential type
  httpRequestNode?: ICredentialHttpRequestNode;

  // Which nodes can use this credential type
  supportedNodes?: string[];
}
```

**API-key credential example** (`WufooApi`):

```typescript
// /Users/ib/prj-other/n0n/n8n/packages/nodes-base/credentials/WufooApi.credentials.ts
export class WufooApi implements ICredentialType {
  name = 'wufooApi';
  displayName = 'Wufoo API';
  documentationUrl = 'wufoo';
  properties: INodeProperties[] = [
    { displayName: 'API Key', name: 'apiKey', type: 'string', typeOptions: { password: true }, default: '' },
    { displayName: 'Subdomain', name: 'subdomain', type: 'string', default: '' },
  ];
  authenticate: IAuthenticateGeneric = { type: 'generic', properties: { auth: { username: '={{$credentials.apiKey}}', password: 'not-needed' } } };
  test: ICredentialTestRequest = { request: { baseURL: '=https://{{$credentials.subdomain}}.wufoo.com', url: '/api/v3/forms.json' } };
}
```

**OAuth2 credential example** (Xero inheriting from the shared base):

```typescript
// /Users/ib/prj-other/n0n/n8n/packages/nodes-base/credentials/XeroOAuth2Api.credentials.ts
export class XeroOAuth2Api implements ICredentialType {
  name = 'xeroOAuth2Api';
  extends = ['oAuth2Api'];          // Inherits all OAuth2 base properties
  displayName = 'Xero OAuth2 API';
  properties: INodeProperties[] = [
    { name: 'grantType', type: 'hidden', default: 'authorizationCode' },
    { name: 'authUrl', type: 'hidden', default: 'https://login.xero.com/identity/connect/authorize' },
    { name: 'accessTokenUrl', type: 'hidden', default: 'https://identity.xero.com/connect/token' },
    // ...
  ];
}
```

### Credential Storage Schema

Database table: `credentials_entity`

Original schema (from initial migration `/Users/ib/prj-other/n0n/n8n/packages/@n8n/db/src/migrations/sqlite/1588102412422-InitialMigration.ts:6`):

```sql
CREATE TABLE credentials_entity (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        VARCHAR(128) NOT NULL,
  data        TEXT NOT NULL,        -- AES-256-CBC encrypted JSON blob
  type        VARCHAR(128) NOT NULL,
  createdAt   DATETIME NOT NULL,
  updatedAt   DATETIME NOT NULL
)
```

Additional columns added via migrations:

| Column | Type | Migration | Purpose |
|--------|------|-----------|---------|
| `isManaged` | BOOLEAN DEFAULT FALSE | `1734479635324` | Cloud-managed credentials (e.g. free OpenAI credits). Not user-editable. |
| `isGlobal` | BOOLEAN DEFAULT FALSE | `1762771954619` | Visible to all users in the instance. |
| `isResolvable` | BOOLEAN DEFAULT FALSE | `1765459448000` | Dynamic credential (EE). Resolved at execution time by a resolver workflow. |
| `resolvableAllowFallback` | BOOLEAN DEFAULT FALSE | `1765459448000` | If dynamic resolution fails, fall back to static data. |
| `resolverId` | VARCHAR(16) NULLABLE | `1765459448000` | FK to `dynamic_credential_resolver.id`. |

TypeORM entity: `/Users/ib/prj-other/n0n/n8n/packages/@n8n/db/src/entities/credentials-entity.ts:9`

Sharing table: `shared_credentials` links credentials to projects via roles (`credential:owner`, `credential:user`, `credential:editor`).

### Encryption at Rest

**Algorithm:** AES-256-CBC with per-record random 8-byte salt.

**Implementation:** `Cipher` class at `/Users/ib/prj-other/n0n/n8n/packages/core/src/encryption/cipher.ts`

```typescript
@Service()
export class Cipher {
  constructor(private readonly instanceSettings: InstanceSettings) {}

  encrypt(data: string | object, customEncryptionKey?: string) {
    const salt = randomBytes(8);
    const [key, iv] = this.getKeyAndIv(salt, customEncryptionKey);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    const encrypted = cipher.update(typeof data === 'string' ? data : JSON.stringify(data));
    // Output: 8-byte "Salted__" prefix + 8-byte salt + ciphertext (base64)
    return Buffer.concat([RANDOM_BYTES, salt, encrypted, cipher.final()]).toString('base64');
  }

  decrypt(data: string, customEncryptionKey?: string) {
    const input = Buffer.from(data, 'base64');
    if (input.length < 16) return '';
    const salt = input.subarray(8, 16);    // bytes 8–15 are salt
    const [key, iv] = this.getKeyAndIv(salt, customEncryptionKey);
    const contents = input.subarray(16);   // bytes 16+ are ciphertext
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(contents), decipher.final()]).toString('utf-8');
  }

  private getKeyAndIv(salt: Buffer, customEncryptionKey?: string): [Buffer, Buffer] {
    const encryptionKey = customEncryptionKey ?? this.instanceSettings.encryptionKey;
    const password = Buffer.concat([Buffer.from(encryptionKey, 'binary'), salt]);
    // OpenSSL-compatible EVP_BytesToKey with MD5:
    const hash1 = createHash('md5').update(password).digest();                    // 16 bytes
    const hash2 = createHash('md5').update(Buffer.concat([hash1, password])).digest(); // 16 bytes
    const iv    = createHash('md5').update(Buffer.concat([hash2, password])).digest(); // 16 bytes
    const key   = Buffer.concat([hash1, hash2]);                                   // 32 bytes = AES-256
    return [key, iv];
  }
}
```

The format mirrors OpenSSL's `EVP_BytesToKey` with MD5 (the same format used by CryptoJS, the old encryption library). The first 8 bytes of the base64-decoded blob are the ASCII string `Salted__` (hex `53616c7465645f5f`), which CryptoJS also writes as a magic header.

**Encryption key management** (`/Users/ib/prj-other/n0n/n8n/packages/core/src/instance-settings/instance-settings.ts`):

The master encryption key is managed by `InstanceSettings`:

1. On first start the key is read from `N8N_ENCRYPTION_KEY` env var, OR auto-generated as `randomBytes(24).toString('base64')`.
2. The key is written (along with other settings) to `~/.n8n/config` as a JSON file with `0600` permissions (configurable via `N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS`).
3. On subsequent starts the key is loaded from the file. If `N8N_ENCRYPTION_KEY` is also set, the two must match or the process refuses to start.
4. Workers require `N8N_ENCRYPTION_KEY` explicitly; they throw `WorkerMissingEncryptionKey` if it is absent (they have no `~/.n8n/config`).

The `instanceId` is derived from the encryption key: `sha256(key.slice(key.length/2))` — meaning the key must be stable for telemetry identity to remain consistent.

### Credential Lifecycle

```
1. USER CREATES CREDENTIAL (UI form submit)
   ↓
   POST /rest/credentials
   ↓ CredentialsController.createCredential()
   ↓ CredentialsService.createCredential()
   ↓   Credentials.setData(plainData)            → cipher.encrypt(JSON.stringify(data))
   ↓   credentialsRepository.save(encrypted)     → INSERT INTO credentials_entity (data=...)

2. CREDENTIAL STORED AT REST
   credentials_entity.data = base64("Salted__" + salt + AES256CBC(JSON, key+salt))

3. NODE EXECUTION BEGINS
   ↓ NodeExecutionContext._getCredentials(type)  [node-execution-context.ts:286]
   ↓ additionalData.credentialsHelper.getDecrypted(...)
   ↓ CredentialsHelper.getDecrypted()            [credentials-helper.ts:344]
   ↓   credentialsRepository.findOneByOrFail({ id, type })
   ↓   new Credentials({ id, name }, type, encryptedData)
   ↓   credentials.getData()                     → cipher.decrypt(encryptedData) + JSON.parse

4. DYNAMIC CREDENTIALS (EE feature, optional)
   ↓ DynamicCredentialsProxy.resolveIfNeeded()   [credentials-helper.ts:370]
   ↓   If isResolvable=true, calls resolver workflow to obtain live credentials
   ↓   Falls back to static data if resolvableAllowFallback=true and resolver fails

5. DEFAULTS + OVERWRITES APPLIED
   ↓ CredentialsHelper.applyDefaultsAndOverwrites()   [credentials-helper.ts:404]
   ↓   credentialsOverwrites.applyOverwrite(type, data)
   ↓   NodeHelpers.getNodeParameters(properties, data) — fills in defaults
   ↓   Resolve expressions inside credential values (e.g. ={{$secrets.vault.key}})

6. CREDENTIAL DATA INJECTED INTO NODE
   ↓ Node calls this.getCredentials('myCredentialType')
   ↓ Returns ICredentialDataDecryptedObject (plain JS object)

7. CREDENTIAL USED FOR REQUEST
   ↓ CredentialsHelper.authenticate(credentials, typeName, requestOptions, ...)
   ↓   If credentialType.authenticate is a function → call it
   ↓   If authenticate.type === 'generic' → inject headers/auth/qs/body fields
```

### Credential Injection into HTTP Requests

`CredentialsHelper.authenticate()` in `/Users/ib/prj-other/n0n/n8n/packages/cli/src/credentials-helper.ts:103`:

- If `authenticate` is a **function** on the credential type, it is called directly and must return a modified `IHttpRequestOptions`.
- If `authenticate` is a **generic object** with `type: 'generic'`, the properties map specifies which request fields (`headers`, `auth`, `qs`, `body`) to populate. Values can be expressions resolved at this point using `$credentials` context.

Pre-authentication (token refresh for expirable credentials) happens via `credentialType.preAuthentication()`, which receives an `IHttpRequestHelper` and must return updated credential fields. The result is persisted back to the database.

### Are Credentials Logged or Stored in Execution Data?

Decrypted credential values are **never** stored in execution result data. The execution data stored in the database contains node input/output item data (the `json` and `binary` fields of `INodeExecutionData`), not credentials. Credentials are decrypted in memory, used for the node's HTTP call, and then discarded.

Execution logs (the `execution_entity` table) contain timing, error messages, and run data — not credential values.

### OAuth Flow

**OAuth 2.0** is implemented in:
- Controller: `/Users/ib/prj-other/n0n/n8n/packages/cli/src/controllers/oauth/oauth2-credential.controller.ts`
- Service: `/Users/ib/prj-other/n0n/n8n/packages/cli/src/oauth/oauth.service.ts`
- Library: `@n8n/client-oauth2`

**Flow:**

```
1. GET /rest/oauth2-credential/auth?id=<credentialId>
   → OauthService.generateAOauth2AuthUri()
   → Decrypt credential, get clientId/secret/authUrl
   → Optional: Dynamic Client Registration (DCR) if useDynamicClientRegistration=true
   → Generate CSRF prevention token:
       csrfSecret = Csrf.secretSync()
       state = { token: csrfSecret, createdAt: Date.now(), data: cipher.encrypt(csrfData) }
       base64State = btoa(JSON.stringify(state))
   → Build authorization URL with state
   → Save csrfSecret (+ code_verifier for PKCE) back to encrypted credential record
   → Return authorization URL to frontend

2. User authenticates at provider and is redirected to:
   GET /rest/oauth2-credential/callback?code=<authCode>&state=<base64State>
   → Decode + decrypt CSRF state
   → Verify CSRF token against stored csrfSecret
   → Exchange authCode for access+refresh tokens via @n8n/client-oauth2
   → Merge token data into existing credential (keeps prior refresh_token if provider does not return a new one)
   → Encrypt + save updated credential to DB (delete csrfSecret field)

3. Token refresh
   → Handled automatically by the HTTP request helpers when they detect a 401 or token expiry
   → CredentialsHelper.preAuthentication() invokes credentialType.preAuthentication()
   → For OAuth2, the preAuthentication hook exchanges refresh_token for new access_token
   → Updated token data is written back to DB via CredentialsHelper.updateCredentials()
```

Grant types supported (`OauthService.selectGrantTypeAndAuthenticationMethod`):
- `authorizationCode` with `header` or `body` authentication
- `pkce` (Proof Key for Code Exchange, S256)
- `clientCredentials` with `header` or `body` authentication

CSRF state data is encrypted using the instance's `Cipher`, so it is opaque to the OAuth provider and to the end user.

---

## Security Analysis

### Strengths

1. **AES-256-CBC with per-record salt.** Every credential record has a unique random salt, so identical plaintext encrypts to different ciphertext across records. Compromise of one record does not expose patterns in others.

2. **AST-level sandbox.** The expression evaluator operates on a parsed AST rather than raw `eval`. Before evaluation, dangerous constructs (`this`, prototype chains, dynamic property access with dangerous keys, `constructor`, class extension from function types) are rewritten or blocked at the AST level.

3. **Strict denylisting.** The runtime context explicitly voids `eval`, `Function`, `fetch`, `Promise`, `Proxy`, `Reflect`, `WebAssembly`, and all browser globals. The sandbox is opt-in safe (default deny), not opt-in dangerous.

4. **process.env blocked by default.** Environment variable access inside expressions requires the administrator to explicitly set `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`.

5. **CSRF protection for OAuth.** State tokens are signed with a per-flow secret, time-limited (`MAX_CSRF_AGE`), and the payload is encrypted with the instance cipher. The user ID is embedded and verified.

6. **Credentials never in logs.** The decrypted credential object exists only in process memory during node execution and is not serialized to the database as part of execution data.

### Attack Surface and Weaknesses

1. **MD5-based key derivation.** The `getKeyAndIv` function uses a chain of MD5 hashes (OpenSSL `EVP_BytesToKey`) to derive the AES key and IV from the master password. MD5 is cryptographically broken for collision resistance and is not a suitable KDF. A modern KDF (ARGON2id, PBKDF2-SHA256, SCRYPT) should be used. This is a legacy compatibility decision to maintain interoperability with existing CryptoJS-encrypted records.

2. **Single global encryption key.** All credentials in a database share one master key stored in `~/.n8n/config`. Key rotation requires re-encrypting every credential record in the database. There is no per-credential key, no key hierarchy, and no HSM integration.

3. **Expression sandbox completeness.** The sandbox relies on manual denylisting of known dangerous globals rather than on a true process-level isolation (like `isolated-vm`). The `@n8n/expression-runtime` package describes a future architecture using `isolated-vm` for V8 isolate-based sandbox, but as of the current codebase the main expression evaluator runs in the same Node.js process with Tournament + Proxy-based restrictions. A sufficiently creative attacker may find a bypass through JavaScript's own internal APIs or future V8 changes.

4. **`$env` access latent risk.** While blocked by default, `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` is a single environment variable that opens access to the entire process environment inside any expression. An administrator who enables this gives every workflow author the ability to read all environment variables including any secrets passed via env.

5. **Credential expression injection.** Credentials can contain expression syntax (e.g., `={{ $secrets.vault.key }}`). If an attacker can control the content of a credential field, they can attempt to inject expressions that reference `$secrets` or other proxy values. The existing sandbox applies to these credential expressions as well, but the attack surface extends to credential data values.

6. **OAuth state encryption uses instance key.** The CSRF state is encrypted with the same master encryption key used for credentials. This is appropriate (the key is kept server-side), but it means CSRF state security is directly tied to the security of the encryption key.

---

## Key Files

| File | Purpose |
|------|---------|
| `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/expression.ts` | Main `Expression` class. Implements `resolveSimpleParameterValue`, `initializeGlobalContext` (denylisting), `createSafeObject`, `createSafeError`. Central to understanding what the sandbox allows and blocks. |
| `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/expression-evaluator-proxy.ts` | Thin wrapper that instantiates `Tournament` with the three AST hooks and exports the `evaluateExpression` function. Entry point into actual evaluation. |
| `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/expression-sandboxing.ts` | AST hooks: `ThisSanitizer` (blocks `this` escape), `PrototypeSanitizer` (blocks prototype manipulation and dynamic property access), `DollarSignValidator` (validates bare `$` usage). |
| `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/workflow-data-proxy.ts` | `WorkflowDataProxy` — constructs the entire expression context object (`$json`, `$input`, `$()`, `$node`, `$workflow`, `$env`, etc.). The most important file for understanding what data is available in expressions. |
| `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/workflow-expression.ts` | `WorkflowExpression` — the adapter between `Workflow` and `Expression`. Provides `getParameterValue`, `resolveSimpleParameterValue`, `getSimpleParameterValue`, `getComplexParameterValue`. Used throughout the engine. |
| `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/expressions/expression-helpers.ts` | `isExpression` — the single-character `=` detection function. Simple but critical chokepoint. |
| `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/extensions/extended-functions.ts` | Global helper functions available in expressions: `min`, `max`, `not`, `average`, `numberList`, `zip`, `$ifEmpty`. |
| `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/workflow-data-proxy-env-provider.ts` | `$env` proxy implementation. Enforces `N8N_BLOCK_ENV_ACCESS_IN_NODE` guard independently of the global context denylist. |
| `/Users/ib/prj-other/n0n/n8n/packages/@n8n/expression-runtime/ARCHITECTURE.md` | Design document for the future three-layer expression runtime (isolated-vm / Web Workers / task runners). Describes lazy data loading, the current limitation that the main evaluator is NOT yet using isolated-vm, and the roadmap. |
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/encryption/cipher.ts` | `Cipher` service. AES-256-CBC encryption/decryption. Uses per-record random salt with OpenSSL-compatible `EVP_BytesToKey`/MD5 key derivation. Used for all credential encryption. |
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/instance-settings/instance-settings.ts` | `InstanceSettings` — manages the master encryption key lifecycle: reading from `~/.n8n/config`, auto-generating on first start, validating against `N8N_ENCRYPTION_KEY`. |
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/credentials.ts` | `Credentials` class. Wraps encrypted blob for a single credential record. Provides `setData()` → encrypt, `getData()` → decrypt + parse, `getDataToSave()` for persistence. |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/credentials-helper.ts` | `CredentialsHelper` — the orchestrator for credential access during execution. Implements `getDecrypted()` (decrypt + dynamic resolution + overwrites + expression resolution), `authenticate()` (inject into HTTP request), `preAuthentication()` (token refresh), `updateCredentials()`. |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/credentials/credentials.service.ts` | `CredentialsService` — CRUD operations on credentials with access control, blanking of sensitive fields, overwrite application, and external-secrets permission checks. |
| `/Users/ib/prj-other/n0n/n8n/packages/@n8n/db/src/entities/credentials-entity.ts` | TypeORM entity for the `credentials_entity` table. Declares all columns including `data` (encrypted blob), `isManaged`, `isGlobal`, `isResolvable`, `resolverId`. |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/oauth/oauth.service.ts` | `OauthService` — OAuth 1 and 2 authorization URL generation, CSRF state creation/verification, callback handling, token storage. Contains the full OAuth flow orchestration. |
| `/Users/ib/prj-other/n0n/n8n/packages/cli/src/controllers/oauth/oauth2-credential.controller.ts` | REST endpoints for OAuth2: `GET /auth` (generate auth URL) and `GET /callback` (handle provider redirect). |
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/node-execution-context/node-execution-context.ts` | `NodeExecutionContext` — base class for all node execution contexts. Implements `_getCredentials()` which validates that the node is allowed to request the credential type, then delegates to `credentialsHelper.getDecrypted()`. |
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/node-execution-context/utils/get-additional-keys.ts` | `getAdditionalKeys()` — assembles `$execution`, `$vars`, `$secrets` context objects that are merged into the expression data proxy. Shows exactly what metadata is available at expression evaluation time. |
| `/Users/ib/prj-other/n0n/n8n/packages/core/src/execution-engine/node-execution-context/utils/get-secrets-proxy.ts` | `getSecretsProxy()` — builds the `$secrets.provider.key` proxy that delegates to `externalSecretsProxy`. Shows how external secrets providers integrate into the expression context. |
| `/Users/ib/prj-other/n0n/n8n/packages/workflow/src/interfaces.ts:346` | `ICredentialType` interface definition. The contract every credential class must implement. |
