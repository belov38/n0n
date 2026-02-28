import type { LiveWebhooks } from './live-webhooks';
import type { TestWebhooks } from './test-webhooks';
import type { WaitingWebhooks } from './waiting-webhooks';

export type WebhookResponseMode = 'onReceived' | 'lastNode' | 'responseNode';

export interface WebhookResult {
  executionId?: string;
  responseData?: Record<string, unknown>;
  responseCode?: number;
  responseHeaders?: Record<string, string>;
}

const SUPPORTED_METHODS = new Set([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
]);

const DEFAULT_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept',
  'Access-Control-Max-Age': '300',
};

/**
 * Central request handler for all webhook types (production, test, waiting).
 * Handles CORS preflight, method validation, dispatches to the correct handler,
 * and wraps errors into proper HTTP responses.
 */
export class WebhookRequestHandler {
  constructor(
    private liveWebhooks: LiveWebhooks,
    private testWebhooks: TestWebhooks,
    private waitingWebhooks: WaitingWebhooks,
  ) {}

  /**
   * Main entry point called from webhook routes.
   * Validates method, handles CORS, dispatches by type, catches errors.
   */
  async handleRequest(
    method: string,
    path: string,
    request: Request,
    type: 'production' | 'test' | 'waiting',
  ): Promise<Response> {
    const upperMethod = method.toUpperCase();

    // Validate HTTP method
    if (!SUPPORTED_METHODS.has(upperMethod)) {
      return this.errorResponse(405, `Method ${method} is not supported`, {
        Allow: Array.from(SUPPORTED_METHODS).join(', '),
      });
    }

    // Handle CORS preflight
    if (upperMethod === 'OPTIONS') {
      return this.handleCorsPreflightRequest(request, path, type);
    }

    try {
      switch (type) {
        case 'waiting':
          return await this.handleWaitingWebhook(path, request);

        case 'test':
          return await this.handleTestWebhook(upperMethod, path, request);

        case 'production':
          return await this.handleProductionWebhook(upperMethod, path, request);

        default:
          return this.errorResponse(400, `Unknown webhook type: ${type}`);
      }
    } catch (error) {
      return this.handleError(error);
    }
  }

  // -- CORS ------------------------------------------------------------------

  /**
   * Handle CORS preflight (OPTIONS) requests.
   * Tries to determine allowed methods from registered webhooks.
   */
  private async handleCorsPreflightRequest(
    request: Request,
    path: string,
    type: 'production' | 'test' | 'waiting',
  ): Promise<Response> {
    const origin = request.headers.get('origin');
    const headers: Record<string, string> = { ...DEFAULT_CORS_HEADERS };

    if (origin) {
      headers['Access-Control-Allow-Origin'] = origin;
    }

    // Try to restrict Access-Control-Allow-Methods to actual registered methods
    if (type === 'production') {
      try {
        const methods = await this.liveWebhooks.getWebhookMethods(path);
        if (methods.length > 0) {
          headers['Access-Control-Allow-Methods'] = ['OPTIONS', ...methods].join(', ');
        }
      } catch {
        // Fall through to default headers
      }
    }

    // Echo back requested headers
    const requestedHeaders = request.headers.get('access-control-request-headers');
    if (requestedHeaders) {
      headers['Access-Control-Allow-Headers'] = requestedHeaders;
    }

    return new Response(null, { status: 204, headers });
  }

  /**
   * Add CORS headers to an existing headers object based on the request origin.
   */
  private addCorsHeaders(
    responseHeaders: Record<string, string>,
    request: Request,
  ): Record<string, string> {
    const origin = request.headers.get('origin');
    if (origin) {
      responseHeaders['Access-Control-Allow-Origin'] = origin;
    } else {
      responseHeaders['Access-Control-Allow-Origin'] = '*';
    }
    return responseHeaders;
  }

  // -- Production Webhooks ---------------------------------------------------

