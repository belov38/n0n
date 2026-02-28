import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
	IHttpRequestMethods,
	IHttpRequestOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeOperationError, NodeApiError } from 'n8n-workflow';

interface HeaderParameter {
	name: string;
	value: string;
}

interface QueryParameter {
	name: string;
	value: string;
}

interface BodyParameter {
	name: string;
	value: string;
}

export class HttpRequest implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'HTTP Request',
		name: 'n0n-nodes.httpRequest',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["method"] + ": " + $parameter["url"]}}',
		description: 'Makes an HTTP request and returns the response data',
		defaults: {
			name: 'HTTP Request',
		},
		inputs: [{ type: 'main' as const }],
		outputs: [{ type: 'main' as const }],
		properties: [
			{
				displayName: 'Method',
				name: 'method',
				type: 'options',
				options: [
					{ name: 'DELETE', value: 'DELETE' },
					{ name: 'GET', value: 'GET' },
					{ name: 'HEAD', value: 'HEAD' },
					{ name: 'PATCH', value: 'PATCH' },
					{ name: 'POST', value: 'POST' },
					{ name: 'PUT', value: 'PUT' },
				],
				default: 'GET',
				description: 'The request method to use',
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				placeholder: 'https://example.com/api',
				description: 'The URL to make the request to',
			},
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				options: [
					{ name: 'None', value: 'none' },
					{
						name: 'Predefined Credential Type',
						value: 'predefinedCredentials',
						description: 'Use a predefined credential type for authentication',
					},
					{
						name: 'Generic Credential Type',
						value: 'genericCredentials',
						description: 'Use generic credentials for authentication',
					},
				],
				default: 'none',
				description: 'The type of authentication to use',
			},
			{
				displayName: 'Send Headers',
				name: 'sendHeaders',
				type: 'boolean',
				default: false,
				description: 'Whether to send custom headers with the request',
			},
			{
				displayName: 'Header Parameters',
				name: 'headerParameters',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				displayOptions: {
					show: {
						sendHeaders: [true],
					},
				},
				default: {},
				placeholder: 'Add Header',
				options: [
					{
						name: 'parameters',
						displayName: 'Header',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
					},
				],
			},
			{
				displayName: 'Send Query Parameters',
				name: 'sendQuery',
				type: 'boolean',
				default: false,
				description: 'Whether to send query parameters with the request',
			},
			{
				displayName: 'Query Parameters',
				name: 'queryParameters',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				displayOptions: {
					show: {
						sendQuery: [true],
					},
				},
				default: {},
				placeholder: 'Add Query Parameter',
				options: [
					{
						name: 'parameters',
						displayName: 'Query Parameter',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
					},
				],
			},
			{
				displayName: 'Send Body',
				name: 'sendBody',
				type: 'boolean',
				default: false,
				description: 'Whether to send a body with the request',
			},
			{
				displayName: 'Body Content Type',
				name: 'bodyContentType',
				type: 'options',
				displayOptions: {
					show: {
						sendBody: [true],
					},
				},
				options: [
					{ name: 'JSON', value: 'json' },
					{ name: 'Form URL-Encoded', value: 'form-urlencoded' },
					{ name: 'Form Data (Multipart)', value: 'multipart-form-data' },
					{ name: 'Raw', value: 'raw' },
				],
				default: 'json',
				description: 'Content type of the body to send',
			},
			{
				displayName: 'Body Parameters',
				name: 'bodyParameters',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				displayOptions: {
					show: {
						sendBody: [true],
						bodyContentType: ['json', 'form-urlencoded', 'multipart-form-data'],
					},
				},
				default: {},
				placeholder: 'Add Parameter',
				options: [
					{
						name: 'parameters',
						displayName: 'Parameter',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
					},
				],
			},
			{
				displayName: 'Raw Body',
				name: 'rawBody',
				type: 'string',
				displayOptions: {
					show: {
						sendBody: [true],
						bodyContentType: ['raw'],
					},
				},
				default: '',
				description: 'The raw body to send',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Timeout',
						name: 'timeout',
						type: 'number',
						default: 10000,
						description: 'Request timeout in milliseconds',
					},
					{
						displayName: 'Ignore SSL Issues',
						name: 'allowUnauthorizedCerts',
						type: 'boolean',
						default: false,
						description: 'Whether to accept responses from servers with invalid certificates',
					},
					{
						displayName: 'Follow Redirects',
						name: 'redirect',
						type: 'boolean',
						default: true,
						description: 'Whether to follow redirects',
					},
					{
						displayName: 'Full Response',
						name: 'fullResponse',
						type: 'boolean',
						default: false,
						description: 'Whether to return the full response (headers, status code, body)',
					},
					{
						displayName: 'Response Format',
						name: 'responseFormat',
						type: 'options',
						options: [
							{ name: 'Auto-Detect', value: 'autodetect' },
							{ name: 'JSON', value: 'json' },
							{ name: 'Text', value: 'text' },
							{ name: 'Binary', value: 'binary' },
						],
						default: 'autodetect',
						description: 'How to parse the response',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const method = this.getNodeParameter('method', itemIndex) as IHttpRequestMethods;
				const url = this.getNodeParameter('url', itemIndex) as string;

				if (!url) {
					throw new NodeOperationError(this.getNode(), 'URL is required', {
						itemIndex,
					});
				}

				const sendHeaders = this.getNodeParameter('sendHeaders', itemIndex, false) as boolean;
				const sendQuery = this.getNodeParameter('sendQuery', itemIndex, false) as boolean;
				const sendBody = this.getNodeParameter('sendBody', itemIndex, false) as boolean;
				const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

				const requestOptions: IHttpRequestOptions = {
					method,
					url,
				};

				// Headers
				if (sendHeaders) {
					const headerParams = this.getNodeParameter(
						'headerParameters.parameters',
						itemIndex,
						[],
					) as HeaderParameter[];

					if (headerParams.length > 0) {
						const headers: IDataObject = {};
						for (const param of headerParams) {
							if (param.name) {
								headers[param.name] = param.value;
							}
						}
						requestOptions.headers = headers;
					}
				}

				// Query parameters
				if (sendQuery) {
					const queryParams = this.getNodeParameter(
						'queryParameters.parameters',
						itemIndex,
						[],
					) as QueryParameter[];

					if (queryParams.length > 0) {
						const qs: IDataObject = {};
						for (const param of queryParams) {
							if (param.name) {
								qs[param.name] = param.value;
							}
						}
						requestOptions.qs = qs;
					}
				}

				// Body
				if (sendBody) {
					const bodyContentType = this.getNodeParameter(
						'bodyContentType',
						itemIndex,
						'json',
					) as string;

					if (bodyContentType === 'raw') {
						requestOptions.body = this.getNodeParameter('rawBody', itemIndex, '') as string;
					} else {
						const bodyParams = this.getNodeParameter(
							'bodyParameters.parameters',
							itemIndex,
							[],
						) as BodyParameter[];

						if (bodyParams.length > 0) {
							const bodyData: IDataObject = {};
							for (const param of bodyParams) {
								if (param.name) {
									bodyData[param.name] = param.value;
								}
							}
							requestOptions.body = bodyData;
						}
					}

					if (bodyContentType === 'json') {
						requestOptions.headers = {
							...requestOptions.headers,
							'Content-Type': 'application/json',
						};
					} else if (bodyContentType === 'form-urlencoded') {
						requestOptions.headers = {
							...requestOptions.headers,
							'Content-Type': 'application/x-www-form-urlencoded',
						};
					}
				}

				// Options
				if (options['timeout']) {
					requestOptions.timeout = options['timeout'] as number;
				}
				if (options['allowUnauthorizedCerts']) {
					requestOptions.skipSslCertificateValidation = true;
				}
				if (options['redirect'] === false) {
					requestOptions.disableFollowRedirect = true;
				}

				const response = await this.helpers.httpRequest(requestOptions);

				const fullResponse = options['fullResponse'] as boolean;

				if (fullResponse && typeof response === 'object' && response !== null) {
					returnData.push({
						json: response as IDataObject,
						pairedItem: { item: itemIndex },
					});
				} else if (typeof response === 'object' && response !== null) {
					returnData.push({
						json: response as IDataObject,
						pairedItem: { item: itemIndex },
					});
				} else {
					returnData.push({
						json: { data: response },
						pairedItem: { item: itemIndex },
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					returnData.push({
						json: { error: errorMessage },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				if (error instanceof NodeApiError || error instanceof NodeOperationError) {
					throw error;
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, {
					itemIndex,
				});
			}
		}

		return [returnData];
	}
}
