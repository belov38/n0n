/**
 * ExecuteContext — the `this` context for regular node execute() calls.
 *
 * Implements the core surface of IExecuteFunctions from n8n-workflow.
 * Extends NodeExecutionContext which provides FunctionsBase methods
 * (getNode, getWorkflow, getCredentials, continueOnFail, etc.).
 *
 * This is the most commonly used context — almost every node receives it.
 */
import type { Readable } from 'node:stream';
import type {
  AiEvent,
  IBinaryData,
  ICredentialDataDecryptedObject,
  IDataObject,
  IHttpRequestOptions,
  INodeExecutionData,
  IPairedItemData,
  ITaskMetadata,
  NodeExecutionWithMetadata,
} from 'n8n-workflow';
import { deepCopy } from 'n8n-workflow';
import { NodeExecutionContext, type NodeExecutionContextOptions } from './node-execution-context';
import {
  httpRequest,
  prepareBinaryData,
  getBinaryDataBuffer,
} from './helpers';

// ---------------------------------------------------------------------------
// Helpers (pure functions used by the helpers object)
// ---------------------------------------------------------------------------

function returnJsonArray(jsonData: IDataObject | IDataObject[]): INodeExecutionData[] {
  const arr = Array.isArray(jsonData) ? jsonData : [jsonData];
  return arr.map((data: IDataObject & { json?: IDataObject }) =>
    data?.json ? { ...data, json: data.json } : { json: data },
  );
}

function constructExecutionMetaData(
  inputData: INodeExecutionData[],
  options: { itemData: IPairedItemData | IPairedItemData[] },
): NodeExecutionWithMetadata[] {
  const { itemData } = options;
  return inputData.map((data) => {
    const { json, ...rest } = data;
    return { json, pairedItem: itemData, ...rest } as NodeExecutionWithMetadata;
  });
}

function normalizeItems(
  executionData: INodeExecutionData | INodeExecutionData[],
): INodeExecutionData[] {
  if (typeof executionData === 'object' && !Array.isArray(executionData)) {
    executionData = executionData.json
      ? [executionData]
      : [{ json: executionData as IDataObject }];
  }

  if (executionData.every((item) => typeof item === 'object' && 'json' in item)) {
    return executionData;
  }
  if (executionData.some((item) => typeof item === 'object' && 'json' in item)) {
    throw new Error('Inconsistent item format');
  }
  if (executionData.every((item) => typeof item === 'object' && 'binary' in item)) {
    return executionData.map((item) => {
      const json = Object.keys(item).reduce<IDataObject>((acc, key) => {
        if (key === 'binary') return acc;
        return { ...acc, [key]: item[key] };
      }, {});
      return { json, binary: item.binary };
    });
  }
  if (executionData.some((item) => typeof item === 'object' && 'binary' in item)) {
    throw new Error('Inconsistent item format');
  }
  return executionData.map((item) => ({ json: item }));
}

function copyInputItems(items: INodeExecutionData[], properties: string[]): IDataObject[] {
  return items.map((item) => {
    const newItem: IDataObject = {};
    for (const property of properties) {
      newItem[property] =
        item.json[property] === undefined ? null : deepCopy(item.json[property]);
    }
    return newItem;
  });
}

// ---------------------------------------------------------------------------
// ExecuteContext
// ---------------------------------------------------------------------------

export class ExecuteContext extends NodeExecutionContext {
  readonly helpers: {
    httpRequest(options: IHttpRequestOptions): Promise<unknown>;
    returnJsonArray(jsonData: IDataObject | IDataObject[]): INodeExecutionData[];
    normalizeItems(items: INodeExecutionData | INodeExecutionData[]): INodeExecutionData[];
    constructExecutionMetaData(
      inputData: INodeExecutionData[],
      options: { itemData: IPairedItemData | IPairedItemData[] },
    ): NodeExecutionWithMetadata[];
    copyInputItems(items: INodeExecutionData[], properties: string[]): IDataObject[];
    prepareBinaryData(
      binaryData: Buffer,
      fileName?: string,
      mimeType?: string,
    ): Promise<IBinaryData>;
    assertBinaryData(itemIndex: number, propertyName: string): IBinaryData;
    getBinaryDataBuffer(
      itemIndex: number,
      propertyName: string,
    ): Promise<Buffer>;
    binaryToBuffer(body: Buffer | Readable): Promise<Buffer>;
    binaryToString(body: Buffer | Readable, encoding?: BufferEncoding): Promise<string>;
  };

