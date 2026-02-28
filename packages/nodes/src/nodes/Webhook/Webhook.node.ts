import type {
	IWebhookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookResponseData,
	INodeExecutionData,
	IDataObject,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export class Webhook implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Webhook',
		name: 'n0n-nodes.webhook',
		group: ['trigger'],
		version: 1,
		description: 'Starts the workflow when a webhook is called',
		eventTriggerDescription: 'Waiting for you to call the Test URL',
		activationMessage: 'You can now make calls to your production webhook URL.',
		defaults: {
			name: 'Webhook',
		},
		inputs: [],
		outputs: [{ type: 'main' as const }],
		webhooks: [
			{
				name: 'default',
				httpMethod: '={{$parameter["httpMethod"]}}',
				responseMode: '={{$parameter["responseMode"]}}',
				path: '={{$parameter["path"]}}',
				isFullPath: false,
			},
		],
		properties: [
			{
				displayName: 'HTTP Method',
				name: 'httpMethod',
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
				description: 'The HTTP method to listen to',
			},
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				default: '',
				placeholder: 'webhook',
				description: 'The path to listen to',
			},
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				options: [
					{ name: 'None', value: 'none' },
					{ name: 'Basic Auth', value: 'basicAuth' },
					{ name: 'Header Auth', value: 'headerAuth' },
				],
				default: 'none',
				description: 'The type of authentication to use',
			},
			{
				displayName: 'Response Mode',
				name: 'responseMode',
				type: 'options',
				options: [
					{
						name: 'When Received',
						value: 'onReceived',
						description: 'Returns immediately with an acknowledgement',
					},
					{
						name: 'When Last Node Finishes',
						value: 'lastNode',
						description: 'Returns data from the last node executed',
					},
					{
						name: 'Using Respond to Webhook Node',
						value: 'responseNode',
						description: 'Response is set by a Respond to Webhook node',
					},
				],
				default: 'onReceived',
				description: 'When to respond to the webhook',
			},
			{
				displayName: 'Response Data',
				name: 'responseData',
				type: 'options',
				displayOptions: {
					show: {
						responseMode: ['onReceived'],
					},
				},
				options: [
					{
						name: 'Empty',
						value: 'empty',
						description: 'Returns an empty response',
					},
					{
						name: 'First Entry JSON',
						value: 'firstEntryJson',
						description: 'Returns the JSON data of the first entry',
					},
					{
						name: 'First Entry Binary',
						value: 'firstEntryBinary',
						description: 'Returns the binary data of the first entry',
					},
				],
				default: 'empty',
				description: 'What data to respond with',
			},
			{
				displayName: 'Response Code',
				name: 'responseCode',
				type: 'number',
				displayOptions: {
					hide: {
						responseMode: ['responseNode'],
					},
				},
				typeOptions: {
					minValue: 100,
					maxValue: 599,
				},
				default: 200,
				description: 'The HTTP response code to return',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Raw Body',
						name: 'rawBody',
						type: 'boolean',
						default: false,
						description: 'Whether to return the raw body in binary format',
					},
					{
						displayName: 'Binary Data',
						name: 'binaryData',
						type: 'boolean',
						default: false,
						description: 'Whether to return binary data instead of JSON',
					},
				],
			},
		],
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const responseMode = this.getNodeParameter('responseMode', 'onReceived') as string;
		const responseData = this.getNodeParameter('responseData', 'empty') as string;
		const options = this.getNodeParameter('options', {}) as IDataObject;

		const headers = req.headers as IDataObject;
		const params = req.params as IDataObject;
		const query = req.query as IDataObject;
		const body = req.body as IDataObject;

		const returnItem: INodeExecutionData = {
			json: {
				headers,
				params,
				query,
				body,
			},
		};

		if (options['rawBody'] && req.rawBody) {
			returnItem.binary = {
				data: {
					data: req.rawBody.toString('base64'),
					mimeType: (req.headers['content-type'] as string) ?? 'application/octet-stream',
				},
			};
		}

		return {
			webhookResponse: responseData === 'empty' ? undefined : responseData,
			workflowData: [[returnItem]],
		};
	}
}
