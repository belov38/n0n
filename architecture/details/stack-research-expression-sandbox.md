# Expression Sandbox for Bun.js: Research & Recommendation

Research date: 2026-02-27

## Context

n0n is a workflow automation platform (n8n-inspired) running on Bun. Users write JavaScript expressions in node parameters to reference runtime data:

```
{{ $json.email }}                           — property access
{{ $json.items.filter(i => i.active) }}     — array methods
{{ $json.date.toISO() }}                    — method calls
{{ Math.round($json.price * 1.1) }}         — JS math
{{ $json.price > 100 ? 'high' : 'low' }}   — ternary
```

Expressions are evaluated **per-item, per-node** — potentially thousands of times per workflow execution. The engine must be safe (no filesystem/network/process access), fast (microsecond-level overhead matters), and support a custom context object (`$json`, `$input`, `$env`, `$node`, etc.).

Current n8n approach: `@n8n/tournament` — AST-based evaluator with security hooks. Not `eval`, not `vm2`. Runs in-process in the same V8 context with AST sanitization. Two critical CVEs disclosed in 2026 (see Security Context below).

---

## Security Context: Why This Matters

### vm2 is dead
vm2 accumulated 8 security advisories in one year (7 in a 4-month window) and was deprecated. The fundamental flaw: JavaScript proxies cannot reliably intercept all escape paths when the underlying engine actively undermines isolation.

### n8n sandbox escapes in 2026
- **CVE-2026-1470** (CVSS 9.9): Authenticated users bypass the AST sandbox via `with(function(){})` + `constructor` resolution. The sanitizer blocks `obj.constructor` but not standalone `constructor` resolved through `with`-statement scoping. Full RCE on the host server.
- **CVE-2026-0863** (CVSS 8.5): Python code execution bypass in the Code node. AST sanitization missed semantics introduced in Python 3.10+ (`AttributeError.name`/`.obj` attributes).

**Key lesson**: AST-based sanitization is a cat-and-mouse game. Language evolution continuously introduces new escape vectors that invalidate previous assumptions.

---

## Approach Comparison

### 1. isolated-vm (V8 Isolates)

**What it is:** Native C++ addon providing direct access to V8's Isolate interface. Each isolate has its own heap, GC, and global environment.

**Security:** Strong — relies on V8's battle-tested isolate boundary, not JS-level sandboxing. Guest code cannot access host memory or globals unless explicitly exposed through host functions. Security is only as good as the host functions you expose.

**Performance:**
- Sub-microsecond for simple expressions in a warmed-up isolate
- Isolate creation: ~50-100ms (must pool/reuse)
- Data transfer requires serialization between isolates
- Memory: 50-100MB per isolate

**Bun compatibility: NOT VIABLE.** isolated-vm depends on V8 C++ internals and Node.js native module headers. Bun uses JavaScriptCore, not V8. The library will not compile or run on Bun without fundamental rewrites. This is a hard blocker.

**Context injection:** Via reference transfer mechanism — host exposes specific objects/functions to the guest context.

**JS features:** Full ES2020+ (it is V8 after all).

**Timeout:** Built-in timeout support via V8 isolate termination.

**Maintenance:** Actively maintained, successor to vm2 in the Node.js ecosystem.

**Verdict: Eliminated for n0n due to Bun incompatibility.** Would be a strong choice if running on Node.js.

---

### 2. SES (Secure ECMAScript / Hardened JavaScript)

**What it is:** Agoric's `ses` package. Hardens the JS runtime in-process using `lockdown()` (freezes all intrinsics) + `Compartment` (isolated global scope). Based on object-capability (OCap) security model. TC39 proposal at Stage 2.7.

**npm:** `ses` (maintained by Agoric/Endo project)

**Security:** Strong within its model — code inside a Compartment cannot access capabilities it wasn't explicitly granted. All intrinsics are frozen, preventing prototype pollution. No "reaching around" to host APIs. However, security depends on careful API design of what you expose. Proxy handlers, getters on exposed objects, and subtle JS semantics (valueOf, toLocaleString) are potential attack vectors if exposed objects are not properly hardened.

