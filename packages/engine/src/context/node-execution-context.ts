import get from 'lodash/get';
import type {
  Workflow,
  INode,
  INodeExecutionData,
  IRunExecutionData,
  IWorkflowExecuteAdditionalData,
  ITaskDataConnections,
  WorkflowExecuteMode,
  IDataObject,
  NodeParameterValueType,
  IExecuteData,
  ICredentialDataDecryptedObject,
  ICredentialsExpressionResolveValues,
  INodeCredentialDescription,
  NodeConnectionType,
  ISourceData,
  ContextType,
  IContextObject,
  IWorkflowDataProxyData,
  INodeInputConfiguration,
  INodeOutputConfiguration,
  NodeTypeAndVersion,
  IWorkflowSettings,
} from 'n8n-workflow';
import {
  ApplicationError,
  deepCopy,
  NodeHelpers,
  NodeOperationError,
  NodeConnectionTypes,
  WorkflowDataProxy,
} from 'n8n-workflow';

import { getAdditionalKeys, type AdditionalKeysOptions } from '../expression';

export interface NodeExecutionContextOptions {
  workflow: Workflow;
  node: INode;
  additionalData: IWorkflowExecuteAdditionalData;
  mode: WorkflowExecuteMode;
  runExecutionData: IRunExecutionData | null;
  runIndex: number;
  connectionInputData: INodeExecutionData[];
  inputData: ITaskDataConnections;
  executeData?: IExecuteData;
  abortSignal?: AbortSignal;
  additionalKeysOptions?: AdditionalKeysOptions;
}

/**
 * Base class for all node execution contexts.
 *
 * Nodes receive a context object providing methods to access input data,
 * resolve parameters/expressions, retrieve credentials, etc.
 *
 * Modeled after n8n's NodeExecutionContext + BaseExecuteContext, merged into
 * a single base so subclasses (ExecuteContext, TriggerContext, etc.) only
 * need to extend one class.
 */
export class NodeExecutionContext {
  protected readonly workflow: Workflow;
  protected readonly node: INode;
  protected readonly additionalData: IWorkflowExecuteAdditionalData;
  protected readonly mode: WorkflowExecuteMode;
  protected readonly runExecutionData: IRunExecutionData | null;
  protected readonly runIndex: number;
  protected readonly connectionInputData: INodeExecutionData[];
  protected readonly inputData: ITaskDataConnections;
  protected readonly executeData?: IExecuteData;
  protected readonly abortSignal?: AbortSignal;

  private readonly _additionalKeys: ReturnType<typeof getAdditionalKeys>;
  private _nodeType: ReturnType<Workflow['nodeTypes']['getByNameAndVersion']> | undefined;

  constructor(options: NodeExecutionContextOptions) {
    this.workflow = options.workflow;
    this.node = options.node;
    this.additionalData = options.additionalData;
    this.mode = options.mode;
    this.runExecutionData = options.runExecutionData;
    this.runIndex = options.runIndex;
    this.connectionInputData = options.connectionInputData;
    this.inputData = options.inputData;
    this.executeData = options.executeData;
    this.abortSignal = options.abortSignal;

    this._additionalKeys = getAdditionalKeys(
      this.mode,
      this.runExecutionData,
      options.additionalKeysOptions,
    );
  }

  // -- Identity / metadata --

  getNode(): INode {
    return deepCopy(this.node);
  }

  getWorkflow(): { id: string; name: string | undefined; active: boolean } {
    return {
      id: this.workflow.id,
      name: this.workflow.name,
      active: this.workflow.active,
    };
  }

  getMode(): WorkflowExecuteMode {
    return this.mode;
  }

  getExecutionId(): string | undefined {
    return this.additionalData.executionId;
  }

  getTimezone(): string {
    return this.workflow.timezone;
  }

  getRestApiUrl(): string {
    return this.additionalData.restApiUrl;
  }

  getInstanceBaseUrl(): string {
    return this.additionalData.instanceBaseUrl;
  }

  getWorkflowSettings(): IWorkflowSettings {
    return Object.freeze(structuredClone(this.workflow.settings)) as IWorkflowSettings;
  }

