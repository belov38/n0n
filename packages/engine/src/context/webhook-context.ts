import type {
  INodeExecutionData,
  ICredentialDataDecryptedObject,
  IDataObject,
  IHttpRequestOptions,
  IWebhookData,
  NodeParameterValueType,
  IDeferredPromise,
  WebhookType,
} from 'n8n-workflow';
import { createDeferredPromise } from 'n8n-workflow';
import { NodeExecutionContext, type NodeExecutionContextOptions } from './node-execution-context';

export interface WebhookContextOptions extends NodeExecutionContextOptions {
  webhookData: IWebhookData;
  request: Request;
  response: {
    status: number;
    headers: Record<string, string>;
    body?: unknown;
  };
}

/**
 * Context provided to webhook nodes as `this` when handling incoming HTTP requests.
 */
export class WebhookContext extends NodeExecutionContext {
  private readonly webhookData: IWebhookData;
  private readonly request: Request;
  private readonly responseObj: WebhookContextOptions['response'];

  readonly helpers: {
    createDeferredPromise: <T = void>() => IDeferredPromise<T>;
    returnJsonArray(jsonData: IDataObject | IDataObject[]): INodeExecutionData[];
    httpRequest(options: IHttpRequestOptions): Promise<unknown>;
  };

  constructor(options: WebhookContextOptions) {
    // If we have run execution data, try to extract connection input data
    let connectionInputData = options.connectionInputData;
    let executeData = options.executeData;

    if (
      options.runExecutionData?.executionData !== undefined &&
      options.connectionInputData.length === 0
    ) {
      const stackEntry =
        options.runExecutionData.executionData.nodeExecutionStack[0];
      if (stackEntry !== undefined) {
        connectionInputData = stackEntry.data.main[0] ?? [];
        executeData = stackEntry;
      }
    }

    super({
      ...options,
      connectionInputData,
      executeData,
    });

    this.webhookData = options.webhookData;
    this.request = options.request;
    this.responseObj = options.response;

    this.helpers = {
      createDeferredPromise,
      returnJsonArray,
      httpRequest,
    };
  }

  async getCredentials<T extends object = ICredentialDataDecryptedObject>(
    type: string,
  ): Promise<T> {
    return this._getCredentials<T>(type);
  }

  getBodyData(): IDataObject {
    // Body should be pre-parsed by the server framework before constructing the context
    return (this.request as Request & { parsedBody?: IDataObject }).parsedBody ?? {};
  }

  getHeaderData(): Record<string, string> {
    const headers: Record<string, string> = {};
    this.request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }

  getParamsData(): IDataObject {
    // Path params are extracted by the router and stored on webhookData
    return (
      (this.webhookData as IWebhookData & { pathParams?: IDataObject }).pathParams ?? {}
    );
  }

  getQueryData(): IDataObject {
    const url = new URL(this.request.url);
    const params: IDataObject = {};
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    return params;
  }

  getRequestObject(): Request {
    return this.request;
  }

  getResponseObject(): WebhookContextOptions['response'] {
    return this.responseObj;
  }

  getWebhookName(): string {
    return this.webhookData.webhookDescription.name;
  }

  getNodeWebhookUrl(name: WebhookType): string | undefined {
    const { workflow, node, additionalData, mode } = this;
    const webhookDescription = node.parameters.webhooks as
      | Record<string, { path?: string }>
      | undefined;

    if (!webhookDescription?.[name]) {
      return undefined;
    }

    const path = webhookDescription[name].path;
    if (!path) return undefined;

    const baseUrl = additionalData.webhookBaseUrl ?? additionalData.instanceBaseUrl;
    return `${baseUrl}/webhook/${path}`;
  }

  // Webhook nodes typically use itemIndex=0
  getNodeParameter(
    parameterName: string,
    fallbackValue?: NodeParameterValueType,
  ): NodeParameterValueType | object;
  getNodeParameter(
    parameterName: string,
    itemIndex: number,
    fallbackValue?: NodeParameterValueType,
  ): NodeParameterValueType | object;
  getNodeParameter(
    parameterName: string,
    itemIndexOrFallback?: number | NodeParameterValueType,
    fallbackValue?: NodeParameterValueType,
  ): NodeParameterValueType | object {
    if (typeof itemIndexOrFallback === 'number') {
      return super.getNodeParameter(parameterName, itemIndexOrFallback, fallbackValue);
    }
    return super.getNodeParameter(parameterName, 0, itemIndexOrFallback);
  }
}

// -- Shared helper implementations --

function returnJsonArray(
  jsonData: IDataObject | IDataObject[],
): INodeExecutionData[] {
  const dataArray = Array.isArray(jsonData) ? jsonData : [jsonData];
  return dataArray.map((data) => {
    if ((data as IDataObject & { json?: IDataObject }).json) {
      return { ...data, json: (data as IDataObject & { json: IDataObject }).json } as INodeExecutionData;
    }
    return { json: data };
  });
}

async function httpRequest(options: IHttpRequestOptions): Promise<unknown> {
  const response = await fetch(options.url, {
    method: options.method ?? 'GET',
    headers: options.headers as Record<string, string> | undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return response.json();
}
