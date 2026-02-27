# HTTP Framework for Bun.js: Research & Recommendation

Research date: 2026-02-27

## Context

n0n is a workflow automation platform (n8n replica) running on Bun. Requirements:
- REST API (~50+ endpoints)
- WebSocket support (real-time push to browser)
- Webhook receiver (high-throughput incoming HTTP)
- File upload/download (binary data)
- Middleware chain (CORS, auth, rate limiting, body parsing)

Current stack: Elysia on Bun. Original n8n uses Express 5.1 on Node.js.

---

## Framework Comparison

### 1. Elysia (current choice)

**Version:** 1.4 (stable since 1.0 in late 2024)

**Performance:**
- TechEmpower Round 23 (Feb 2026): **1,837,294 req/s** (JSON serialization on Bun)
- Hello world benchmark: ~250,000 req/s on Bun
- WebSocket: ~2.5M messages/s leveraging Bun native WS
- Cold start: ~8-15ms

**TypeScript:**
- Type-first design. TypeBox-based validation drives type inference, runtime validation, and OpenAPI generation simultaneously.
- Type inference: 536ms for server+client types (vs Hono 1.27s with "excessively deep" errors on 100+ routes)
- v1.4 added Standard Schema support (Zod, Valibot, ArkType, Effect Schema alongside TypeBox)
- Eden plugin provides end-to-end type-safe client (similar to tRPC)

**WebSocket:**
- Native integration via `.ws()` method
- Leverages Bun native WS (Zig implementation)
- Full lifecycle hooks: message, open, close, error
- Direct access to Bun pub/sub for topic-based broadcasting

**Plugin Ecosystem (40+):**
- Official: CORS, JWT, Bearer, Cron, OpenAPI/Swagger, Server Timing, Static files, OpenTelemetry, GraphQL (Apollo + Yoga)
- Community: rate limiting, Sentry, Auth.js, OAuth2, CSRF, circuit breaker, compression, protobuf
- Built-in file upload with TypeBox MIME type validation (no multer needed)
- OpenAPI generation automatic from type definitions

**Community:**
- GitHub: ~14.1k stars
- npm: ~326k weekly downloads
- Active maintenance: 300+ issues resolved in 1.3.x cycle alone
- Production usage: Weaviate's Glowe AI app, various API services and microservices

**Gotchas:**
- Breaking changes in 1.0 (global-first to local-first middleware) and 1.3 (macro system for type soundness)
- Post-1.3, API has stabilized significantly
- Eden type inference can be slow with very large API definitions; solution is to export sub-applications
- Bun-first means limited multi-runtime support (Bun + partial Node.js)
- Single primary maintainer (SaltyAom)

---

### 2. Hono

**Version:** 4.x (stable)

**Performance:**
- TechEmpower Round 23: **740,451 req/s** on Bun (2.48x slower than Elysia)
- Excellent on Cloudflare Workers: 100k+ req/s
- `hono/tiny` preset: <14KB bundle, exceptional cold starts on edge
- Multi-runtime design trades Bun-specific optimization for portability

