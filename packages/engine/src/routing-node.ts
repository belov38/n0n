/**
 * RoutingNode — declarative node executor for "routing" type nodes.
 *
 * These nodes describe their HTTP calls via declarative properties
 * (requestDefaults, routing.request, routing.send, routing.output)
 * instead of imperative execute() code.
 *
 * Based on n8n's RoutingNode (packages/core/src/execution-engine/routing-node.ts)
 * with a simplified implementation covering the common patterns.
 */
import get from 'lodash/get';
import merge from 'lodash/merge';
import set from 'lodash/set';
import {
  NodeHelpers,
  NodeApiError,
  NodeOperationError,
  NodeConnectionTypes,
} from 'n8n-workflow';
import type {
  ICredentialDataDecryptedObject,
  ICredentialsDecrypted,
  IHttpRequestOptions,
  IN8nHttpFullResponse,
  INodeExecutionData,
  INodeType,
  DeclarativeRestApiSettings,
  IWorkflowDataProxyAdditionalKeys,
  NodeParameterValue,
  IDataObject,
  IExecuteData,
  IN8nRequestOperations,
  IN8nRequestOperationPaginationGeneric,
  IN8nRequestOperationPaginationOffset,
  INodeProperties,
  INodePropertyOptions,
  INodePropertyCollection,
  NodeParameterValueType,
  PostReceiveAction,
  JsonObject,
  INodeCredentialDescription,
  INodeParameters,
} from 'n8n-workflow';

import type { ExecuteContext } from './context/execute-context';

// ---------------------------------------------------------------------------
// Helper: single-item context adapter
// ---------------------------------------------------------------------------

/**
 * Lightweight adapter that gives per-item parameter access.
 * Used wherever the n8n reference passes IExecuteSingleFunctions.
 */
interface SingleItemContext {
  getNodeParameter(
    name: string,
    fallback?: NodeParameterValueType,
    options?: { extractValue?: boolean },
  ): NodeParameterValueType | object;
  getExecuteData(): IExecuteData | undefined;
  continueOnFail(): boolean;
  helpers: ExecuteContext['helpers'];
}

function makeSingleItemContext(
  context: ExecuteContext,
  itemIndex: number,
): SingleItemContext {
  return {
    getNodeParameter(
      name: string,
      fallback?: NodeParameterValueType,
      _options?: { extractValue?: boolean },
    ) {
      return context.getNodeParameter(name, itemIndex, fallback);
    },
    getExecuteData() {
      return context.getExecuteData();
    },
    continueOnFail() {
      return context.continueOnFail();
    },
    helpers: context.helpers,
  };
}

// ---------------------------------------------------------------------------
// RoutingNode
// ---------------------------------------------------------------------------

export class RoutingNode {
  constructor(
    private readonly context: ExecuteContext,
    private readonly nodeType: INodeType,
    private readonly credentialsDecrypted?: ICredentialsDecrypted,
  ) {}