  getWorkflowStaticData(type: string): IDataObject {
    return this.workflow.getStaticData(type, this.node);
  }

  // -- Node type info --

  protected get nodeType() {
    if (!this._nodeType) {
      const { type, typeVersion } = this.node;
      this._nodeType = this.workflow.nodeTypes.getByNameAndVersion(type, typeVersion);
    }
    return this._nodeType;
  }

  getNodeInputs(): INodeInputConfiguration[] {
    return NodeHelpers.getNodeInputs(this.workflow, this.node, this.nodeType.description).map(
      (input) => (typeof input === 'string' ? { type: input } : input),
    );
  }

  getNodeOutputs(): INodeOutputConfiguration[] {
    return NodeHelpers.getNodeOutputs(this.workflow, this.node, this.nodeType.description).map(
      (output) => (typeof output === 'string' ? { type: output } : output),
    );
  }

  // -- Graph traversal --

  getChildNodes(
    nodeName: string,
    options?: { includeNodeParameters?: boolean },
  ): NodeTypeAndVersion[] {
    const output: NodeTypeAndVersion[] = [];
    const nodeNames = this.workflow.getChildNodes(nodeName);

    for (const n of nodeNames) {
      const node = this.workflow.nodes[n];
      const entry: NodeTypeAndVersion = {
        name: node.name,
        type: node.type,
        typeVersion: node.typeVersion,
        disabled: node.disabled ?? false,
      };
      if (options?.includeNodeParameters) {
        entry.parameters = node.parameters;
      }
      output.push(entry);
    }
    return output;
  }

  getParentNodes(
    nodeName: string,
    options?: {
      includeNodeParameters?: boolean;
      connectionType?: NodeConnectionType;
      depth?: number;
    },
  ): NodeTypeAndVersion[] {
    const output: NodeTypeAndVersion[] = [];
    const nodeNames = this.workflow.getParentNodes(
      nodeName,
      options?.connectionType,
      options?.depth,
    );

    for (const n of nodeNames) {
      const node = this.workflow.nodes[n];
      const entry: NodeTypeAndVersion = {
        name: node.name,
        type: node.type,
        typeVersion: node.typeVersion,
        disabled: node.disabled ?? false,
      };
      if (options?.includeNodeParameters) {
        entry.parameters = node.parameters;
      }
      output.push(entry);
    }
    return output;
  }

  // -- Parameter resolution --

  getNodeParameter(
    parameterName: string,
    itemIndex: number,
    fallbackValue?: NodeParameterValueType,
  ): NodeParameterValueType | object {
    const { workflow, node, mode, runExecutionData, runIndex, connectionInputData, executeData } =
      this;

    const value = get(node.parameters, parameterName, fallbackValue);

    if (value === undefined) {
      throw new ApplicationError('Could not get parameter', { extra: { parameterName } });
    }

    const returnData = workflow.expression.getParameterValue(
      value,
      runExecutionData,
      runIndex,
      itemIndex,
      node.name,
      connectionInputData,
      mode,
      this._additionalKeys,
      executeData,
      false,
      {},
    );

    return returnData as NodeParameterValueType | object;
  }

  evaluateExpression(expression: string, itemIndex: number = 0): NodeParameterValueType {
    return this.workflow.expression.resolveSimpleParameterValue(
      `=${expression}`,
      {},
      this.runExecutionData,
      this.runIndex,
      itemIndex,
      this.node.name,
      this.connectionInputData,
      this.mode,
      this._additionalKeys,
      this.executeData,
    ) as NodeParameterValueType;
  }

  // -- Input data --

  getInputData(inputIndex = 0, connectionType: NodeConnectionType = NodeConnectionTypes.Main): INodeExecutionData[] {
    if (!this.inputData[connectionType]?.[inputIndex]) {
      return [];
    }
    return this.inputData[connectionType][inputIndex] ?? [];
  }

  getInputSourceData(
    inputIndex = 0,
    connectionType: NodeConnectionType = NodeConnectionTypes.Main,
  ): ISourceData {
    if (this.executeData?.source === null || this.executeData?.source === undefined) {
      throw new ApplicationError('Source data is missing');
    }
    return this.executeData.source[connectionType][inputIndex]!;
  }

