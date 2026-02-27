# HTTP Framework — Elysia 1.4

**Decision date:** 2026-02-27 | **Runtime:** Bun

## Choice: Elysia 1.4

Elysia is a Bun-first HTTP framework with type-first design. It handles all n0n's HTTP needs: REST API (~50+ endpoints), WebSocket push, webhook receiver, and file upload/download.

### Why Elysia

1. **Fastest on Bun.** TechEmpower Round 23: 1,837,294 req/s (JSON serialization). 2.48x faster than Hono on Bun. WebSocket: ~2.5M msg/s via Bun native WS.

2. **Type-first design.** TypeBox-based validation drives type inference, runtime validation, and OpenAPI generation simultaneously. v1.4 added Standard Schema support (Zod, Valibot, ArkType). Eden plugin provides end-to-end type-safe client (tRPC-like).

3. **Native WebSocket.** `.ws()` method with full Bun pub/sub for topic-based broadcasting. No adapter layer — direct access to Bun's Zig-based WS implementation.

4. **Built-in file handling.** TypeBox file validators with MIME type checking. No multer dependency needed.

5. **Rich plugin ecosystem.** 40+ plugins: CORS, JWT, Bearer, Cron, OpenAPI/Swagger, Server Timing, Static files, OpenTelemetry, rate limiting, Sentry, circuit breaker.

### Key Specs

| Metric | Value |
|--------|-------|
| Version | 1.4 (stable since 1.0 in late 2024) |
| Req/s (Bun) | 1.84M (TechEmpower R23) |
| WebSocket | ~2.5M msg/s (Bun native) |
| Cold start | ~8-15ms |
| Type inference | 536ms for server+client types |
| GitHub stars | ~14.1k |
| npm weekly | ~326k |

### Known Risks

- **Single primary maintainer** (SaltyAom). Mitigated by: open source, Bun team collaboration, growing community, Hono as fallback.
- **Bun lock-in.** Partial Node.js support exists, but n0n is committed to Bun anyway.
- **Breaking changes history.** Pre-1.0 was rough. Post-1.3, API has stabilized.

### Implementation Notes for n0n

- Use Standard Schema support (v1.4) for Zod where TypeBox is awkward
- Use Eden for internal service-to-service calls (end-to-end type safety)
- OpenAPI auto-generated from TypeBox schemas — no separate spec maintenance
- `.ws()` with Bun pub/sub for push relay (topic per `pushRef`)

### Alternatives Considered

| Framework | Why Not |
|-----------|---------|
| **Hono** | 2.48x slower on Bun. WS adapter doesn't expose full Bun API. More glue code for validation+OpenAPI. |
| **Bun.serve** | No routing, middleware, validation, or OpenAPI. Only suitable for isolated hot paths. |
| **Stric** | <1k stars, ~5k weekly downloads. Too immature for production. |

### Sources

- [Elysia official site](https://elysiajs.com)
- [Elysia 1.4 blog](https://elysiajs.com/blog/elysia-14)
- [TechEmpower Benchmarks Round 23](https://www.techempower.com/benchmarks/)
- [Elysia rate limit plugin](https://github.com/rayriffy/elysia-rate-limit)