**Performance:**
- Near-native execution speed (same JS engine, JIT-compiled)
- `lockdown()` is a one-time cost at startup (~100-500ms to freeze all intrinsics)
- `harden()` traverses and freezes object graphs — cost proportional to object complexity
- Per-evaluation overhead: 5-20% over raw JS for complex expressions, negligible for simple ones
- Compartment creation is lightweight (shared frozen intrinsics)

**Bun compatibility: Should work.** SES is pure JavaScript with no native dependencies. Uses standard ES2020+ features (Proxy, Object.freeze, etc.). Not explicitly tested on Bun by Agoric, but no engine-specific code. Needs verification testing — JavaScriptCore may have subtle behavioral differences in edge cases around frozen objects or strict mode.

**Context injection:** Via Compartment constructor `globals` parameter:
```typescript
const c = new Compartment({
  globals: {
    $json: harden(itemData),
    $input: harden(inputProxy),
    Math,
  }
});
const result = c.evaluate(expression);
```

**JS features:** Full ES2020+ including arrow functions, template literals, destructuring, async/await, optional chaining. SES enforces strict mode only. Does not artificially restrict language features — relies on capability control.

**Timeout: NO built-in support.** Cannot kill a synchronous infinite loop from outside. Would need to wrap in a Worker or use `Promise.race` (only works for async). This is a significant gap for expression evaluation.

**Memory isolation:** Shared JS heap. No memory limit per compartment. Malicious expressions can allocate unbounded memory.

**Maintenance:** Actively maintained by Agoric. Used in production (Agoric blockchain, MetaMask Snaps). TC39 engagement ongoing.

**Verdict: Strong contender for "practical + good security" if timeout limitation can be worked around.** The lack of CPU/memory limits is the main gap. Could be combined with a Worker-based timeout wrapper for defense-in-depth.

---

### 3. QuickJS / quickjs-emscripten (Embedded JS Engine via WASM)

**What it is:** QuickJS is a small, complete JavaScript engine written in C. `quickjs-emscripten` compiles it to WebAssembly, creating a completely separate JS interpreter running inside the host runtime. Zero shared memory or object references with the host.

**npm packages:**
- `quickjs-emscripten` (by justjake — original, well-established)
- `@aspect-build/aspect-quickjs-emscripten` (variant)
- `@sebastianwessel/quickjs` (higher-level wrapper with better DX)

**Security: Strongest of all options.** WASM sandbox enforces isolation at the system level. Guest code literally runs in a different interpreter — no shared heap, no shared prototypes, no JS semantic escape possible. Cannot access host filesystem, network, or process. The only bridge is explicitly exposed host functions. Even if QuickJS has JS-level vulnerabilities, they cannot escape the WASM sandbox boundary.

**Performance:**
- Expression evaluation: ~100-300 microseconds per expression
- Instance creation: ~1-5ms (fast enough to pool)
- No JIT compilation (pure interpreter) — slower than V8/JSC for compute-heavy code, but for short expressions the difference is negligible
- Memory per instance: 5-20MB (very efficient)
- Pooling 10-20 instances handles high throughput

**Bun compatibility: Excellent.** WASM runs natively on Bun. No native C++ addons needed. No engine-specific code. Confirmed working in Bun environments.

**Context injection:** Via JSON serialization — pass context as a JSON string, deserialize inside QuickJS:
```typescript
const vm = QuickJS.newContext();
vm.setProp(vm.global, '$json', vm.newString(JSON.stringify(itemData)));
// Evaluate: const $json = JSON.parse(<injected>); <expression>
```
**Limitation:** Context must be JSON-serializable. Cannot pass functions, Dates, or complex prototypes directly. Need to provide utility functions separately.

**JS features:** ES2020 support (QuickJS implements nearly the full spec). Some newer features (ES2021+) may lag behind V8/JSC. `Proxy`, `Symbol`, `async/await`, destructuring, optional chaining, nullish coalescing all work.

**Timeout: YES.** QuickJS provides interrupt callbacks — the host can terminate execution after a time limit or instruction count. `quickjs-emscripten` exposes this as `setInterruptHandler`. This is a major advantage over SES.

**Memory isolation: YES.** Each WASM instance has its own linear memory space. Can set memory limits. No cross-instance interference.

