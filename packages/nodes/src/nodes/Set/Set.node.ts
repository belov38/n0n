import type {
	GenericValue,
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

type SetMode = 'manual' | 'raw';

interface SetFieldEntry {
	name: string;
	stringValue: string;
	numberValue: string;
	booleanValue: string;
	type: 'string' | 'number' | 'boolean';
}

function coerceValue(
	raw: string,
	type: 'string' | 'number' | 'boolean',
): string | number | boolean {
	switch (type) {
		case 'number': {
			const n = Number(raw);
			if (Number.isNaN(n)) throw new Error(`Cannot convert "${raw}" to number`);
			return n;
		}
		case 'boolean':
			return raw === 'true';
		default:
			return raw;
	}
}

function setByDotNotation(obj: IDataObject, path: string, value: GenericValue): void {
	const parts = path.split('.');
	let current: IDataObject = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		const key = parts[i];
		if (current[key] === undefined || typeof current[key] !== 'object') {
			current[key] = {};
		}
		current = current[key] as IDataObject;
	}
	current[parts[parts.length - 1]] = value;
}

export class Set implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Set',
		name: 'n0n-nodes.set',
		group: ['input'],
		version: 1,
		description: 'Sets or modifies field values on items',
		defaults: {
			name: 'Set',
		},
		inputs: [{ type: 'main' as const }],
		outputs: [{ type: 'main' as const }],
		properties: [
			{
				displayName: 'Mode',
				name: 'mode',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Manual Mapping',
						value: 'manual',
						description: 'Set fields one by one',
					},
					{
						name: 'JSON',
						value: 'raw',
						description: 'Set fields using a JSON object',
					},
				],
				default: 'manual',
			},
			{
				displayName: 'Fields to Set',
				name: 'fields',
				placeholder: 'Add Field',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
					sortable: true,
				},
				default: {},
				displayOptions: {
					show: {
						mode: ['manual'],
					},
				},
				options: [
					{
						name: 'values',
						displayName: 'Values',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
								placeholder: 'e.g. fieldName',
								description: 'Name of the field to set. Supports dot-notation.',
							},
							{
								displayName: 'Type',
								name: 'type',
								type: 'options',
								options: [
									{ name: 'String', value: 'string' },
									{ name: 'Number', value: 'number' },
									{ name: 'Boolean', value: 'boolean' },
								],
								default: 'string',
							},
							{
								displayName: 'Value',
								name: 'stringValue',
								type: 'string',
								default: '',
								displayOptions: { show: { type: ['string'] } },
							},
							{
								displayName: 'Value',
								name: 'numberValue',
								type: 'string',
								default: '',
								displayOptions: { show: { type: ['number'] } },
							},
							{
								displayName: 'Value',
								name: 'booleanValue',
								type: 'options',
								options: [
									{ name: 'True', value: 'true' },
									{ name: 'False', value: 'false' },
								],
								default: 'true',
								displayOptions: { show: { type: ['boolean'] } },
							},
						],
					},
				],
			},
			{
				displayName: 'JSON Output',
				name: 'jsonOutput',
				type: 'json',
				default: '{}',
				displayOptions: {
					show: {
						mode: ['raw'],
					},
				},
				description: 'JSON object to set as item fields',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Keep Only Set',
						name: 'keepOnlySet',
						type: 'boolean',
						default: false,
						description:
							'Whether only the fields set by this node should be kept, removing all others',
					},
					{
						displayName: 'Support Dot Notation',
						name: 'dotNotation',
						type: 'boolean',
						default: true,
						description:
							'Whether dot-notation should be used in property names (e.g. "a.b" sets nested property)',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const mode = this.getNodeParameter('mode', 0) as SetMode;
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const options = this.getNodeParameter('options', i, {}) as IDataObject;
				const keepOnlySet = options.keepOnlySet === true;
				const dotNotation = options.dotNotation !== false;

				let newJson: IDataObject;

				if (mode === 'raw') {
					const jsonStr = this.getNodeParameter('jsonOutput', i) as string;
					let parsed: unknown;
					try {
						parsed = JSON.parse(jsonStr);
					} catch {
						throw new NodeOperationError(
							this.getNode(),
							`Invalid JSON at item ${i}: ${jsonStr}`,
							{ itemIndex: i },
						);
					}
					if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
						throw new NodeOperationError(
							this.getNode(),
							'JSON output must be a plain object',
							{ itemIndex: i },
						);
					}
					const parsedData = parsed as IDataObject;
					newJson = keepOnlySet ? parsedData : { ...items[i].json, ...parsedData };
				} else {
					const fields = this.getNodeParameter('fields.values', i, []) as SetFieldEntry[];
					const base: IDataObject = keepOnlySet ? {} : { ...items[i].json };

					for (const field of fields) {
						const rawValue =
							field.type === 'string'
								? field.stringValue
								: field.type === 'number'
									? field.numberValue
									: field.booleanValue;

						const value = coerceValue(rawValue ?? '', field.type);

						if (dotNotation) {
							setByDotNotation(base, field.name, value);
						} else {
							base[field.name] = value;
						}
					}

					newJson = base;
				}

				returnData.push({
					json: newJson,
					binary: items[i].binary,
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
