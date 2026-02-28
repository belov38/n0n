import type {
	IWorkflowExecuteAdditionalData,
	ICredentialsHelper as N8nCredentialsHelper,
	ICredentialDataDecryptedObject,
	INodeCredentialsDetails,
	WorkflowExecuteMode,
	IExecuteData,
	ICredentialsExpressionResolveValues,
	IHttpRequestOptions,
	IRequestOptionsSimplified,
	INode,
	IHttpRequestHelper,
	INodeProperties,
	IDataObject,
} from 'n8n-workflow';
import type { CredentialsHelper } from './credentials-helper';
import type { PushService } from './push/push.service';
import type { VariableRepo } from '@n0n/db';

export interface AdditionalDataDeps {
	credentialsHelper: CredentialsHelper;
	variableRepo: VariableRepo;
	pushService: PushService;
	instanceBaseUrl?: string;
	webhookBaseUrl?: string;
}

function createCredentialsHelperAdapter(
	helper: CredentialsHelper,
): N8nCredentialsHelper {
	return {
		getParentTypes(name: string): string[] {
			return helper.getParentTypes(name);
		},

		async authenticate(
			credentials: ICredentialDataDecryptedObject,
			typeName: string,
			requestOptions: IHttpRequestOptions | IRequestOptionsSimplified,
		): Promise<IHttpRequestOptions> {
			return helper.authenticate(credentials, typeName, requestOptions);
		},

		async preAuthentication(
			helpers: IHttpRequestHelper,
			credentials: ICredentialDataDecryptedObject,
			typeName: string,
			node: INode,
			credentialsExpired: boolean,
		): Promise<ICredentialDataDecryptedObject | undefined> {
			return helper.preAuthentication(helpers, credentials, typeName, node, credentialsExpired);
		},

		async getCredentials(
			nodeCredentials: INodeCredentialsDetails,
			type: string,
		) {
			throw new Error(`getCredentials not implemented (type: ${type}, id: ${nodeCredentials.id})`);
		},

		async getDecrypted(
			_additionalData: IWorkflowExecuteAdditionalData,
			nodeCredentials: INodeCredentialsDetails,
			type: string,
			mode: WorkflowExecuteMode,
			executeData?: IExecuteData,
			raw?: boolean,
			expressionResolveValues?: ICredentialsExpressionResolveValues,
		): Promise<ICredentialDataDecryptedObject> {
			return helper.getDecrypted(
				nodeCredentials,
				type,
				mode,
				undefined,
				executeData,
				raw,
				expressionResolveValues,
			);
		},

		async updateCredentials(
			nodeCredentials: INodeCredentialsDetails,
			type: string,
			data: ICredentialDataDecryptedObject,
		): Promise<void> {
			return helper.updateCredentials(nodeCredentials, type, data);
		},

		async updateCredentialsOauthTokenData(
			nodeCredentials: INodeCredentialsDetails,
			type: string,
			data: ICredentialDataDecryptedObject,
		): Promise<void> {
			return helper.updateCredentialsOauthTokenData(nodeCredentials, type, data);
		},

		getCredentialsProperties(type: string): INodeProperties[] {
			return helper.getCredentialsProperties(type);
		},
	} as N8nCredentialsHelper;
}

export function buildAdditionalData(
	deps: AdditionalDataDeps,
): IWorkflowExecuteAdditionalData {
	const baseUrl = deps.instanceBaseUrl ?? process.env.N0N_BASE_URL ?? 'http://localhost:5678';
	const webhookBase = deps.webhookBaseUrl ?? `${baseUrl}/webhook`;

	return {
		credentialsHelper: createCredentialsHelperAdapter(deps.credentialsHelper),
		restApiUrl: `${baseUrl}/rest`,
		instanceBaseUrl: baseUrl,
		webhookBaseUrl: webhookBase,
		webhookTestBaseUrl: `${webhookBase}-test`,
		webhookWaitingBaseUrl: `${webhookBase}-waiting`,
		formWaitingBaseUrl: `${baseUrl}/form-waiting`,
		variables: {},
		currentNodeExecutionIndex: 0,

		executeWorkflow: async () => {
			throw new Error('Sub-workflow execution is not yet supported');
		},

		getRunExecutionData: async () => {
			return undefined;
		},

		logAiEvent: () => {
			// No-op
		},

		setExecutionStatus: () => {
			// No-op
		},

		sendDataToUI: (type: string, data: IDataObject | IDataObject[]) => {
			deps.pushService.broadcast({
				type: type as 'executionFinished',
				data: (Array.isArray(data) ? data[0] : data) as Record<string, unknown>,
			});
		},

		startRunnerTask: async () => {
			throw new Error('Runner tasks are not supported');
		},
	} as IWorkflowExecuteAdditionalData;
}