  async runNode(): Promise<INodeExecutionData[][] | undefined> {
    const { context, nodeType } = this;
    const items = context.getInputData(0, NodeConnectionTypes.Main);
    const returnData: INodeExecutionData[] = [];

    const { credentials, credentialDescription } = await this.prepareCredentials();

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const singleCtx = makeSingleItemContext(context, itemIndex);

      const requestData: DeclarativeRestApiSettings.ResultOptions = {
        options: {
          qs: {},
          body: {},
          headers: {},
        },
        preSend: [],
        postReceive: [],
        requestOperations: {},
      };

      // Apply requestOperations from description
      if (nodeType.description.requestOperations) {
        requestData.requestOperations = {
          ...nodeType.description.requestOperations,
        };
      }

      // Apply requestDefaults from description
      if (nodeType.description.requestDefaults) {
        for (const key of Object.keys(nodeType.description.requestDefaults)) {
          let value = (
            nodeType.description.requestDefaults as Record<string, NodeParameterValueType>
          )[key];
          value = this.getParameterValue(
            value,
            itemIndex,
            { $credentials: credentials, $version: context.getNode().typeVersion },
          );
          (requestData.options as Record<string, NodeParameterValueType>)[key] = value;
        }
      }

      // Process each property's routing config
      const node = context.getNode();
      for (const property of nodeType.description.properties) {
        let value = get(node.parameters, property.name, []) as string | NodeParameterValue;
        value = this.getParameterValue(
          value,
          itemIndex,
          { $credentials: credentials, $version: node.typeVersion },
        ) as string | NodeParameterValue;

        const tempOptions = this.getRequestOptionsFromParameters(
          singleCtx,
          property,
          itemIndex,
          '',
          { $credentials: credentials, $value: value, $version: node.typeVersion },
        );

        this.mergeOptions(requestData, tempOptions);
      }

      // Default timeout: 5 minutes
      if (!requestData.options.timeout) {
        requestData.options.timeout = 300_000;
      }

      try {
        const responseItems = await this.makeRequest(
          requestData,
          singleCtx,
          itemIndex,
          credentialDescription?.name,
          requestData.requestOperations,
        );

        if (requestData.maxResults) {
          responseItems.splice(requestData.maxResults as number);
        }

        returnData.push(...responseItems);
      } catch (error) {
        if (singleCtx.continueOnFail()) {
          returnData.push({ json: {}, error: error as NodeApiError });
          continue;
        }

        const node = context.getNode();
        if (error instanceof NodeApiError) {
          set(error, 'context.itemIndex', itemIndex);
          throw error;
        }

        throw new NodeApiError(node, error as JsonObject, {
          itemIndex,
          message: (error as Error)?.message,
          description: (error as NodeApiError)?.description ?? undefined,
        });
      }
    }

