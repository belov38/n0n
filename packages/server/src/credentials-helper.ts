import type { CredentialRepo } from '@n0n/db';
import type { CredentialTypes } from '@n0n/nodes';
import type {
	INode,
	INodeProperties,
	INodeType,
	ICredentialDataDecryptedObject,
	ICredentialType,
	IHttpRequestOptions,
	IDataObject,
	INodeCredentialsDetails,
	INodeTypes,
	WorkflowExecuteMode,
	IWorkflowExecuteAdditionalData,
	IExecuteData,
	INodeParameters,
	IVersionedNodeType,
	IRequestOptionsSimplified,
	IHttpRequestHelper,
	ICredentialsExpressionResolveValues,
	IWorkflowDataProxyAdditionalKeys,
	IAuthenticateGeneric,
} from 'n8n-workflow';
import { Workflow, NodeHelpers } from 'n8n-workflow';

import type { Cipher } from './encryption/cipher';

// Env var holding JSON credential overwrites: { [credType]: { key: value } }
const CREDENTIALS_OVERWRITE_ENV = 'CREDENTIALS_OVERWRITE_DATA';

/** Check if a string is an n8n expression (starts with '=') */
function isExpression(value: unknown): value is string {
	return typeof value === 'string' && value.charAt(0) === '=';
}

/** Deep-copy a plain object */
function deepCopy<T>(obj: T): T {
	return JSON.parse(JSON.stringify(obj)) as T;
}

/**
 * Credential overwrites loaded from CREDENTIALS_OVERWRITE_DATA env var.
 * Format: JSON object mapping credential type names to key-value overrides.
 * Example: { "slackApi": { "apiToken": "xoxb-..." } }
 */
type CredentialOverwriteMap = Record<string, ICredentialDataDecryptedObject>;

// Minimal mock node for expression resolution when no real node context exists
const mockNode: INode = {
	name: '',
	typeVersion: 1,
	type: 'mock',
	position: [0, 0],
	parameters: {} as INodeParameters,
} as INode;

const mockNodeTypes: INodeTypes = {
	getKnownTypes(): IDataObject {
		return {};
	},
	getByName(_nodeType: string): INodeType | IVersionedNodeType {
		return {
			description: { properties: [] as INodeProperties[] },
		} as INodeType;
	},
	getByNameAndVersion(_nodeType: string, _version?: number): INodeType {
		return {
			description: { properties: [] as INodeProperties[] },
		} as INodeType;
	},
};

export class CredentialsHelper {
	private overwriteData: CredentialOverwriteMap;

	constructor(
		private readonly credentialRepo: CredentialRepo,
		private readonly cipher: Cipher,
		private readonly credentialTypes: CredentialTypes,
	) {
		this.overwriteData = this.loadOverwrites();
	}

	// -- Public API ----------------------------------------------------------

	/**
	 * Load credential from DB, decrypt, apply overwrites and resolve expressions.
	 *
	 * This is the primary method nodes call to get usable credential data.
	 */
	async getDecrypted(
		nodeCredentials: INodeCredentialsDetails,
		type: string,
		mode: WorkflowExecuteMode,
		_additionalData?: IWorkflowExecuteAdditionalData,
		_executeData?: IExecuteData,
		raw?: boolean,
		expressionResolveValues?: ICredentialsExpressionResolveValues,
	): Promise<ICredentialDataDecryptedObject> {
		const entity = await this.loadCredentialEntity(nodeCredentials, type);
		const decryptedRaw = this.cipher.decrypt(entity.data) as ICredentialDataDecryptedObject;

		if (raw) {
			return decryptedRaw;
		}

		return this.applyDefaultsAndOverwrites(
			decryptedRaw,
			type,
			mode,
			expressionResolveValues,
		);
	}

	/**
	 * Convenience overload: resolve credential directly from a node definition.
	 * Used by engine execution contexts.
	 */
	async getDecryptedForNode(
		node: INode,
		credentialType: string,
		mode: WorkflowExecuteMode,
		additionalData?: IWorkflowExecuteAdditionalData,
	): Promise<ICredentialDataDecryptedObject> {
		const credentialId = node.credentials?.[credentialType]?.id;
		if (!credentialId) {
			throw new Error(
				`No credential of type "${credentialType}" configured for node "${node.name}"`,
			);
		}

		return this.getDecrypted(
			{ id: credentialId, name: node.credentials![credentialType].name },
			credentialType,
			mode,
			additionalData,
		);
	}