**TypeScript:**
- First-class TypeScript support with RPC mode for type-safe client generation
- Validation via Zod middleware (not integrated like Elysia's TypeBox)
- Type inference is good but slower than Elysia; "excessively deep" errors possible on large APIs
- No automatic OpenAPI generation from types

**WebSocket:**
- Multi-runtime adapter via `upgradeWebSocket()`
- Works on Bun but doesn't fully expose Bun-specific features (topic pub/sub)
- Must access `ws.raw` for Bun-native capabilities (GitHub issue #3230)
- Less integrated than Elysia's native WS support

**Middleware Ecosystem (50+):**
- Official: CORS, JWT, Bearer, Basic Auth, ETag, Logger, Compress, Secure Headers, Timing
- Third-party: Auth.js, Clerk, Firebase, Sentry, OpenTelemetry, rate limiting (hono-rate-limiter)
- Broader ecosystem than Elysia due to longer presence and multi-runtime community

**Community:**
- GitHub: ~9k+ stars (but note: rapidly growing)
- npm: **~17.3M weekly downloads** (53x more than Elysia)
- Backed by Cloudflare ecosystem adoption
- Extensive production usage across edge and serverless platforms

**Gotchas:**
- Performance gap on Bun is significant (2.48x slower than Elysia)
- WebSocket abstraction doesn't expose full Bun capabilities
- Multi-runtime focus means Bun-specific optimizations are secondary
- Need to assemble validation + OpenAPI + type safety manually (more glue code)

---

### 3. Bun.serve (native)

**Performance:**
- Raw HTTP handling baseline for all Bun frameworks
- ~59,026 req/s in Express-equivalent benchmarks (this number seems low; raw Bun is the ceiling that frameworks like Elysia approach)
- WebSocket: ~2.5M messages/s (native Zig implementation)
- Zero framework overhead

**When sufficient:**
- Simple health check / metrics endpoints
- Single-purpose webhook receivers with minimal routing
- Proxy servers or protocol adapters
- Performance-critical hot paths where every microsecond matters

**When insufficient:**
- 50+ endpoints need manual pattern matching
- Middleware chains require manual orchestration
- No built-in validation, CORS, auth, rate limiting
- No OpenAPI generation
- Error handling must be fully custom
- Inconsistent patterns across endpoints as codebase grows

**Verdict:** Not suitable as primary framework for n0n's requirements. Useful for isolated high-perf services.

---

### 4. Other Emerging Frameworks

**Stric:**
- Bun-first minimal framework, <50KB
- Performance comparable to raw Bun.serve
- Modular: `@stricjs/router` + `@stricjs/utils`
- Limited documentation and community (<1k stars, ~5k weekly npm downloads)
- Too immature for production workflow automation platform

**SonicJS:**
- Edge-first CMS framework
- <50ms global latency, zero cold starts via V8 isolates
- Different use case (CMS, not general API framework)
- Not suitable for n0n

**bun-route:**
- Express-like routing on top of Bun.serve
- Minimal feature set
- Not a viable alternative for complex applications

---

## Comparison Matrix

| Criteria | Elysia | Hono | Bun.serve | Stric |
|---|---|---|---|---|
| **req/s on Bun** | 1.84M | 740k | baseline | ~1.5M |
| **TypeScript** | Exceptional (type-first) | Good | Basic | Good |
| **WebSocket** | Native, full Bun API | Adapter, partial Bun API | Native | Native |
| **Validation** | Built-in (TypeBox + Standard Schema) | External (Zod middleware) | Manual | Manual |
| **OpenAPI** | Automatic from types | Manual | None | None |
| **File uploads** | Built-in w/ MIME validation | External | Manual | Manual |
| **Plugins** | 40+ | 50+ | N/A | Few |
| **npm downloads/wk** | ~326k | ~17.3M | N/A | ~5k |
| **GitHub stars** | 14.1k | 9k+ | N/A | <1k |
| **Multi-runtime** | Bun (+partial Node) | Bun, Node, Deno, CF Workers, Lambda | Bun only | Bun only |
| **Production maturity** | High | High | Medium | Low |
| **Bun optimization** | Maximum | General | Native | High |

---

## Assessment for n0n

### What n0n needs most:

1. **Type-safe 50+ endpoint REST API** -- Elysia wins decisively. Type-first design with automatic OpenAPI, integrated validation, and Eden client eliminate entire classes of bugs and maintenance burden.

2. **WebSocket push** -- Elysia wins. Native `.ws()` with full access to Bun pub/sub for topic-based broadcasting (workflow execution updates to specific clients). Hono's WS adapter requires `ws.raw` workarounds.

3. **High-throughput webhooks** -- Both adequate. Elysia's higher raw throughput (2.48x) provides headroom. Built-in rate limiting plugin and declarative validation simplify webhook signature verification.

4. **File upload/download** -- Elysia wins. Built-in TypeBox file validators with MIME type checking. No multer dependency.

5. **Middleware chain** -- Comparable. Both have CORS, auth, rate limiting. Elysia's lifecycle-based model (derive/resolve/decorate) is more structured. Hono's chainable middleware is more familiar to Express users.

### Risk factors with Elysia:

- **Single maintainer risk** -- SaltyAom is the primary developer. Bus factor concern.
- **Bun lock-in** -- If Bun has issues, migrating to Hono would provide runtime flexibility. However, n0n is already committed to Bun.
- **Smaller community** -- 326k vs 17.3M weekly downloads. Fewer Stack Overflow answers, fewer blog posts. But growing.
- **Breaking changes history** -- Pre-1.0 was rough. Post-1.3, API has stabilized.

### Risk factors with switching to Hono:

- **Performance regression** -- 2.48x slower on Bun. Not trivial for webhook-heavy workload.
- **More glue code** -- Need to manually wire validation + OpenAPI + types. Elysia does this automatically.
- **WebSocket limitations** -- Adapter doesn't expose full Bun WS API natively.
- **Migration cost** -- Rewriting all existing routes, middleware, WS handling.

---

## Recommendation: Stay with Elysia

**Rationale:**

1. Elysia is already in use and working. Migration cost to Hono provides no proportional benefit for a Bun-committed project.

2. For n0n's specific requirements (type-safe REST API, native WebSocket, webhook throughput, file handling), Elysia is the technically superior choice on Bun.

3. The 2.48x performance advantage over Hono on Bun is meaningful for a platform that receives webhooks at scale and pushes real-time updates via WebSocket.

4. Automatic OpenAPI generation from TypeBox schemas reduces documentation burden as the API grows to 50+ endpoints.

5. The main risk (single maintainer) is real but mitigated by:
   - Framework is open source and well-structured
   - Bun team actively collaborates with Elysia
   - Community is growing (14k stars, 326k weekly downloads)
   - Hono remains a viable fallback if Elysia development stalls

**Action items:**
- Keep Elysia, upgrade to 1.4 when ready
- Adopt Standard Schema support (v1.4) to use Zod where TypeBox is awkward
- Use Eden for any internal service-to-service calls to get end-to-end type safety
- Monitor Elysia project health (release cadence, issue response time) quarterly

---

## Sources

- [Elysia official site](https://elysiajs.com)
- [Elysia vs Hono migration guide](https://elysiajs.com/migrate/from-hono)
- [Elysia 1.0 blog](https://elysiajs.com/blog/elysia-10)
- [Elysia 1.4 blog](https://elysiajs.com/blog/elysia-14)
- [Hono docs](https://hono.dev)
- [Hono WebSocket helper](https://hono.dev/docs/helpers/websocket)
- [Hono WS Bun issue #3230](https://github.com/honojs/hono/issues/3230)
- [Bun official site](https://bun.com)
- [TechEmpower Benchmarks Round 23](https://www.techempower.com/benchmarks/)
- [Bun ecosystem - Stric](https://bun.com/docs/guides/ecosystem/stric)
- [Elysia rate limit plugin](https://github.com/rayriffy/elysia-rate-limit)
- [Bun Elysia framework overview (OneUptime)](https://oneuptime.com/blog/post/2026-01-31-bun-elysia-framework/view)
