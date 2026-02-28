import type {
  INodeExecutionData,
  ICredentialDataDecryptedObject,
  IDataObject,
  IHttpRequestOptions,
  WorkflowActivateMode,
  IDeferredPromise,
  IExecuteResponsePromiseData,
  IRun,
  ExecutionError,
  NodeParameterValueType,
} from 'n8n-workflow';
import { ApplicationError, createDeferredPromise } from 'n8n-workflow';
import { NodeExecutionContext, type NodeExecutionContextOptions } from './node-execution-context';

export interface TriggerContextOptions extends NodeExecutionContextOptions {
  activation: WorkflowActivateMode;
  emit?: (
    data: INodeExecutionData[][],
    responsePromise?: IDeferredPromise<IExecuteResponsePromiseData>,
    donePromise?: IDeferredPromise<IRun>,
  ) => void;
  emitError?: (
    error: Error,
    responsePromise?: IDeferredPromise<IExecuteResponsePromiseData>,
  ) => void;
  saveFailedExecution?: (error: ExecutionError) => void;
}

const throwOnEmit = () => {
  throw new ApplicationError('Overwrite TriggerContext.emit function');
};

const throwOnEmitError = () => {
  throw new ApplicationError('Overwrite TriggerContext.emitError function');
};

const throwOnSaveFailedExecution = () => {
  throw new ApplicationError('Overwrite TriggerContext.saveFailedExecution function');
};

/**
 * Context provided to trigger nodes (Schedule Trigger, Webhook Trigger, etc.)
 * as `this` during execution.
 */
export class TriggerContext extends NodeExecutionContext {
  private readonly activation: WorkflowActivateMode;
  private readonly emitFn: TriggerContextOptions['emit'];
  private readonly emitErrorFn: TriggerContextOptions['emitError'];
  private readonly saveFailedExecutionFn: TriggerContextOptions['saveFailedExecution'];

  readonly helpers: {
    createDeferredPromise: <T = void>() => IDeferredPromise<T>;
    returnJsonArray(jsonData: IDataObject | IDataObject[]): INodeExecutionData[];
    httpRequest(options: IHttpRequestOptions): Promise<unknown>;
  };

  constructor(options: TriggerContextOptions) {
    super(options);
    this.activation = options.activation;
    this.emitFn = options.emit ?? throwOnEmit;
    this.emitErrorFn = options.emitError ?? throwOnEmitError;
    this.saveFailedExecutionFn = options.saveFailedExecution ?? throwOnSaveFailedExecution;

    this.helpers = {
      createDeferredPromise,
      returnJsonArray,
      httpRequest,
    };
  }

  getActivationMode(): WorkflowActivateMode {
    return this.activation;
  }

  emit(
    data: INodeExecutionData[][],
    responsePromise?: IDeferredPromise<IExecuteResponsePromiseData>,
    donePromise?: IDeferredPromise<IRun>,
  ): void {
    this.emitFn!(data, responsePromise, donePromise);
  }

  emitError(
    error: Error,
    responsePromise?: IDeferredPromise<IExecuteResponsePromiseData>,
  ): void {
    this.emitErrorFn!(error, responsePromise);
  }

  saveFailedExecution(error: ExecutionError): void {
    this.saveFailedExecutionFn!(error);
  }

  async getCredentials<T extends object = ICredentialDataDecryptedObject>(
    type: string,
  ): Promise<T> {
    return this._getCredentials<T>(type);
  }

  // Trigger nodes don't have input items, so itemIndex is always 0
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
