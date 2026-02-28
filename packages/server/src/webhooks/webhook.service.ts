import type { WebhookRepo } from '@n0n/db';
import type { Webhook } from '@n0n/db';

/**
 * CRUD on the webhook DB table. Handles registration, deregistration,
 * and path matching (static paths first, then dynamic with :param segments).
 */
export class WebhookService {
  constructor(private webhookRepo: WebhookRepo) {}

  /**
   * Register a webhook for an active workflow.
   * Computes pathLength for dynamic path matching.
   */
  async registerWebhook(data: {
    workflowId: string;
    webhookPath: string;
    method: string;
    node: string;
    webhookId?: string;
  }): Promise<Webhook> {
    const pathSegments = data.webhookPath.split('/').filter(Boolean);
    const pathLength = pathSegments.length;
    const isDynamic = pathSegments.some((s) => s.startsWith(':'));

    return this.webhookRepo.create({
      workflowId: data.workflowId,
      webhookPath: data.webhookPath,
      method: data.method.toUpperCase(),
      node: data.node,
      webhookId: isDynamic ? (data.webhookId ?? null) : null,
      pathLength: isDynamic ? pathLength : null,
    });
  }

  /**
   * Remove all registered webhooks for a workflow (on deactivation or deletion).
   */
  async unregisterWorkflowWebhooks(workflowId: string): Promise<void> {
    await this.webhookRepo.deleteByWorkflowId(workflowId);
  }

  /**
   * Find a webhook matching the given method and path.
   * Tries static (exact) match first, falls back to dynamic matching.
   */
  async findWebhook(method: string, path: string): Promise<Webhook | undefined> {
    const normalizedPath = this.normalizePath(path);
    const normalizedMethod = method.toUpperCase();

    // Try exact static match first
    const staticMatch = await this.webhookRepo.findByPath(normalizedMethod, normalizedPath);
    if (staticMatch) return staticMatch;

    // Try dynamic match: look for webhooks with same method and matching path structure
    return this.findDynamicWebhook(normalizedMethod, normalizedPath);
  }

  /**
   * Find a dynamic webhook where registered path contains :param segments.
   * Dynamic webhooks use webhookId as the first path segment.
   */
  private async findDynamicWebhook(
    method: string,
    path: string,
  ): Promise<Webhook | undefined> {
    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) return undefined;

    // Fetch all webhooks for this method that match the workflowId prefix
    // Dynamic paths have a webhookId as the first segment, and pathLength tracks remaining segments
    const allWebhooks = await this.webhookRepo.findByMethod(method);

    for (const wh of allWebhooks) {
      if (!wh.webhookId) continue;

      // Dynamic webhook path format: webhookId/param1/:param2/...
      // Incoming path format: webhookId/value1/value2/...
      const webhookSegments = wh.webhookPath.split('/').filter(Boolean);
      const fullPattern = [wh.webhookId, ...webhookSegments];

      if (fullPattern.length !== segments.length) continue;
      if (fullPattern[0] !== segments[0]) continue;

      // Check that all static (non-param) segments match
      const allStaticMatch = fullPattern.every((pattern, i) => {
        if (pattern.startsWith(':')) return true;
        return pattern === segments[i];
      });

      if (allStaticMatch) return wh;
    }

    return undefined;
  }

  /**
   * Get allowed HTTP methods for a path (used in CORS responses).
   */
  async getWebhookMethods(path: string): Promise<string[]> {
    const normalizedPath = this.normalizePath(path);
    const webhooks = await this.webhookRepo.findAllByPath(normalizedPath);
    return webhooks.map((wh) => wh.method);
  }

  /**
   * Check if a webhook already exists for the given path and method.
   */
  async webhookExists(method: string, path: string): Promise<boolean> {
    const wh = await this.webhookRepo.findByPath(method.toUpperCase(), this.normalizePath(path));
    return wh !== undefined;
  }

  /**
   * Remove all webhooks (used on server shutdown or full reset).
   */
  async clearAll(): Promise<void> {
    await this.webhookRepo.deleteAll();
  }

  /**
   * Extract path parameters from a dynamic webhook path.
   * Returns a map of param names to values.
   */
  extractPathParams(
    webhookPath: string,
    requestPath: string,
    webhookId?: string | null,
  ): Record<string, string> {
    const params: Record<string, string> = {};

    const patternSegments = webhookPath.split('/').filter(Boolean);
    let requestSegments = requestPath.split('/').filter(Boolean);

    // If webhookId is present, skip the first segment (it's the webhookId)
    if (webhookId) {
      requestSegments = requestSegments.slice(1);
    }

    for (let i = 0; i < patternSegments.length; i++) {
      if (patternSegments[i].startsWith(':')) {
        const paramName = patternSegments[i].slice(1);
        params[paramName] = requestSegments[i] ?? '';
      }
    }

    return params;
  }

  private normalizePath(path: string): string {
    let normalized = path;
    if (normalized.startsWith('/')) normalized = normalized.slice(1);
    if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
    return normalized;
  }
}