**Maintenance:** Actively maintained. quickjs-emscripten has gained adoption as the go-to vm2 replacement. The `@sebastianwessel/quickjs` wrapper provides additional features (module loading, virtual FS).

**Verdict: Best "maximum security" option.** 100-300us overhead is acceptable for per-item expression evaluation. The only downside is serialization cost for large context objects and slightly limited JS feature support compared to native engine.

---

### 4. Bun Workers (Worker Threads)

**What it is:** OS-level thread isolation. Each Worker runs a separate JavaScript context on a distinct thread with its own heap and GC. Communication via structured clone message passing.

**Security:** Strong OS-level isolation. Worker cannot access main thread memory without explicit message passing. However, a Worker has full access to Bun APIs (filesystem, network, subprocess) unless you restrict it. Need to carefully control what code runs in the Worker.

**Performance:**
- Worker creation: ~10-100ms (must pool)
- Message passing: Bun fast-path for strings = 648ns/message. Structured clone for objects = 100us-1ms
- Round-trip for expression evaluation: ~500us - 5ms depending on context size
- Memory per Worker: ~30-50MB (heavier than QuickJS)
- Pool of 10-20 workers handles reasonable throughput

**Bun compatibility: Native.** Workers are a first-class Bun feature with performance optimizations.

**Context injection:** Via postMessage — context is serialized, sent to Worker, deserialized there. Same JSON-serializable limitation as QuickJS but with structured clone support (Dates, Maps, Sets, ArrayBuffers transfer).

**JS features:** Full — Workers run a complete Bun/JSC context.

**Timeout: Possible via Worker.terminate().** Can kill a Worker that exceeds time limits. However, Worker termination destroys the entire context — need to create/recycle from pool.

**Memory isolation: YES.** Separate heap per Worker. No shared memory unless explicitly using SharedArrayBuffer.

**Maintenance:** Stable platform feature. No third-party dependency.

**Verdict: Viable but heavyweight for expression evaluation.** The ~500us-5ms round-trip overhead is acceptable but not great when evaluating thousands of expressions per execution. Better suited for Code node (user-written scripts) than for inline expressions. The lack of built-in capability restriction (Workers can still `fetch()`, read files) requires additional sandboxing within the Worker.

---

### 5. AST-Based Evaluation (jsep, expr-eval, tournament-style)

**What it is:** Parse expressions into an Abstract Syntax Tree, then interpret the tree. Does not execute arbitrary JS — only evaluates the parsed expression tree against a provided context. This is what n8n uses via `@n8n/tournament`.

**Key libraries:**
- **jsep** — lightweight expression parser. 2.5KB. Supports binary/unary ops, function calls, member expressions, conditionals. Plugins for arrow functions, template literals, assignment, spread, regex. Actively maintained.
- **expr-eval** — parser + evaluator. Supports math, comparisons, logical operators, custom functions. Limited JS features.
- **math.js** — full math expression engine with compilation, units, matrices. Overkill for our use case.
- **@n8n/tournament** — n8n's fork of riot-tmpl. AST-based with security hooks.

**Security: Medium.** Security comes from restricting what the parser accepts, not from isolation. The parser rejects statements (no `var`, `for`, `if`), limiting the attack surface. But as CVE-2026-1470 proved, subtle JS semantics can bypass AST-level sanitization. **The fundamental problem: you're playing defense against the entire JavaScript spec, which evolves continuously.**

Known gaps:
- `with` statement interaction with scoping (CVE-2026-1470)
- Prototype chain traversal
- `constructor` access via various indirection paths
- `valueOf`/`toString`/`Symbol.toPrimitive` on context objects
- Future JS features you haven't anticipated

**Performance: Best of all options.**
- Parse: ~1-10us for typical expressions (can cache AST)
- Evaluate: ~0.5-5us per evaluation against cached AST
- Memory: <1MB per evaluator instance
- No serialization overhead — works directly with host JS objects

**Bun compatibility: Perfect.** Pure JavaScript, no native dependencies.

**Context injection:** Direct — pass a JS object as the evaluation scope. No serialization needed:
```typescript
const ast = jsep('$json.items.filter(i => i.active)');
const result = evaluate(ast, { $json: itemData, Math });
```