	/**
	 * Inject credential data into HTTP request options based on the credential
	 * type's `authenticate` property.
	 *
	 * Supports:
	 * - Function-based authenticate (custom logic defined by credential type)
	 * - Generic authenticate (declarative: headers, qs, body, auth)
	 */
	async authenticate(
		credentials: ICredentialDataDecryptedObject,
		typeName: string,
		incomingRequestOptions: IHttpRequestOptions | IRequestOptionsSimplified,
	): Promise<IHttpRequestOptions> {
		const requestOptions = incomingRequestOptions;
		const credentialType = this.credentialTypes.getByName(typeName);

		if (!credentialType.authenticate) {
			return requestOptions as IHttpRequestOptions;
		}

		// Function-based authenticate
		if (typeof credentialType.authenticate === 'function') {
			return credentialType.authenticate(
				credentials,
				requestOptions as IHttpRequestOptions,
			);
		}

		// Declarative generic authenticate
		if (typeof credentialType.authenticate === 'object') {
			const authenticate = credentialType.authenticate as IAuthenticateGeneric;

			if (authenticate.type === 'generic') {
				this.applyGenericAuth(requestOptions, authenticate, credentials);
			}
		}

		return requestOptions as IHttpRequestOptions;
	}

	/**
	 * Handle pre-authentication flow for credential types that use expirable tokens.
	 *
	 * If the credential type defines a `preAuthentication` function and the token
	 * is empty or expired, calls it to refresh and persists the updated credential.
	 */
	async preAuthentication(
		helpers: IHttpRequestHelper,
		credentials: ICredentialDataDecryptedObject,
		typeName: string,
		node: INode,
		credentialsExpired: boolean,
	): Promise<ICredentialDataDecryptedObject | undefined> {
		const credentialType = this.credentialTypes.getByName(typeName);

		// Find the expirable property (hidden field with typeOptions.expirable)
		const expirableProperty = credentialType.properties.find(
			(prop) =>
				prop.type === 'hidden' &&
				(prop.typeOptions as Record<string, unknown> | undefined)?.expirable === true,
		);

		if (!expirableProperty?.name) {
			return undefined;
		}

		if (!credentialType.preAuthentication || typeof credentialType.preAuthentication !== 'function') {
			return undefined;
		}

		// Refresh if the token is empty or expired
		const tokenValue = credentials[expirableProperty.name];
		if (tokenValue !== '' && !credentialsExpired) {
			return undefined;
		}

		const output = await credentialType.preAuthentication.call(helpers, credentials);

		// Validate that the pre-auth returned the expirable property
		if (output[expirableProperty.name] === undefined) {
			return undefined;
		}

		const updatedCredentials = { ...credentials, ...output } as ICredentialDataDecryptedObject;

		// Persist updated credential data back to DB
		if (node.credentials) {
			const nodeCredDetails = node.credentials[typeName];
			if (nodeCredDetails) {
				await this.updateCredentials(
					nodeCredDetails,
					typeName,
					updatedCredentials,
				);
			}
		}

		return updatedCredentials;
	}

	/**
	 * Resolve a string value that may be an n8n expression (starts with '=').
	 * Returns the resolved string, or the original value if not an expression.
	 */
	resolveValue(
		parameterValue: string,
		additionalKeys: IWorkflowDataProxyAdditionalKeys,
		workflow: Workflow,
		node: INode,
	): string {
		if (!isExpression(parameterValue)) {
			return parameterValue;
		}

		const result = workflow.expression.getSimpleParameterValue(
			node,
			parameterValue,
			'internal',
			additionalKeys,
			undefined,
			'',
		);

		if (!result) {
			return '';
		}

		return result.toString();
	}

	/**
	 * Returns all parent credential types for the given type name.
	 */
	getParentTypes(typeName: string): string[] {
		return this.credentialTypes.getParentTypes(typeName);
	}

