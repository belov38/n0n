import { Elysia } from 'elysia';
import type { WebhookRequestHandler } from '../webhooks/webhook-request-handler';

export function createWebhookRoutes(handler: WebhookRequestHandler) {
  return new Elysia()
    // Production webhooks
    .all('/webhook/*', async ({ request }) => {
      const url = new URL(request.url);
      const path = url.pathname.replace('/webhook/', '');
      return handler.handleRequest(request.method, path, request, 'production');
    })
    // Test webhooks (editor "Listen for Test Event")
    .all('/webhook-test/*', async ({ request }) => {
      const url = new URL(request.url);
      const path = url.pathname.replace('/webhook-test/', '');
      return handler.handleRequest(request.method, path, request, 'test');
    })
    // Waiting webhooks (resume paused execution)
    .all('/webhook-waiting/:executionId', async ({ request, params }) => {
      return handler.handleRequest(request.method, params.executionId, request, 'waiting');
    })
    .all('/webhook-waiting/:executionId/*', async ({ request, params }) => {
      return handler.handleRequest(request.method, params.executionId, request, 'waiting');
    });
}