**JS features (jsep):**
- Property access, function calls, array/object literals
- Binary/unary operators, ternary
- Arrow functions (plugin), template literals (plugin)
- Does NOT support: statements, loops, class definitions, async/await, try/catch

**Timeout: NO.** Runs synchronously in-process. An expression like `Array(1e9).fill(0)` blocks the event loop. Need external timeout mechanism.

**Memory isolation: NONE.** Shared heap with host. Context objects are passed by reference — expressions can mutate them.

**Maintenance:** jsep is actively maintained. However, maintaining security sanitization on top of it is an ongoing burden that grows with each JS spec revision.

**Verdict: Best performance, weakest security.** Appropriate if combined with additional defense layers. The n8n CVEs are a cautionary tale. Could serve as a "fast path" for simple expressions with QuickJS as a "secure path" for complex ones.

---

### 6. eval / new Function() with Frozen Globals

**What it is:** Use `new Function()` to compile expressions, wrapping them in a scope with frozen/proxied globals. Similar to the proxy-based sandbox pattern:
```javascript
const fn = new Function('sandbox', `with(sandbox) { return (${expr}); }`);
return fn(frozenContext);
```

**Security: WEAK. Not recommended.**
- `with` statement + `constructor` resolution = proven escape path (CVE-2026-1470)
- Proxy traps cannot intercept prototype chain traversal
- `Symbol.unscopables` can break out of `with` scoping
- `arguments.callee` in non-strict mode reveals the Function constructor
- New escape vectors discovered regularly

**Performance:** Near-native (JIT-compiled). Sub-microsecond for simple expressions.

**Bun compatibility:** Works.

**Verdict: Eliminated. Security is fundamentally broken. The n8n CVE demonstrates exactly why this approach fails.**

---

### 7. TC39 ShadowRealm Proposal

**What it is:** Standardized API for creating isolated JS realms with their own global objects and frozen shared intrinsics. Similar to SES Compartments but built into the language.

```javascript
const realm = new ShadowRealm();
const result = realm.evaluate('1 + 2');
```

**Status:** Stage 2.7 as of early 2026. Not yet implemented in any production engine. Unlikely to ship before late 2026 or 2027.

**Verdict: Not available yet.** When it ships, it would provide a standardized alternative to SES Compartments. Worth monitoring but not usable today.

---

### 8. Hybrid / Layered Approaches

The most practical architecture combines multiple techniques:

**Pattern A: AST fast-path + QuickJS secure fallback**
1. Parse expression with jsep
2. If AST contains only safe nodes (property access, literals, simple operators) → evaluate directly (sub-microsecond)
3. If AST contains function calls, method chains, or complex constructs → evaluate in QuickJS sandbox (100-300us)

**Pattern B: SES + Worker timeout wrapper**
1. Run SES Compartment evaluation in a Bun Worker
2. Worker provides timeout via `terminate()`
3. Pool Workers for reuse
4. SES provides capability control, Worker provides timeout + memory isolation

**Pattern C: QuickJS for all expressions (simplest secure option)**
1. Pool QuickJS WASM instances
2. Serialize context as JSON
3. Evaluate all expressions in QuickJS with interrupt handler for timeout
4. Accept 100-300us overhead as the cost of real isolation

---

## Comparison Matrix

| Criterion | isolated-vm | SES | QuickJS WASM | Bun Workers | AST (jsep) | eval+frozen |
|---|---|---|---|---|---|---|
| **Security** | Strong | Strong | Strongest | Strong* | Medium | Weak |
| **Can escape to host?** | No** | No** | No | Yes*** | Yes (CVE) | Yes |
| **Performance (per eval)** | <1us | 1-10us | 100-300us | 500us-5ms | 0.5-5us | <1us |
| **Bun compatible** | NO | Likely | YES | YES | YES | YES |
| **Context injection** | Reference transfer | Compartment globals | JSON serialize | Structured clone | Direct object | Direct object |
| **Full JS features** | Yes | Yes | ES2020 | Yes | Limited | Yes |
| **Timeout support** | Yes | No | Yes | Yes (terminate) | No | No |
| **Memory isolation** | Yes | No | Yes (WASM) | Yes (thread) | No | No |
| **Memory per instance** | 50-100MB | <1MB | 5-20MB | 30-50MB | <1MB | <1MB |
| **Maintenance burden** | Low | Low | Low | Low | HIGH | N/A |

