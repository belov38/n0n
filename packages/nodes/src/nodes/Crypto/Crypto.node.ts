import type { BinaryToTextEncoding } from 'crypto';
import { createHash, createHmac, createSign, randomBytes } from 'crypto';
import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

export class Crypto implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Crypto',
		name: 'n0n-nodes.crypto',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["action"]}}',
		description: 'Provide cryptographic utilities',
		defaults: {
			name: 'Crypto',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'Action',
				name: 'action',
				type: 'options',
				options: [
					{
						name: 'Hash',
						value: 'hash',
						description: 'Hash a text value',
						action: 'Hash a text value',
					},
					{
						name: 'HMAC',
						value: 'hmac',
						description: 'HMAC a text value',
						action: 'HMAC a text value',
					},
					{
						name: 'Sign',
						value: 'sign',
						description: 'Sign a string using a private key',
						action: 'Sign a string using a private key',
					},
					{
						name: 'Random String',
						value: 'randomString',
						description: 'Generate a random string',
						action: 'Generate a random string',
					},
				],
				default: 'hash',
				noDataExpression: true,
			},
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				displayOptions: {
					show: {
						action: ['hash', 'hmac'],
					},
				},
				options: [
					{ name: 'MD5', value: 'MD5' },
					{ name: 'SHA1', value: 'SHA1' },
					{ name: 'SHA256', value: 'SHA256' },
					{ name: 'SHA384', value: 'SHA384' },
					{ name: 'SHA512', value: 'SHA512' },
				],
				default: 'SHA256',
				required: true,
			},
			{
				displayName: 'Value',
				name: 'value',
				type: 'string',
				displayOptions: {
					show: {
						action: ['hash', 'hmac', 'sign'],
					},
				},
				default: '',
				description: 'The value to process',
				required: true,
			},
			{
				displayName: 'Property Name',
				name: 'dataPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				description: 'Name of the property to write the result to',
			},
			{
				displayName: 'Encoding',
				name: 'encoding',
				type: 'options',
				displayOptions: {
					show: {
						action: ['hash', 'hmac', 'sign'],
					},
				},
				options: [
					{ name: 'HEX', value: 'hex' },
					{ name: 'BASE64', value: 'base64' },
				],
				default: 'hex',
				required: true,
			},
			{
				displayName: 'Secret Key',
				name: 'secretKey',
				type: 'string',
				typeOptions: { password: true },
				displayOptions: {
					show: {
						action: ['hmac'],
					},
				},
				default: '',
				description: 'The secret key for HMAC',
				required: true,
			},
			{
				displayName: 'Private Key',
				name: 'privateKey',
				type: 'string',
				typeOptions: { rows: 5 },
				displayOptions: {
					show: {
						action: ['sign'],
					},
				},
				default: '',
				description: 'The private key for signing (PEM format)',
				required: true,
			},
			{
				displayName: 'Algorithm',
				name: 'algorithm',
				type: 'options',
				displayOptions: {
					show: {
						action: ['sign'],
					},
				},
				options: [
					{ name: 'RSA-SHA256', value: 'RSA-SHA256' },
					{ name: 'RSA-SHA384', value: 'RSA-SHA384' },
					{ name: 'RSA-SHA512', value: 'RSA-SHA512' },
				],
				default: 'RSA-SHA256',
				required: true,
			},
			{
				displayName: 'Length',
				name: 'length',
				type: 'number',
				displayOptions: {
					show: {
						action: ['randomString'],
					},
				},
				default: 32,
				description: 'Length of the generated random string',
				required: true,
			},
			{
				displayName: 'Random String Encoding',
				name: 'randomEncoding',
				type: 'options',
				displayOptions: {
					show: {
						action: ['randomString'],
					},
				},
				options: [
					{ name: 'HEX', value: 'hex' },
					{ name: 'BASE64', value: 'base64' },
				],
				default: 'hex',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const action = this.getNodeParameter('action', i) as string;
			const dataPropertyName = this.getNodeParameter('dataPropertyName', i) as string;
			let result: string;

			if (action === 'hash') {
				const type = this.getNodeParameter('type', i) as string;
				const value = this.getNodeParameter('value', i) as string;
				const encoding = this.getNodeParameter('encoding', i) as BinaryToTextEncoding;
				result = createHash(type).update(value).digest(encoding);
			} else if (action === 'hmac') {
				const type = this.getNodeParameter('type', i) as string;
				const value = this.getNodeParameter('value', i) as string;
				const encoding = this.getNodeParameter('encoding', i) as BinaryToTextEncoding;
				const secretKey = this.getNodeParameter('secretKey', i) as string;
				if (!secretKey) {
					throw new NodeOperationError(this.getNode(), 'HMAC secret key is required', {
						itemIndex: i,
					});
				}
				result = createHmac(type, secretKey).update(value).digest(encoding);
			} else if (action === 'sign') {
				const value = this.getNodeParameter('value', i) as string;
				const encoding = this.getNodeParameter('encoding', i) as BinaryToTextEncoding;
				const privateKey = this.getNodeParameter('privateKey', i) as string;
				const algorithm = this.getNodeParameter('algorithm', i) as string;
				if (!privateKey) {
					throw new NodeOperationError(this.getNode(), 'Private key is required for signing', {
						itemIndex: i,
					});
				}
				const sign = createSign(algorithm);
				sign.update(value);
				result = sign.sign(privateKey, encoding);
			} else if (action === 'randomString') {
				const length = this.getNodeParameter('length', i) as number;
				const randomEncoding = this.getNodeParameter('randomEncoding', i) as BufferEncoding;
				result = randomBytes(length).toString(randomEncoding).slice(0, length);
			} else {
				throw new NodeOperationError(this.getNode(), `Unknown action: ${action}`, {
					itemIndex: i,
				});
			}

			const newItem: INodeExecutionData = {
				json: {
					...items[i].json,
					[dataPropertyName]: result,
				},
				pairedItem: { item: i },
			};

			if (items[i].binary) {
				newItem.binary = items[i].binary;
			}

			returnData.push(newItem);
		}

		return [returnData];
	}
}
