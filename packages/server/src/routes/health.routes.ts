import { Elysia } from 'elysia';

interface HealthCheckDependency {
  name: string;
  check: () => Promise<boolean>;
}

let dependencies: HealthCheckDependency[] = [];

export function registerHealthDependency(dep: HealthCheckDependency): void {
  dependencies.push(dep);
}

export function clearHealthDependencies(): void {
  dependencies = [];
}

export const healthRoutes = new Elysia()
  .get('/healthz', () => {
    return { status: 'ok' };
  })
  .get('/healthz/readiness', async ({ set }) => {
    const results: Record<string, string> = {};
    let allHealthy = true;

    for (const dep of dependencies) {
      try {
        const healthy = await dep.check();
        results[dep.name] = healthy ? 'ok' : 'error';
        if (!healthy) allHealthy = false;
      } catch {
        results[dep.name] = 'error';
        allHealthy = false;
      }
    }

    if (!allHealthy) {
      set.status = 503;
    }

    return {
      status: allHealthy ? 'ok' : 'error',
      checks: results,
    };
  });