	/**
	 * Returns the merged properties for a credential type, including parent types.
	 */
	getCredentialsProperties(type: string): INodeProperties[] {
		const credentialTypeData = this.credentialTypes.getByName(type);

		if (!credentialTypeData.extends) {
			// Add the OAuth token data property for OAuth types
			if (['oAuth1Api', 'oAuth2Api'].includes(type)) {
				return [
					...credentialTypeData.properties,
					{
						displayName: 'oauthTokenData',
						name: 'oauthTokenData',
						type: 'json',
						required: false,
						default: {},
					} as INodeProperties,
				];
			}
			return credentialTypeData.properties;
		}

		const combined: INodeProperties[] = [];
		for (const parentTypeName of credentialTypeData.extends) {
			const parentProps = this.getCredentialsProperties(parentTypeName);
			NodeHelpers.mergeNodeProperties(combined, parentProps);
		}

		// Own properties take precedence over parent properties
		NodeHelpers.mergeNodeProperties(combined, credentialTypeData.properties);

		return combined;
	}

	/**
	 * Encrypt and save updated credential data back to the database.
	 */
	async updateCredentials(
		nodeCredentials: INodeCredentialsDetails,
		_type: string,
		data: ICredentialDataDecryptedObject,
	): Promise<void> {
		if (!nodeCredentials.id) {
			throw new Error('Cannot update credential without an ID');
		}

		const encrypted = this.cipher.encrypt(data as Record<string, unknown>);
		await this.credentialRepo.update(nodeCredentials.id, { data: encrypted });
	}

	/**
	 * Update only the OAuth token data portion of a credential.
	 */
	async updateCredentialsOauthTokenData(
		nodeCredentials: INodeCredentialsDetails,
		type: string,
		data: ICredentialDataDecryptedObject,
	): Promise<void> {
		// Load the full credential, merge the token data, and re-save
		const entity = await this.loadCredentialEntity(nodeCredentials, type);
		const existing = this.cipher.decrypt(entity.data) as ICredentialDataDecryptedObject;
		existing.oauthTokenData = data.oauthTokenData;

		const encrypted = this.cipher.encrypt(existing as Record<string, unknown>);
		await this.credentialRepo.update(entity.id, { data: encrypted });
	}

	// -- Private helpers -----------------------------------------------------

	/**
	 * Load a credential entity from the DB, validating ID and type.
	 */
	private async loadCredentialEntity(
		nodeCredentials: INodeCredentialsDetails,
		type: string,
	) {
		if (!nodeCredentials.id) {
			throw new Error(
				`Credential "${nodeCredentials.name}" has no ID (type: ${type})`,
			);
		}

		const entity = await this.credentialRepo.findById(nodeCredentials.id);

		if (!entity) {
			throw new Error(
				`Credential "${nodeCredentials.name}" (ID: ${nodeCredentials.id}) not found`,
			);
		}

		if (entity.type !== type) {
			throw new Error(
				`Credential "${nodeCredentials.name}" (ID: ${nodeCredentials.id}) is type "${entity.type}", expected "${type}"`,
			);
		}

		return entity;
	}

	/**
	 * Apply credential type defaults, env-var overwrites, and expression resolution.
	 */
	private applyDefaultsAndOverwrites(
		decryptedRaw: ICredentialDataDecryptedObject,
		type: string,
		mode: WorkflowExecuteMode,
		expressionResolveValues?: ICredentialsExpressionResolveValues,
	): ICredentialDataDecryptedObject {
		const credentialsProperties = this.getCredentialsProperties(type);

		// Apply env-var overwrites (fill empty fields only)
		const withOverwrites = this.applyOverwrites(type, decryptedRaw);

		// Apply credential type defaults
		let resolved = NodeHelpers.getNodeParameters(
			credentialsProperties,
			withOverwrites as INodeParameters,
			true,
			false,
			null,
			null,
		) as ICredentialDataDecryptedObject;

		// Preserve OAuth token data (not declared as a typed property)
		if (decryptedRaw.oauthTokenData !== undefined) {
			resolved.oauthTokenData = decryptedRaw.oauthTokenData;
		}

		// Resolve expressions
		if (expressionResolveValues) {
			try {
				resolved = expressionResolveValues.workflow.expression.getParameterValue(
					resolved as INodeParameters,
					expressionResolveValues.runExecutionData,
					expressionResolveValues.runIndex,
					expressionResolveValues.itemIndex,
					expressionResolveValues.node.name,
					expressionResolveValues.connectionInputData,
					mode,
					{},
					undefined,
					false,
					resolved,
				) as ICredentialDataDecryptedObject;
			} catch (e: unknown) {
				const error = e instanceof Error ? e : new Error(String(e));
				error.message += ' [Error resolving credentials]';
				throw error;
			}
		} else {
			// Resolve expressions with a mock workflow context
			const workflow = new Workflow({
				nodes: [mockNode],
				connections: {},
				active: false,
				nodeTypes: mockNodeTypes,
			});

			resolved = workflow.expression.getComplexParameterValue(
				mockNode,
				resolved as INodeParameters,
				mode,
				{},
				undefined,
				undefined,
				resolved,
			) as ICredentialDataDecryptedObject;
		}

		return resolved;
	}