  private async handleProductionWebhook(
    method: string,
    path: string,
    request: Request,
  ): Promise<Response> {
    const webhook = await this.liveWebhooks.findWebhook(method, path);
    if (!webhook) {
      return this.webhookNotFoundResponse(method, path);
    }

    // Determine response mode from webhook node configuration
    const responseMode = this.getResponseMode(webhook.node);

    const result = await this.liveWebhooks.executeWebhook(webhook, request, responseMode);
    return this.buildResponse(result, responseMode, request);
  }

  // -- Test Webhooks ---------------------------------------------------------

  private async handleTestWebhook(
    method: string,
    path: string,
    request: Request,
  ): Promise<Response> {
    const registration = this.testWebhooks.find(method, path);
    if (!registration) {
      return this.errorResponse(404, 'Test webhook not found or expired');
    }

    const result = await this.testWebhooks.executeWebhook(registration, request);
    return this.buildResponse(result, 'lastNode', request);
  }

  // -- Waiting Webhooks ------------------------------------------------------

  private async handleWaitingWebhook(
    executionId: string,
    request: Request,
  ): Promise<Response> {
    return this.waitingWebhooks.handleRequest(executionId, request);
  }

  // -- Response Building -----------------------------------------------------

  /**
   * Build an HTTP response from a WebhookResult based on the response mode.
   */
  buildResponse(
    result: WebhookResult,
    responseMode: WebhookResponseMode,
    request?: Request,
  ): Response {
    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (request) {
      this.addCorsHeaders(baseHeaders, request);
    }

    // 'onReceived' mode: return immediately with executionId
    if (responseMode === 'onReceived') {
      return new Response(
        JSON.stringify({ success: true, executionId: result.executionId }),
        { status: 200, headers: baseHeaders },
      );
    }

    // If the execution returned response data (lastNode or responseNode modes)
    if (result.responseData) {
      const finalHeaders = {
        ...baseHeaders,
        ...(result.responseHeaders ?? {}),
      };

      return new Response(
        JSON.stringify(result.responseData),
        {
          status: result.responseCode ?? 200,
          headers: finalHeaders,
        },
      );
    }

    // Default: success with executionId
    return new Response(
      JSON.stringify({ success: true, executionId: result.executionId }),
      { status: 200, headers: baseHeaders },
    );
  }

  // -- Error Handling --------------------------------------------------------

  private handleError(error: unknown): Response {
    // Check for WaitingWebhookError (carries its own status code)
    if (this.isWaitingWebhookError(error)) {
      return this.errorResponse(error.statusCode, error.message);
    }

    const message = error instanceof Error ? error.message : 'Internal webhook error';
    const status = this.inferStatusCode(error);

    console.error('Webhook error:', error);

    return this.errorResponse(status, message);
  }

  private inferStatusCode(error: unknown): number {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('not found')) return 404;
      if (msg.includes('not active')) return 422;
      if (msg.includes('already running')) return 409;
      if (msg.includes('already finished')) return 409;
    }
    return 500;
  }

  private isWaitingWebhookError(error: unknown): error is { statusCode: number; message: string } {
    return (
      error instanceof Error &&
      'statusCode' in error &&
      typeof (error as Record<string, unknown>).statusCode === 'number'
    );
  }

  private errorResponse(
    status: number,
    message: string,
    extraHeaders?: Record<string, string>,
  ): Response {
    return new Response(
      JSON.stringify({ error: message }),
      {
        status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          ...(extraHeaders ?? {}),
        },
      },
    );
  }

  private webhookNotFoundResponse(method: string, path: string): Response {
    return this.errorResponse(
      404,
      `The "${method}" webhook for path "${path}" is not registered`,
    );
  }

  /**
   * Determine the response mode for a webhook. In the future this will read from
   * the node parameters; for now, default to 'lastNode'.
   */
  private getResponseMode(_nodeName: string): WebhookResponseMode {
    // TODO: Read from workflow node parameters once node config is wired
    return 'lastNode';
  }
}