  // -- Execution data proxy (for $json, $input, etc.) --

  getWorkflowDataProxy(itemIndex: number): IWorkflowDataProxyData {
    return new WorkflowDataProxy(
      this.workflow,
      this.runExecutionData,
      this.runIndex,
      itemIndex,
      this.node.name,
      this.connectionInputData,
      {},
      this.mode,
      this._additionalKeys,
      this.executeData,
    ).getDataProxy();
  }

  // -- Execution context / flow context --

  getExecuteData(): IExecuteData | undefined {
    return this.executeData;
  }

  getContext(type: ContextType): IContextObject {
    return NodeHelpers.getContext(this.runExecutionData!, type, this.node);
  }

  // -- Abort / cancellation --

  getExecutionCancelSignal(): AbortSignal | undefined {
    return this.abortSignal;
  }

  onExecutionCancellation(handler: () => unknown): void {
    const fn = () => {
      this.abortSignal?.removeEventListener('abort', fn);
      handler();
    };
    this.abortSignal?.addEventListener('abort', fn);
  }

  // -- Continue on fail --

  continueOnFail(): boolean {
    const onError = get(this.node, 'onError', undefined) as string | undefined;

    if (onError === undefined) {
      return get(this.node, 'continueOnFail', false) as boolean;
    }

    return ['continueRegularOutput', 'continueErrorOutput'].includes(onError);
  }

  // -- Credentials --

  protected async _getCredentials<T extends object = ICredentialDataDecryptedObject>(
    type: string,
    itemIndex?: number,
  ): Promise<T> {
    const { workflow, node, additionalData, mode, runExecutionData, runIndex, connectionInputData } = this;
    const nodeType = this.nodeType;

    let nodeCredentialDescription: INodeCredentialDescription | undefined;
    if (nodeType.description.credentials === undefined) {
      throw new NodeOperationError(
        node,
        `Node type "${node.type}" does not have any credentials defined`,
        { level: 'warning' },
      );
    }

    nodeCredentialDescription = nodeType.description.credentials.find(
      (credentialTypeDescription) => credentialTypeDescription.name === type,
    );
    if (nodeCredentialDescription === undefined) {
      throw new NodeOperationError(
        node,
        `Node type "${node.type}" does not have any credentials of type "${type}" defined`,
        { level: 'warning' },
      );
    }

    if (!node.credentials?.[type]) {
      if (nodeCredentialDescription.required === true) {
        if (!node.credentials) {
          throw new NodeOperationError(node, 'Node does not have any credentials set', {
            level: 'warning',
          });
        }
        throw new NodeOperationError(
          node,
          `Node does not have any credentials set for "${type}"`,
          { level: 'warning' },
        );
      } else {
        throw new NodeOperationError(node, 'Node does not require credentials');
      }
    }

    let expressionResolveValues: ICredentialsExpressionResolveValues | undefined;
    if (connectionInputData && runExecutionData && runIndex !== undefined) {
      expressionResolveValues = {
        connectionInputData,
        itemIndex: itemIndex ?? 0,
        node,
        runExecutionData,
        runIndex,
        workflow,
      } as ICredentialsExpressionResolveValues;
    }

    const nodeCredentials = node.credentials[type];

    const decryptedDataObject = await additionalData.credentialsHelper.getDecrypted(
      additionalData,
      nodeCredentials,
      type,
      mode,
      this.executeData,
      false,
      expressionResolveValues,
    );

    return decryptedDataObject as T;
  }

  // -- Output --

  async prepareOutputData(
    outputData: INodeExecutionData[],
  ): Promise<INodeExecutionData[][]> {
    return [outputData];
  }

  // -- Logger --

  readonly logger = {
    info: (message: string, meta?: Record<string, unknown>) => {
      console.log(`[${this.node.name}] ${message}`, meta ?? '');
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
      console.warn(`[${this.node.name}] ${message}`, meta ?? '');
    },
    error: (message: string, meta?: Record<string, unknown>) => {
      console.error(`[${this.node.name}] ${message}`, meta ?? '');
    },
    debug: (message: string, meta?: Record<string, unknown>) => {
      console.debug(`[${this.node.name}] ${message}`, meta ?? '');
    },
  };
}
