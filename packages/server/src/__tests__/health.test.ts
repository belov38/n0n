import { describe, it, expect, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';
import {
  healthRoutes,
  registerHealthDependency,
  clearHealthDependencies,
} from '../routes/health.routes';

interface ReadinessBody {
  status: string;
  checks: Record<string, string>;
}

function createApp() {
  return new Elysia().use(healthRoutes);
}

function req(path: string) {
  return new Request(`http://localhost${path}`);
}

describe('health routes', () => {
  beforeEach(() => {
    clearHealthDependencies();
  });

  describe('GET /healthz', () => {
    it('returns 200 with { status: ok }', async () => {
      const app = createApp();
      const res = await app.handle(req('/healthz'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok' });
    });
  });

  describe('GET /healthz/readiness', () => {
    it('returns 200 when no dependencies registered', async () => {
      const app = createApp();
      const res = await app.handle(req('/healthz/readiness'));
      expect(res.status).toBe(200);
      const body = (await res.json()) as ReadinessBody;
      expect(body.status).toBe('ok');
      expect(body.checks).toEqual({});
    });

    it('returns 200 when all dependencies are healthy', async () => {
      registerHealthDependency({
        name: 'db',
        check: async () => true,
      });
      registerHealthDependency({
        name: 'redis',
        check: async () => true,
      });

      const app = createApp();
      const res = await app.handle(req('/healthz/readiness'));
      expect(res.status).toBe(200);
      const body = (await res.json()) as ReadinessBody;
      expect(body.status).toBe('ok');
      expect(body.checks).toEqual({ db: 'ok', redis: 'ok' });
    });

    it('returns 503 when a dependency is unhealthy', async () => {
      registerHealthDependency({
        name: 'db',
        check: async () => true,
      });
      registerHealthDependency({
        name: 'redis',
        check: async () => false,
      });

      const app = createApp();
      const res = await app.handle(req('/healthz/readiness'));
      expect(res.status).toBe(503);
      const body = (await res.json()) as ReadinessBody;
      expect(body.status).toBe('error');
      expect(body.checks).toEqual({ db: 'ok', redis: 'error' });
    });

    it('returns 503 when a dependency check throws', async () => {
      registerHealthDependency({
        name: 'db',
        check: async () => {
          throw new Error('connection refused');
        },
      });

      const app = createApp();
      const res = await app.handle(req('/healthz/readiness'));
      expect(res.status).toBe(503);
      const body = (await res.json()) as ReadinessBody;
      expect(body.status).toBe('error');
      expect(body.checks).toEqual({ db: 'error' });
    });
  });
});