	/**
	 * Apply env-var overwrites from CREDENTIALS_OVERWRITE_DATA.
	 * Only fills fields that are currently null, undefined, or empty string.
	 */
	private applyOverwrites(
		type: string,
		data: ICredentialDataDecryptedObject,
	): ICredentialDataDecryptedObject {
		const overwrites = this.getOverwritesForType(type);
		if (!overwrites) {
			return data;
		}

		const result = deepCopy(data);
		for (const key of Object.keys(overwrites)) {
			const currentValue = result[key];
			if (currentValue === null || currentValue === undefined || currentValue === '') {
				result[key] = overwrites[key];
			}
		}
		return result;
	}

	/**
	 * Resolve overwrites for a type, walking parent types.
	 */
	private getOverwritesForType(type: string): ICredentialDataDecryptedObject | undefined {
		const parentTypes = this.credentialTypes.getParentTypes(type);
		const allTypes = [...parentTypes.reverse(), type];

		let hasOverwrites = false;
		const merged: ICredentialDataDecryptedObject = {};

		for (const t of allTypes) {
			const data = this.overwriteData[t];
			if (data) {
				hasOverwrites = true;
				Object.assign(merged, data);
			}
		}

		return hasOverwrites ? merged : undefined;
	}

	/**
	 * Load credential overwrites from CREDENTIALS_OVERWRITE_DATA env var.
	 */
	private loadOverwrites(): CredentialOverwriteMap {
		const raw = process.env[CREDENTIALS_OVERWRITE_ENV];
		if (!raw) {
			return {};
		}
		try {
			return JSON.parse(raw) as CredentialOverwriteMap;
		} catch {
			console.warn('Failed to parse CREDENTIALS_OVERWRITE_DATA env var — ignoring.');
			return {};
		}
	}

	/**
	 * Apply generic declarative authentication to request options.
	 * Handles: headers, qs (query string), body, auth.
	 */
	private applyGenericAuth(
		requestOptions: IHttpRequestOptions | IRequestOptionsSimplified,
		authenticate: IAuthenticateGeneric,
		credentials: ICredentialDataDecryptedObject,
	): void {
		const { properties } = authenticate;

		// Process each target area (headers, qs, body, auth)
		for (const [outerKey, outerValue] of Object.entries(properties)) {
			if (outerValue === undefined || outerValue === null) continue;

			if (typeof outerValue === 'object' && !Array.isArray(outerValue)) {
				// Ensure the target area exists on the request
				const opts = requestOptions as unknown as Record<string, Record<string, unknown>>;
				if (!opts[outerKey]) {
					opts[outerKey] = {};
				}

				for (const [key, value] of Object.entries(outerValue)) {
					// Resolve credential references like "={{$credentials.apiKey}}"
					const resolvedKey = this.resolveCredentialExpression(key, credentials);
					const resolvedValue = this.resolveCredentialExpression(
						String(value),
						credentials,
					);
					opts[outerKey][resolvedKey] = resolvedValue;
				}
			}
		}
	}

	/**
	 * Simple credential expression resolver for authenticate properties.
	 * Replaces `={{$credentials.fieldName}}` with the actual credential value.
	 */
	private resolveCredentialExpression(
		value: string,
		credentials: ICredentialDataDecryptedObject,
	): string {
		if (!isExpression(value)) {
			return value;
		}

		// Match patterns like ={{$credentials.apiKey}}
		return value.replace(
			/\{\{\s*\$credentials\.(\w+)\s*\}\}/g,
			(_match, fieldName: string) => {
				const credValue = credentials[fieldName];
				return credValue !== undefined ? String(credValue) : '';
			},
		);
	}
}
