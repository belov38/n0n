import type {
  INodeExecutionData,
  ICredentialDataDecryptedObject,
  IDataObject,
  IHttpRequestOptions,
  WorkflowActivateMode,
  IDeferredPromise,
  IExecuteResponsePromiseData,
  NodeParameterValueType,
} from 'n8n-workflow';
import { ApplicationError, createDeferredPromise } from 'n8n-workflow';
import { NodeExecutionContext, type NodeExecutionContextOptions } from './node-execution-context';

export interface PollContextOptions extends NodeExecutionContextOptions {
  activation: WorkflowActivateMode;
  __emit?: (
    data: INodeExecutionData[][],
    responsePromise?: IDeferredPromise<IExecuteResponsePromiseData>,
  ) => void;
  __emitError?: (
    error: Error,
    responsePromise?: IDeferredPromise<IExecuteResponsePromiseData>,
  ) => void;
}

const throwOnEmit = () => {
  throw new ApplicationError('Overwrite PollContext.__emit function');
};

const throwOnEmitError = () => {
  throw new ApplicationError('Overwrite PollContext.__emitError function');
};

/**
 * Context provided to poll-based trigger nodes as `this`.
 * Poll nodes check for new data on a schedule (e.g. check email, RSS feed).
 */
export class PollContext extends NodeExecutionContext {
  private readonly activation: WorkflowActivateMode;
  private readonly __emitFn: PollContextOptions['__emit'];
  private readonly __emitErrorFn: PollContextOptions['__emitError'];

  readonly helpers: {
    createDeferredPromise: <T = void>() => IDeferredPromise<T>;
    returnJsonArray(jsonData: IDataObject | IDataObject[]): INodeExecutionData[];
    httpRequest(options: IHttpRequestOptions): Promise<unknown>;
  };

  constructor(options: PollContextOptions) {
    super(options);
    this.activation = options.activation;
    this.__emitFn = options.__emit ?? throwOnEmit;
    this.__emitErrorFn = options.__emitError ?? throwOnEmitError;

    this.helpers = {
      createDeferredPromise,
      returnJsonArray,
      httpRequest,
    };
  }

  getActivationMode(): WorkflowActivateMode {
    return this.activation;
  }

  __emit(
    data: INodeExecutionData[][],
    responsePromise?: IDeferredPromise<IExecuteResponsePromiseData>,
  ): void {
    this.__emitFn!(data, responsePromise);
  }

  __emitError(
    error: Error,
    responsePromise?: IDeferredPromise<IExecuteResponsePromiseData>,
  ): void {
    this.__emitErrorFn!(error, responsePromise);
  }

  async getCredentials<T extends object = ICredentialDataDecryptedObject>(
    type: string,
  ): Promise<T> {
    return this._getCredentials<T>(type);
  }

  // Poll nodes don't have input items, so itemIndex is always 0
  getNodeParameter(
    parameterName: string,
    fallbackValue?: NodeParameterValueType,
  ): NodeParameterValueType | object {
    return super.getNodeParameter(parameterName, 0, fallbackValue);
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
