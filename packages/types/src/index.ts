// Re-export core types from n8n-workflow
export type {
  // Workflow types
  IConnections,
  INode,
  INodeConnections,
  INodeExecutionData,
  INodeParameters,
  INodeProperties,
  INodePropertyOptions,
  INodeType,
  INodeTypeDescription,
  INodeTypes,

  // Execution types
  IExecuteFunctions,
  ITriggerFunctions,
  IPollFunctions,
  IWebhookFunctions,
  IHookFunctions,
  ILoadOptionsFunctions,

  // Run data types
  IRunExecutionData,
  IRunData,
  ITaskData,
  ITaskDataConnections,

  // Credential types
  ICredentialType,
  ICredentialDataDecryptedObject,
  ICredentialsDecrypted,
  ICredentialsEncrypted,
  ICredentialTestFunctions,

  // Workflow types
  IWorkflowSettings,
  IWorkflowBase,

  // Other
  IDataObject,
  INodePropertyCollection,
  GenericValue,
  IHttpRequestOptions,
  IHttpRequestMethods,
  IBinaryData,
  IBinaryKeyData,
  IWebhookData,
  ITriggerResponse,
  IWebhookResponseData,
  NodeParameterValueType,
  INodeInputConfiguration,
  INodeOutputConfiguration,
  NodeConnectionType,
  ExecutionStatus,
  WorkflowExecuteMode,
  IExecuteData,
  IWorkflowExecuteAdditionalData,
  ISourceData,
  IPinData,
  IWaitingForExecution,
  IWaitingForExecutionSource,
  IExecuteResponsePromiseData,
} from 'n8n-workflow';

// Re-export classes
export { Workflow, Expression, NodeHelpers, WorkflowDataProxy } from 'n8n-workflow';

// Re-export constants
export { NodeConnectionTypes } from 'n8n-workflow';

export * from './dto';
