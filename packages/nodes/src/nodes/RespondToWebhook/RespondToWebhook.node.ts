import type {
	IDataObject,
	IExecuteFunctions,
	IExecuteResponsePromiseData,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

type RespondWith =
	| 'allIncomingItems'
	| 'firstIncomingItem'
	| 'text'
	| 'json'
	| 'noData'
	| 'redirect';

interface ResponseHeaderEntry {
	name: string;
	value: string;
}

export class RespondToWebhook implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Respond to Webhook',
		name: 'n0n-nodes.respondToWebhook',
		group: ['transform'],
		version: 1,
		description: 'Returns data for Webhook',
		defaults: {
			name: 'Respond to Webhook',
		},
		inputs: [{ type: 'main' as const }],
		outputs: [{ type: 'main' as const }],
		properties: [
			{
				displayName: 'Respond With',
				name: 'respondWith',
				type: 'options',
				options: [
					{
						name: 'All Incoming Items',
						value: 'allIncomingItems',
						description: 'Respond with all input JSON items',
					},
					{
						name: 'First Incoming Item',
						value: 'firstIncomingItem',
						description: 'Respond with the first input JSON item',
					},
					{
						name: 'JSON',
						value: 'json',
						description: 'Respond with a custom JSON body',
					},
					{
						name: 'Text',
						value: 'text',
						description: 'Respond with a simple text message body',
					},
					{
						name: 'No Data',
						value: 'noData',
						description: 'Respond with an empty body',
					},
					{
						name: 'Redirect',
						value: 'redirect',
						description: 'Respond with a redirect to a given URL',
					},
				],
				default: 'firstIncomingItem',
				description: 'The data that should be returned',
			},
			{
				displayName: 'Redirect URL',
				name: 'redirectURL',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						respondWith: ['redirect'],
					},
				},
				default: '',
				placeholder: 'e.g. https://example.com',
				description: 'The URL to redirect to',
			},
			{
				displayName: 'Response Body',
				name: 'responseBody',
				type: 'json',
				displayOptions: {
					show: {
						respondWith: ['json'],
					},
				},
				default: '{\n  "myField": "value"\n}',
				description: 'The HTTP response JSON data',
			},
			{
				displayName: 'Response Body',
				name: 'responseBody',
				type: 'string',
				displayOptions: {
					show: {
						respondWith: ['text'],
					},
				},
				default: '',
				placeholder: 'e.g. Workflow completed',
				description: 'The HTTP response text data',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Response Code',
						name: 'responseCode',
						type: 'number',
						typeOptions: {
							minValue: 100,
							maxValue: 599,
						},
						default: 200,
						description: 'The HTTP response code to return. Defaults to 200.',
					},
					{
						displayName: 'Response Headers',
						name: 'responseHeaders',
						placeholder: 'Add Response Header',
						description: 'Add headers to the webhook response',
						type: 'fixedCollection',
						typeOptions: {
							multipleValues: true,
						},
						default: {},
						options: [
							{
								name: 'entries',
								displayName: 'Entries',
								values: [
									{
										displayName: 'Name',
										name: 'name',
										type: 'string',
										default: '',
										description: 'Name of the header',
									},
									{
										displayName: 'Value',
										name: 'value',
										type: 'string',
										default: '',
										description: 'Value of the header',
									},
								],
							},
						],
					},
					{
						displayName: 'Put Response in Field',
						name: 'responseKey',
						type: 'string',
						displayOptions: {
							show: {
								'/respondWith': ['allIncomingItems', 'firstIncomingItem'],
							},
						},
						default: '',
						description: 'The name of the response field to put all items in',
						placeholder: 'e.g. data',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const respondWith = this.getNodeParameter('respondWith', 0) as RespondWith;
		const options = this.getNodeParameter('options', 0, {}) as IDataObject;

		const headers: Record<string, string> = {};
		if (options.responseHeaders) {
			const headerEntries = (options.responseHeaders as IDataObject)
				.entries as ResponseHeaderEntry[];
			if (headerEntries) {
				for (const header of headerEntries) {
					headers[header.name.toLowerCase()] = String(header.value);
				}
			}
		}

		let statusCode = (options.responseCode as number) || 200;
		let responseBody: unknown;

		switch (respondWith) {
			case 'json': {
				const bodyStr = this.getNodeParameter('responseBody', 0) as string;
				if (bodyStr) {
					try {
						responseBody = JSON.parse(bodyStr);
					} catch {
						throw new NodeOperationError(
							this.getNode(),
							"Invalid JSON in 'Response Body' field",
						);
					}
				}
				break;
			}
			case 'text':
				responseBody = this.getNodeParameter('responseBody', 0) as string;
				break;
			case 'allIncomingItems': {
				const allItems = items.map((item) => item.json);
				responseBody = options.responseKey
					? { [options.responseKey as string]: allItems }
					: allItems;
				break;
			}
			case 'firstIncomingItem':
				responseBody = options.responseKey
					? { [options.responseKey as string]: items[0].json }
					: items[0].json;
				break;
			case 'redirect':
				headers.location = this.getNodeParameter('redirectURL', 0) as string;
				statusCode = (options.responseCode as number) ?? 307;
				break;
			case 'noData':
				responseBody = undefined;
				break;
			default:
				throw new NodeOperationError(
					this.getNode(),
					`The response mode "${respondWith as string}" is not supported`,
				);
		}

		const response: IExecuteResponsePromiseData = {
			body: responseBody,
			headers,
			statusCode,
		} as IExecuteResponsePromiseData;

		this.sendResponse(response);

		return [items];
	}
}