\* Workers have full Bun API access unless restricted at the code level.
\** Only if exposed host functions are carefully audited.
\*** Worker code can access fs/net unless the Worker script is locked down.

---

## Recommendation

### Primary recommendation: QuickJS-emscripten (pooled)

For n0n's expression evaluation engine, **QuickJS via WASM** provides the best balance of security, performance, and practicality:

**Why QuickJS wins:**
1. **Real isolation** — WASM sandbox is a fundamentally different security boundary than JS-level tricks. No prototype escape, no `with` statement abuse, no `constructor` resolution tricks. The entire class of n8n-style CVEs is structurally impossible.
2. **Good enough performance** — 100-300us per expression evaluation. For a workflow that evaluates 1000 expressions, that is 100-300ms total overhead. Acceptable for workflow automation where nodes typically do network I/O (100ms+) anyway.
3. **Native Bun compatibility** — WASM is a first-class Bun feature. No native addon compilation, no V8 dependency.
4. **Built-in timeout** — Interrupt handler kills runaway expressions. No Worker wrapping needed.
5. **Memory safety** — Each WASM instance has bounded linear memory. No heap corruption risk.
6. **Low maintenance** — Security does not depend on tracking every JS spec change. The WASM boundary is the security mechanism, not AST analysis.

**Implementation sketch:**

```typescript
import { newQuickJSWASMModule } from 'quickjs-emscripten';

class ExpressionEvaluator {
  private pool: QuickJSContext[] = [];
  private module: QuickJSWASMModule;

  async init(poolSize = 8) {
    this.module = await newQuickJSWASMModule();
    for (let i = 0; i < poolSize; i++) {
      this.pool.push(this.createContext());
    }
  }

  private createContext(): QuickJSContext {
    const ctx = this.module.newContext();
    // Pre-load Math and utility functions into the context
    ctx.evalCode(`const Math = { round: Math.round, floor: Math.floor, ... };`);
    return ctx;
  }

  evaluate(expression: string, context: Record<string, unknown>, timeoutMs = 500): unknown {
    const ctx = this.pool.pop() ?? this.createContext();
    try {
      // Inject context as JSON
      const contextJson = JSON.stringify(context);
      const code = `
        const $ctx = JSON.parse('${contextJson.replace(/'/g, "\\'")}');
        const $json = $ctx.$json;
        const $input = $ctx.$input;
        (${expression})
      `;

      // Set interrupt handler for timeout
      const deadline = Date.now() + timeoutMs;
      this.module.setInterruptHandler(() => Date.now() > deadline);

      const result = ctx.evalCode(code);
      if (result.error) {
        const err = ctx.dump(result.error);
        result.error.dispose();
        throw new ExpressionError(err);
      }
      const value = ctx.dump(result.value);
      result.value.dispose();
      return value;
    } finally {
      this.pool.push(ctx);
    }
  }
}
```

**Optimizations to implement:**
- Pool contexts, not just the WASM module. Reuse contexts across evaluations of the same workflow execution (same `$json` shape).
- For simple property access expressions (`$json.email`, `$json.items[0].name`), consider a jsep fast-path that skips QuickJS entirely — these are provably safe.
- Cache parsed expressions in QuickJS: compile once with `evalCode`, call repeatedly with different context.
- Use `@sebastianwessel/quickjs` wrapper for better DX if the lower-level API proves cumbersome.

### Alternative: SES Compartments (if performance is critical)

If the 100-300us overhead of QuickJS proves too expensive (e.g., workflows with 10,000+ expressions per execution), SES Compartments offer near-native performance with strong capability-based security:

**Why SES as alternative:**
1. Near-native performance (5-20% overhead)
2. Full JS feature support
3. Proven in production (Agoric, MetaMask)
4. No serialization overhead — pass context objects directly