  constructor(options: NodeExecutionContextOptions) {
    super(options);
    this.helpers = this._buildHelpers();
  }

  // -------------------------------------------------------------------------
  // Credentials (delegates to base _getCredentials with itemIndex support)
  // -------------------------------------------------------------------------

  async getCredentials<T extends object = ICredentialDataDecryptedObject>(
    type: string,
    itemIndex?: number,
  ): Promise<T> {
    return this._getCredentials<T>(type, itemIndex);
  }

  // -------------------------------------------------------------------------
  // Execution metadata
  // -------------------------------------------------------------------------

  setMetadata(metadata: ITaskMetadata): void {
    if (!this.executeData) {
      throw new Error('Execute data is not available');
    }
    this.executeData.metadata = {
      ...(this.executeData.metadata ?? {}),
      ...metadata,
    };
  }

  // -------------------------------------------------------------------------
  // Push / UI messaging
  // -------------------------------------------------------------------------

  sendMessageToUI(...args: unknown[]): void {
    if (this.mode !== 'manual') return;
    try {
      if (this.additionalData.sendDataToUI) {
        this.additionalData.sendDataToUI('sendConsoleMessage', {
          source: `[Node: "${this.node.name}"]`,
          messages: args,
        });
      }
    } catch {
      // Silently ignore push errors
    }
  }

  logAiEvent(eventName: AiEvent, msg?: string): void {
    this.additionalData.logAiEvent(eventName, {
      executionId: this.additionalData.executionId ?? 'unsaved-execution',
      nodeName: this.node.name,
      workflowName: this.workflow.name ?? 'Unnamed workflow',
      nodeType: this.node.type,
      workflowId: this.workflow.id ?? 'unsaved-workflow',
      msg: msg ?? '',
    });
  }

  /** Send data to waiting webhook response (wired via hooks at runtime) */
  async sendResponse(_response: unknown): Promise<void> {
    // Will be connected to execution lifecycle hooks when the server wires up
    // the webhook response promise. No-op until then.
  }

  /** Put execution into a waiting state */
  async putExecutionToWait(waitTill: Date): Promise<void> {
    if (!this.runExecutionData) {
      throw new Error('Run execution data is not available');
    }
    this.runExecutionData.waitTill = waitTill;
    if (this.additionalData.setExecutionStatus) {
      this.additionalData.setExecutionStatus('waiting');
    }
  }

  /** Log node output (Code node console.log support) */
  logNodeOutput(...args: unknown[]): void {
    if (this.mode === 'manual') {
      this.sendMessageToUI(...args);
      return;
    }
    if (process.env.CODE_ENABLE_STDOUT === 'true') {
      console.log(`[Workflow "${this.getWorkflow().id}"][Node "${this.node.name}"]`, ...args);
    }
  }

  // -------------------------------------------------------------------------
  // Private: build helpers object
  // -------------------------------------------------------------------------

  private _buildHelpers() {
    const self = this;
    return {
      httpRequest,
      returnJsonArray,
      normalizeItems,
      constructExecutionMetaData,
      copyInputItems,
      prepareBinaryData,

      assertBinaryData(itemIndex: number, propertyName: string): IBinaryData {
        const items = self.getInputData();
        const item = items[itemIndex];
        if (!item?.binary?.[propertyName]) {
          throw new Error(
            `No binary data found for property "${propertyName}" at item index ${itemIndex}`,
          );
        }
        return item.binary[propertyName];
      },

      async getBinaryDataBuffer(
        itemIndex: number,
        propertyName: string,
      ): Promise<Buffer> {
        const binaryData = self.helpers.assertBinaryData(itemIndex, propertyName);
        return getBinaryDataBuffer(binaryData);
      },

      async binaryToBuffer(body: Buffer | Readable): Promise<Buffer> {
        if (Buffer.isBuffer(body)) return body;
        const chunks: Buffer[] = [];
        for await (const chunk of body) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        return Buffer.concat(chunks);
      },

      async binaryToString(body: Buffer | Readable, encoding?: BufferEncoding): Promise<string> {
        const buffer = await self.helpers.binaryToBuffer(body);
        return buffer.toString(encoding ?? 'utf-8');
      },
    };
  }
}