    return [returnData];
  }

  // ---------------------------------------------------------------------------
  // Request building from declarative properties
  // ---------------------------------------------------------------------------

  private getRequestOptionsFromParameters(
    singleCtx: SingleItemContext,
    nodeProperties: INodeProperties | INodePropertyOptions,
    itemIndex: number,
    path: string,
    additionalKeys?: IWorkflowDataProxyAdditionalKeys,
  ): DeclarativeRestApiSettings.ResultOptions | undefined {
    const returnData: DeclarativeRestApiSettings.ResultOptions = {
      options: {
        qs: {},
        body: {},
        headers: {},
      },
      preSend: [],
      postReceive: [],
      requestOperations: {},
    };
    let basePath = path ? `${path}.` : '';
    const node = this.context.getNode();

    // Check display condition
    if (
      !NodeHelpers.displayParameter(
        node.parameters,
        nodeProperties,
        node,
        this.nodeType.description,
        node.parameters,
      )
    ) {
      return undefined;
    }

    if (nodeProperties.routing) {
      let parameterValue: string | undefined;
      if (basePath + nodeProperties.name && 'type' in nodeProperties) {
        const shouldExtractValue =
          (nodeProperties as INodeProperties).extractValue !== undefined ||
          (nodeProperties as INodeProperties).type === 'resourceLocator';
        parameterValue = singleCtx.getNodeParameter(
          basePath + nodeProperties.name,
          undefined,
          { extractValue: shouldExtractValue },
        ) as string;
      }

      if (nodeProperties.routing.operations) {
        returnData.requestOperations = { ...nodeProperties.routing.operations };
      }

      // Apply routing.request overrides
      if (nodeProperties.routing.request) {
        for (const key of Object.keys(nodeProperties.routing.request)) {
          let propertyValue = (
            nodeProperties.routing.request as Record<string, NodeParameterValueType>
          )[key];
          propertyValue = this.getParameterValue(
            propertyValue,
            itemIndex,
            { ...additionalKeys, $value: parameterValue },
          );
          (returnData.options as Record<string, NodeParameterValueType>)[key] = propertyValue;
        }
      }

      // Apply routing.send (where to put the parameter value)
      if (nodeProperties.routing.send) {
        let propertyName = nodeProperties.routing.send.property;
        if (propertyName !== undefined) {
          propertyName = this.getParameterValue(
            propertyName,
            itemIndex,
            additionalKeys,
          ) as string;

          let value = parameterValue as NodeParameterValueType;

          if (nodeProperties.routing.send.value) {
            const valueString = nodeProperties.routing.send.value;
            value = this.getParameterValue(
              valueString,
              itemIndex,
              { ...additionalKeys, $value: value },
            ) as string;
          }

          if (nodeProperties.routing.send.type === 'body') {
            if (nodeProperties.routing.send.propertyInDotNotation === false) {
              (returnData.options.body as Record<string, NodeParameterValueType>)[propertyName] =
                value;
            } else {
              set(returnData.options.body as object, propertyName, value);
            }
          } else {
            // Default: send in query string
            if (nodeProperties.routing.send.propertyInDotNotation === false) {
              returnData.options.qs![propertyName] = value;
            } else {
              set(returnData.options.qs as object, propertyName, value);
            }
          }
        }

        if (nodeProperties.routing.send.paginate !== undefined) {
          let paginateValue = nodeProperties.routing.send
            .paginate as NodeParameterValueType;
          if (
            typeof paginateValue === 'string' &&
            paginateValue.charAt(0) === '='
          ) {
            paginateValue = this.getParameterValue(
              paginateValue,
              itemIndex,
              { ...additionalKeys, $value: parameterValue },
            );
          }
          returnData.paginate = !!paginateValue;
        }

        if (nodeProperties.routing.send.preSend) {
          returnData.preSend.push(...nodeProperties.routing.send.preSend);
        }
      }

      // Apply routing.output
      if (nodeProperties.routing.output) {
        if (nodeProperties.routing.output.maxResults !== undefined) {
          let maxResultsValue = nodeProperties.routing.output
            .maxResults as NodeParameterValueType;
          if (
            typeof maxResultsValue === 'string' &&
            maxResultsValue.charAt(0) === '='
          ) {
            maxResultsValue = this.getParameterValue(
              maxResultsValue,
              itemIndex,
              { ...additionalKeys, $value: parameterValue },
            );
          }
          returnData.maxResults = maxResultsValue as number | string;
        }

        if (nodeProperties.routing.output.postReceive) {
          const postReceiveActions = nodeProperties.routing.output.postReceive.filter(
            (action) => {
              if (typeof action === 'function') return true;

              if (
                typeof action.enabled === 'string' &&
                action.enabled.charAt(0) === '='
              ) {
                return this.getParameterValue(
                  action.enabled,
                  itemIndex,
                  { ...additionalKeys, $value: parameterValue },
                ) as boolean;
              }

              return action.enabled !== false;
            },
          );

          if (postReceiveActions.length) {
            returnData.postReceive.push({
              data: { parameterValue },
              actions: postReceiveActions,
            });
          }
        }
      }
    }

    // Check child properties (options, collection, fixedCollection)
    if (!Object.prototype.hasOwnProperty.call(nodeProperties, 'options')) {
      return returnData;
    }

    const typedProps = nodeProperties as INodeProperties;

    if (typedProps.type === 'options') {
      const optionValue = NodeHelpers.getParameterValueByPath(
        node.parameters,
        typedProps.name,
        basePath.slice(0, -1),
      );

      const selectedOption = (typedProps.options as INodePropertyOptions[]).filter(
        (option) => option.value === optionValue,
      );

      if (selectedOption.length) {
        const tempOptions = this.getRequestOptionsFromParameters(
          singleCtx,
          selectedOption[0],
          itemIndex,
          `${basePath}${typedProps.name}`,
          { $value: optionValue, $version: node.typeVersion },
        );
        this.mergeOptions(returnData, tempOptions);
      }
    } else if (typedProps.type === 'collection') {
      const value = NodeHelpers.getParameterValueByPath(
        node.parameters,
        typedProps.name,
        basePath.slice(0, -1),
      );

      for (const propertyOption of typedProps.options as INodeProperties[]) {
        if (
          Object.keys(value as IDataObject).includes(propertyOption.name) &&
          propertyOption.type !== undefined
        ) {
          const tempOptions = this.getRequestOptionsFromParameters(
            singleCtx,
            propertyOption,
            itemIndex,
            `${basePath}${typedProps.name}`,
            { $version: node.typeVersion },
          );
          this.mergeOptions(returnData, tempOptions);
        }
      }
    } else if (typedProps.type === 'fixedCollection') {
      basePath = `${basePath}${typedProps.name}.`;
      for (const propertyOptions of typedProps.options as INodePropertyCollection[]) {
        const rawValue = NodeHelpers.getParameterValueByPath(
          node.parameters,
          propertyOptions.name,
          basePath.slice(0, -1),
        );

        if (rawValue === undefined) continue;

        let value: INodeParameters[] = Array.isArray(rawValue)
          ? rawValue as INodeParameters[]
          : [rawValue as INodeParameters];

        value = this.getParameterValue(
          value as NodeParameterValueType,
          itemIndex,
          { ...additionalKeys },
        ) as INodeParameters[];

        const loopBasePath = `${basePath}${propertyOptions.name}`;
        for (let i = 0; i < (value as INodeParameters[]).length; i++) {
          for (const option of propertyOptions.values) {
            const tempOptions = this.getRequestOptionsFromParameters(
              singleCtx,
              option,
              itemIndex,
              typedProps.typeOptions?.multipleValues
                ? `${loopBasePath}[${i}]`
                : loopBasePath,
              {
                ...(additionalKeys || {}),
                $index: i,
                $parent: (value as INodeParameters[])[i],
              },
            );
            this.mergeOptions(returnData, tempOptions);
          }
        }
      }
    }

    return returnData;
  }

  // ---------------------------------------------------------------------------
  // Merge options
  // ---------------------------------------------------------------------------

  private mergeOptions(
    destination: DeclarativeRestApiSettings.ResultOptions,
    source?: DeclarativeRestApiSettings.ResultOptions,
  ): void {
    if (!source) return;

    destination.paginate = destination.paginate ?? source.paginate;
    destination.maxResults = source.maxResults
      ? source.maxResults
      : destination.maxResults;
    merge(destination.options, source.options);
    destination.preSend.push(...source.preSend);
    destination.postReceive.push(...source.postReceive);
    if (source.requestOperations && destination.requestOperations) {
      destination.requestOperations = Object.assign(
        destination.requestOperations,
        source.requestOperations,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // HTTP request execution
  // ---------------------------------------------------------------------------

  private async rawRoutingRequest(
    singleCtx: SingleItemContext,
    requestData: DeclarativeRestApiSettings.ResultOptions,
    credentialType?: string,
  ): Promise<IN8nHttpFullResponse> {
    requestData.options.returnFullResponse = true;

    if (credentialType) {
      // Authenticated requests go through httpRequestWithAuthentication if available.
      // For now, fall back to plain httpRequest with the credential type noted.
      return (await singleCtx.helpers.httpRequest(
        requestData.options as IHttpRequestOptions,
      )) as IN8nHttpFullResponse;
    }

    return (await singleCtx.helpers.httpRequest(
      requestData.options as IHttpRequestOptions,
    )) as IN8nHttpFullResponse;
  }

  private async makeRequest(
    requestData: DeclarativeRestApiSettings.ResultOptions,
    singleCtx: SingleItemContext,
    itemIndex: number,
    credentialType?: string,
    requestOperations?: IN8nRequestOperations,
  ): Promise<INodeExecutionData[]> {
    // Execute preSend hooks
    for (const preSendMethod of requestData.preSend) {
      requestData.options = await preSendMethod.call(
        singleCtx as never,
        requestData.options as IHttpRequestOptions,
      );
    }

    const makeRoutingRequest = async (
      requestOptions: DeclarativeRestApiSettings.ResultOptions,
    ) => {
      const data = await this.rawRoutingRequest(singleCtx, requestOptions, credentialType);
      return this.postProcessResponseData(
        singleCtx,
        data,
        requestData,
        itemIndex,
      );
    };

    let responseData: INodeExecutionData[];

    if (requestData.paginate && requestOperations?.pagination) {
      if (typeof requestOperations.pagination === 'function') {
        // Function-based pagination
        const paginationCtx = Object.create(singleCtx, {
          makeRoutingRequest: { value: makeRoutingRequest },
        });
        responseData = await requestOperations.pagination.call(
          paginationCtx,
          requestData,
        );
      } else if (requestOperations.pagination.type === 'offset') {
        // Offset-based pagination
        responseData = await this.paginateOffset(
          requestData,
          singleCtx,
          itemIndex,
          credentialType,
          requestOperations.pagination,
        );
      } else {
        // Generic pagination
        responseData = await this.paginateGeneric(
          requestData,
          singleCtx,
          itemIndex,
          credentialType,
          requestOperations.pagination,
        );
      }
    } else {
      // No pagination
      const data = await this.rawRoutingRequest(singleCtx, requestData, credentialType);
      responseData = await this.postProcessResponseData(
        singleCtx,
        data,
        requestData,
        itemIndex,
      );
    }

    return responseData;
  }

  // ---------------------------------------------------------------------------
  // Pagination helpers
  // ---------------------------------------------------------------------------

  private async paginateGeneric(
    requestData: DeclarativeRestApiSettings.ResultOptions,
    singleCtx: SingleItemContext,
    itemIndex: number,
    credentialType: string | undefined,
    pagination: IN8nRequestOperationPaginationGeneric,
  ): Promise<INodeExecutionData[]> {
    const responseData: INodeExecutionData[] = [];
    const node = this.context.getNode();

    if (!requestData.options.qs) {
      requestData.options.qs = {};
    }

    const additionalKeys: IWorkflowDataProxyAdditionalKeys = {
      $request: requestData.options,
      $response: {} as IN8nHttpFullResponse,
      $version: node.typeVersion,
    };

    let makeAdditionalRequest: boolean;
    do {
      additionalKeys.$request = requestData.options;

      const paginateRequestData = this.getParameterValue(
        pagination.properties.request as NodeParameterValueType,
        itemIndex,
        additionalKeys,
      ) as object as IHttpRequestOptions;

      const tempResponseData = await this.rawRoutingRequest(
        singleCtx,
        { ...requestData, options: { ...requestData.options, ...paginateRequestData } },
        credentialType,
      );

      additionalKeys.$response = tempResponseData;

      const tempResponseItems = await this.postProcessResponseData(
        singleCtx,
        tempResponseData,
        requestData,
        itemIndex,
      );

      responseData.push(...tempResponseItems);

      makeAdditionalRequest = this.getParameterValue(
        pagination.properties.continue,
        itemIndex,
        additionalKeys,
      ) as boolean;
    } while (makeAdditionalRequest);

    return responseData;
  }

  private async paginateOffset(
    requestData: DeclarativeRestApiSettings.ResultOptions,
    singleCtx: SingleItemContext,
    itemIndex: number,
    credentialType: string | undefined,
    pagination: IN8nRequestOperationPaginationOffset,
  ): Promise<INodeExecutionData[]> {
    const responseData: INodeExecutionData[] = [];
    const { properties } = pagination;
    const node = this.context.getNode();

    const optionsType = properties.type === 'body' ? 'body' : 'qs';
    if (properties.type === 'body' && !requestData.options.body) {
      requestData.options.body = {};
    }

    (requestData.options[optionsType] as IDataObject)[properties.limitParameter] =
      properties.pageSize;
    (requestData.options[optionsType] as IDataObject)[properties.offsetParameter] = 0;

    let tempResponseData: INodeExecutionData[];
    do {
      if (requestData.maxResults) {
        const resultsMissing = (requestData.maxResults as number) - responseData.length;
        if (resultsMissing < 1) break;
        (requestData.options[optionsType] as IDataObject)[properties.limitParameter] =
          Math.min(properties.pageSize, resultsMissing);
      }

      const rawResponse = await this.rawRoutingRequest(
        singleCtx,
        requestData,
        credentialType,
      );
      tempResponseData = await this.postProcessResponseData(
        singleCtx,
        rawResponse,
        requestData,
        itemIndex,
      );

      (requestData.options[optionsType] as IDataObject)[properties.offsetParameter] =
        ((requestData.options[optionsType] as IDataObject)[
          properties.offsetParameter
        ] as number) + properties.pageSize;

      if (properties.rootProperty) {
        const tempResponseValue = get(
          tempResponseData[0]?.json,
          properties.rootProperty,
        ) as IDataObject[] | undefined;

        if (tempResponseValue === undefined) {
          throw new NodeOperationError(
            node,
            `The rootProperty "${properties.rootProperty}" could not be found on item.`,
            { itemIndex },
          );
        }

        tempResponseData = tempResponseValue.map((item) => ({ json: item }));
      }

      responseData.push(...tempResponseData);
    } while (
      tempResponseData.length &&
      tempResponseData.length === properties.pageSize
    );

    return responseData;
  }

  // ---------------------------------------------------------------------------
  // Response processing
  // ---------------------------------------------------------------------------

  private async postProcessResponseData(
    singleCtx: SingleItemContext,
    responseData: IN8nHttpFullResponse,
    requestData: DeclarativeRestApiSettings.ResultOptions,
    itemIndex: number,
  ): Promise<INodeExecutionData[]> {
    let returnData: INodeExecutionData[] = [
      { json: responseData.body as IDataObject },
    ];

    if (requestData.postReceive.length) {
      for (const postReceiveMethod of requestData.postReceive) {
        for (const action of postReceiveMethod.actions) {
          returnData = await this.runPostReceiveAction(
            singleCtx,
            action,
            returnData,
            responseData,
            postReceiveMethod.data.parameterValue,
            itemIndex,
          );
        }
      }
    } else {
      if (Array.isArray(responseData.body)) {
        returnData = responseData.body.map((json) => ({
          json,
        })) as INodeExecutionData[];
      } else {
        returnData[0].json = responseData.body as IDataObject;
      }
    }

    return returnData;
  }

  private async runPostReceiveAction(
    singleCtx: SingleItemContext,
    action: PostReceiveAction,
    inputData: INodeExecutionData[],
    responseData: IN8nHttpFullResponse,
    parameterValue: string | IDataObject | undefined,
    itemIndex: number,
  ): Promise<INodeExecutionData[]> {
    if (typeof action === 'function') {
      return action.call(singleCtx as never, inputData, responseData);
    }

    const node = this.context.getNode();

    if (action.type === 'rootProperty') {
      try {
        return inputData.flatMap((item) => {
          let itemContent = get(item.json, action.properties.property);
          if (!Array.isArray(itemContent)) {
            itemContent = [itemContent];
          }
          return (itemContent as IDataObject[]).map((json) => ({ json }));
        });
      } catch (error) {
        throw new NodeOperationError(node, error as Error, {
          itemIndex,
          description: `The rootProperty "${action.properties.property}" could not be found on item.`,
        });
      }
    }

    if (action.type === 'filter') {
      const passValue = action.properties.pass;
      const { credentials } = await this.prepareCredentials();

      return inputData.filter((item) =>
        this.getParameterValue(
          passValue,
          itemIndex,
          {
            $credentials: credentials,
            $response: responseData,
            $responseItem: item.json,
            $value: parameterValue,
            $version: node.typeVersion,
          },
        ) as boolean,
      );
    }

    if (action.type === 'limit') {
      const maxResults = this.getParameterValue(
        action.properties.maxResults,
        itemIndex,
        { $response: responseData, $value: parameterValue, $version: node.typeVersion },
      ) as string;
      return inputData.slice(0, parseInt(maxResults, 10));
    }

    if (action.type === 'set') {
      const { value } = action.properties;
      return [
        {
          json: this.getParameterValue(
            value,
            itemIndex,
            {
              $response: responseData,
              $value: parameterValue,
              $version: node.typeVersion,
            },
          ) as IDataObject,
        },
      ];
    }

    if (action.type === 'sort') {
      const sortKey = action.properties.key;
      inputData.sort((a, b) => {
        const aSortValue = a.json[sortKey]?.toString().toLowerCase() ?? '';
        const bSortValue = b.json[sortKey]?.toString().toLowerCase() ?? '';
        if (aSortValue < bSortValue) return -1;
        if (aSortValue > bSortValue) return 1;
        return 0;
      });
      return inputData;
    }

    if (action.type === 'setKeyValue') {
      const returnItems: INodeExecutionData[] = [];

      for (const item of inputData) {
        const returnItem: IDataObject = {};
        for (const key of Object.keys(action.properties)) {
          let propertyValue = (
            action.properties as Record<string, NodeParameterValueType>
          )[key];
          propertyValue = this.getParameterValue(
            propertyValue,
            itemIndex,
            {
              $response: responseData,
              $responseItem: item.json,
              $value: parameterValue,
              $version: node.typeVersion,
            },
          );
          (returnItem as Record<string, NodeParameterValueType>)[key] = propertyValue;
        }
        returnItems.push({ json: returnItem });
      }

      return returnItems;
    }

    if (action.type === 'binaryData') {
      const body = Buffer.from(responseData.body as string);
      let { destinationProperty } = action.properties;

      destinationProperty = this.getParameterValue(
        destinationProperty,
        itemIndex,
        {
          $response: responseData,
          $value: parameterValue,
          $version: node.typeVersion,
        },
      ) as string;

      const binaryData = await singleCtx.helpers.prepareBinaryData(body);

      return inputData.map((item) => {
        if (typeof item.json === 'string') {
          item.json = {};
        }
        item.binary = { [destinationProperty]: binaryData };
        return item;
      });
    }

    return [];
  }

  // ---------------------------------------------------------------------------
  // Expression resolution
  // ---------------------------------------------------------------------------

  private getParameterValue(
    parameterValue: NodeParameterValueType,
    itemIndex: number,
    additionalKeys?: IWorkflowDataProxyAdditionalKeys,
  ): NodeParameterValueType {
    if (
      typeof parameterValue === 'object' ||
      (typeof parameterValue === 'string' && parameterValue.charAt(0) === '=')
    ) {
      return this.context.evaluateExpression(
        typeof parameterValue === 'string' ? parameterValue.slice(1) : JSON.stringify(parameterValue),
        itemIndex,
      );
    }
    return parameterValue;
  }

  // ---------------------------------------------------------------------------
  // Credential preparation
  // ---------------------------------------------------------------------------

  private async prepareCredentials(): Promise<{
    credentials: ICredentialDataDecryptedObject | undefined;
    credentialDescription: INodeCredentialDescription | undefined;
  }> {
    const { context, nodeType, credentialsDecrypted } = this;
    const node = context.getNode();

    let credentialDescription: INodeCredentialDescription | undefined;

    if (nodeType.description.credentials?.length) {
      if (nodeType.description.credentials.length === 1) {
        credentialDescription = nodeType.description.credentials[0];
      } else {
        const authenticationMethod = context.getNodeParameter(
          'authentication',
          0,
        ) as string;
        credentialDescription = nodeType.description.credentials.find((x) =>
          x.displayOptions?.show?.authentication?.includes(authenticationMethod),
        );
        if (!credentialDescription) {
          throw new NodeOperationError(
            node,
            `Node type "${node.type}" does not have any credentials of type "${authenticationMethod}" defined`,
            { level: 'warning' },
          );
        }
      }
    }

    let credentials: ICredentialDataDecryptedObject | undefined;
    if (credentialsDecrypted) {
      credentials = credentialsDecrypted.data;
    } else if (credentialDescription) {
      try {
        credentials =
          (await context.getCredentials<ICredentialDataDecryptedObject>(
            credentialDescription.name,
            0,
          )) || {};
      } catch (error) {
        if (credentialDescription.required) {
          throw error;
        } else {
          credentialDescription = undefined;
        }
      }
    }

    return { credentials, credentialDescription };
  }
}
