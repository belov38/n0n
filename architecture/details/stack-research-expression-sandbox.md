# Expression Sandbox — QuickJS-emscripten (WASM)

**Decision date:** 2026-02-27 | **Runtime:** Bun

## Choice: QuickJS-emscripten + jsep fast-path

QuickJS compiled to WASM provides a completely isolated JavaScript interpreter for expression evaluation. Combined with a jsep AST fast-path for simple expressions, this gives both security and performance.

### Why QuickJS-emscripten

1. **True WASM isolation.** Guest code runs in a separate interpreter — no shared heap, no shared prototypes, no JS semantic escape possible. The entire class of n8n-style sandbox CVEs (CVE-2026-1470, CVE-2026-0863) is structurally impossible.

2. **Built-in timeout.** Interrupt handler kills runaway expressions. No Worker wrapping needed. `setInterruptHandler(() => Date.now() > deadline)`.

3. **Memory safety.** Each WASM instance has bounded linear memory. No cross-instance interference. Can set memory limits.

4. **Bun-native.** WASM runs natively on Bun. No C++ addons, no V8 dependency. Confirmed working.

5. **Low maintenance.** Security doesn't depend on tracking JS spec changes. The WASM boundary IS the security mechanism, not AST analysis.

### Performance

| Metric | Value |
|--------|-------|
| Expression evaluation | ~100-300 us per expression |
| Instance creation | ~1-5 ms (fast enough to pool) |
| Memory per instance | 5-20 MB |
| Pool recommendation | 8-20 instances |

For a workflow evaluating 1000 expressions: 100-300ms total overhead. Acceptable — nodes typically do network I/O (100ms+) anyway.

### Security Context: Why This Matters

n8n uses `@n8n/tournament` — AST-based in-process evaluation with security hooks. Two critical CVEs in 2026:

- **CVE-2026-1470** (CVSS 9.9): `with(function(){})` + `constructor` resolution bypasses AST sanitizer. Full RCE.
- **CVE-2026-0863** (CVSS 8.5): Python code execution bypass via Python 3.10+ semantics the sanitizer didn't anticipate.

**Key lesson:** AST-based sanitization is a cat-and-mouse game against the entire JavaScript spec. WASM isolation eliminates this class of vulnerability entirely.

### Architecture

```
Expression string "{{ $json.items.filter(i => i.active) }}"
    │
    ▼
┌─────────────────────────────┐
│  1. Template Parser         │  Extract expressions from {{ }}
│     (simple string split)   │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  2. AST Pre-check (jsep)   │  Parse to AST. For trivial expressions
│     (fast-path)             │  ($json.field), evaluate directly (~1-5us).
│                             │  For complex ones, route to QuickJS.
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  3. QuickJS Sandbox         │  WASM sandbox with:
│     (pooled instances)      │  - JSON-serialized context
│                             │  - 500ms timeout via interrupt handler
│                             │  - Memory limit per instance
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  4. Result Validation       │  Verify result is JSON-serializable.
└─────────────────────────────┘
```

### jsep Fast-Path

For simple property access expressions (`$json.email`, `$json.items[0].name`), jsep parses to AST and evaluates directly in-process (~1-5us). These are provably safe — no function calls, no method chains. The jsep layer is NOT the security boundary; QuickJS is.

- **jsep:** 2.5KB, lightweight expression parser. Supports binary/unary ops, function calls, member expressions, conditionals. Plugins for arrow functions, template literals.
- **Fast-path criteria:** AST contains only safe nodes (property access, literals, simple operators)

### Context Injection

Context must be JSON-serializable. Pass as JSON string, deserialize inside QuickJS:

```typescript
const contextJson = JSON.stringify({ $json: itemData, $input: inputData });
const code = `
  const $ctx = JSON.parse('${escape(contextJson)}');
  const $json = $ctx.$json;
  const $input = $ctx.$input;
  (${expression})
`;
```

**Limitation:** Cannot pass functions, Dates, or complex prototypes directly. Utility functions (Math, String methods) must be provided separately inside the QuickJS context.

### Code Node (separate concern)

User-written multi-line scripts in the Code node use **Bun Workers** with a locked-down Worker script that does not expose fs/net APIs. This provides process-level isolation with full JS support for longer-running user code.

### Implementation Phases

1. **Phase 1:** QuickJS-emscripten integration with context injection, timeout, pool management
2. **Phase 2:** jsep fast-path for simple expressions (property access only)
3. **Phase 3:** Context optimization — avoid re-serializing unchanged context across expressions in same node
4. **Phase 4:** Bun Worker sandbox for Code node

### Key Libraries

| Package | Purpose | npm weekly |
|---------|---------|-----------|
| `quickjs-emscripten` | QuickJS → WASM | ~150k |
| `@sebastianwessel/quickjs` | Higher-level wrapper (better DX) | ~30k |
| `jsep` | Lightweight expression parser | ~2.5M |

### Alternatives Considered

| Approach | Why Not |
|----------|---------|
| **isolated-vm** | Depends on V8 C++ internals. Does not compile on Bun (JavaScriptCore). Hard blocker. |
| **SES (Hardened JS)** | No built-in timeout (can't kill infinite loops). No memory isolation. Bun/JSC untested by Agoric. |
| **Bun Workers** | 500us-5ms round-trip too heavy for per-expression eval. Workers have full Bun API access. |
| **AST-only (jsep/tournament)** | Proven insecure as sole defense (CVE-2026-1470). OK as fast-path, not as security boundary. |
| **eval/new Function + frozen** | Fundamentally broken. `with` + `constructor` = proven escape path. |
| **ShadowRealm (TC39)** | Stage 2.7. Not implemented in any engine yet. |

### Sources

- [CVE-2026-1470: n8n sandbox escape](https://research.jfrog.com/post/achieving-remote-code-execution-on-n8n-via-sandbox-escape/)
- [quickjs-emscripten GitHub](https://github.com/nicolo-ribaudo/quickjs-emscripten)
- [@sebastianwessel/quickjs](https://github.com/sebastianwessel/quickjs)
- [jsep expression parser](https://ericsmekens.github.io/jsep/)
- [Bun Workers](https://bun.com/docs/runtime/workers)