**Why SES is not the primary recommendation:**
1. No built-in timeout — cannot kill synchronous infinite loops without a Worker wrapper
2. No memory isolation — shares host heap
3. Bun/JavaScriptCore compatibility not yet verified by Agoric
4. Requires careful API design to avoid capability leaks through exposed objects

**If choosing SES, must also:**
- Wrap evaluation in a Bun Worker for timeout enforcement
- Set `--max-old-space-size` or equivalent memory limits on the Worker
- Thoroughly audit all objects passed into Compartment globals
- Test extensively on Bun before committing

### Not recommended

- **isolated-vm** — does not work on Bun (V8-specific)
- **AST-only (jsep/tournament)** — proven insecure as sole defense (CVE-2026-1470). Acceptable as a fast-path optimization layer on top of a real sandbox, not as the security boundary.
- **eval/new Function with frozen globals** — fundamentally broken security model
- **Bun Workers alone** — too heavyweight for per-expression evaluation, and Workers still have full Bun API access requiring additional restriction

### Recommended architecture for n0n

```
Expression string "{{ $json.items.filter(i => i.active) }}"
    │
    ▼
┌─────────────────────────────┐
│  1. Template Parser         │  Extract expressions from {{ }} delimiters
│     (simple string split)   │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  2. AST Pre-check (jsep)   │  Parse to AST. Reject obviously dangerous
│     (optional fast-path)    │  patterns. For trivial expressions
│                             │  ($json.field), evaluate directly.
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  3. QuickJS Sandbox         │  Evaluate in WASM sandbox with:
│     (pooled instances)      │  - JSON-serialized context
│                             │  - 500ms timeout via interrupt handler
│                             │  - Memory limit per instance
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  4. Result Validation       │  Verify result is JSON-serializable.
│                             │  Strip any unexpected types.
└─────────────────────────────┘
```

**For the Code node** (user-written multi-line scripts, not inline expressions):
Use Bun Workers with a locked-down Worker script that does not expose fs/net APIs. This provides process-level isolation with full JS support for longer-running user code.

---

## Implementation Priority

1. **Phase 1:** QuickJS-emscripten integration with context injection and timeout. Pool management. This replaces the tournament-style evaluator as the security boundary.
2. **Phase 2:** jsep fast-path for simple expressions (property access only). AST classification to route simple vs complex expressions.
3. **Phase 3:** Context optimization — avoid re-serializing unchanged context across multiple expressions in the same node execution. Compile frequently-used expressions.
4. **Phase 4:** Bun Worker sandbox for Code node (separate from expression evaluator).

---

## Key Libraries

| Package | Purpose | npm weekly downloads | Last updated |
|---|---|---|---|
| `quickjs-emscripten` | QuickJS compiled to WASM | ~150k | Active (2026) |
| `@sebastianwessel/quickjs` | Higher-level QuickJS wrapper | ~30k | Active (2026) |
| `ses` | Hardened JavaScript / SES | ~50k | Active (Agoric) |
| `jsep` | Lightweight expression parser | ~2.5M | Active |
| `isolated-vm` | V8 isolate sandbox | ~100k | Active (Node.js only) |

## References

- [CVE-2026-1470: n8n sandbox escape via `with` + `constructor`](https://research.jfrog.com/post/achieving-remote-code-execution-on-n8n-via-sandbox-escape/)
- [CVE-2026-0863: n8n Python sandbox escape](https://orca.security/resources/blog/cve-2026-1470-n8n-rce-sandbox-escape/)
- [SES / Hardened JavaScript docs](https://docs.agoric.com/guides/js-programming/hardened-js)
- [quickjs-emscripten GitHub](https://github.com/nicolo-ribaudo/quickjs-emscripten)
- [@sebastianwessel/quickjs](https://github.com/sebastianwessel/quickjs)
- [jsep expression parser](https://ericsmekens.github.io/jsep/)
- [TC39 ShadowRealm proposal](https://github.com/tc39/proposal-shadowrealm)
- [Bun Workers documentation](https://bun.com/docs/runtime/workers)
- [Semgrep: vm2 sandbox escape analysis](https://semgrep.dev/blog/2026/calling-back-to-vm2-and-escaping-sandbox)
- [n8n tournament library](https://github.com/n8n-io/tournament)
