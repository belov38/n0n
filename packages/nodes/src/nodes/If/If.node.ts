import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

type ComparisonOperation =
	| 'equals'
	| 'notEquals'
	| 'contains'
	| 'startsWith'
	| 'endsWith'
	| 'gt'
	| 'lt'
	| 'gte'
	| 'lte'
	| 'isEmpty'
	| 'isNotEmpty'
	| 'regex'
	| 'notRegex';

interface Condition {
	value1: string;
	operation: ComparisonOperation;
	value2: string;
}

function evaluateCondition(condition: Condition): boolean {
	const { value1, operation, value2 } = condition;

	switch (operation) {
		case 'equals':
			return value1 === value2;
		case 'notEquals':
			return value1 !== value2;
		case 'contains':
			return String(value1).includes(String(value2));
		case 'startsWith':
			return String(value1).startsWith(String(value2));
		case 'endsWith':
			return String(value1).endsWith(String(value2));
		case 'gt':
			return Number(value1) > Number(value2);
		case 'lt':
			return Number(value1) < Number(value2);
		case 'gte':
			return Number(value1) >= Number(value2);
		case 'lte':
			return Number(value1) <= Number(value2);
		case 'isEmpty':
			return value1 === '' || value1 === undefined || value1 === null;
		case 'isNotEmpty':
			return value1 !== '' && value1 !== undefined && value1 !== null;
		case 'regex':
			return new RegExp(value2).test(String(value1));
		case 'notRegex':
			return !new RegExp(value2).test(String(value1));
		default:
			return false;
	}
}

export class If implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'If',
		name: 'n0n-nodes.if',
		group: ['transform'],
		version: 1,
		description: 'Route items based on a condition',
		defaults: {
			name: 'If',
			color: '#408000',
		},
		inputs: [{ type: 'main' as const }],
		outputs: [
			{ type: 'main' as const, displayName: 'true' },
			{ type: 'main' as const, displayName: 'false' },
		],
		properties: [
			{
				displayName: 'Conditions',
				name: 'conditions',
				placeholder: 'Add Condition',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				options: [
					{
						name: 'values',
						displayName: 'Condition',
						values: [
							{
								displayName: 'Value 1',
								name: 'value1',
								type: 'string',
								default: '',
								description: 'First value for comparison',
							},
							{
								displayName: 'Operation',
								name: 'operation',
								type: 'options',
								options: [
									{ name: 'Equals', value: 'equals' },
									{ name: 'Not Equals', value: 'notEquals' },
									{ name: 'Contains', value: 'contains' },
									{ name: 'Starts With', value: 'startsWith' },
									{ name: 'Ends With', value: 'endsWith' },
									{ name: 'Greater Than', value: 'gt' },
									{ name: 'Less Than', value: 'lt' },
									{ name: 'Greater Than or Equal', value: 'gte' },
									{ name: 'Less Than or Equal', value: 'lte' },
									{ name: 'Is Empty', value: 'isEmpty' },
									{ name: 'Is Not Empty', value: 'isNotEmpty' },
									{ name: 'Regex', value: 'regex' },
									{ name: 'Not Regex', value: 'notRegex' },
								],
								default: 'equals',
							},
							{
								displayName: 'Value 2',
								name: 'value2',
								type: 'string',
								default: '',
								description: 'Second value for comparison',
								displayOptions: {
									hide: {
										operation: ['isEmpty', 'isNotEmpty'],
									},
								},
							},
						],
					},
				],
			},
			{
				displayName: 'Combine Conditions',
				name: 'combineConditions',
				type: 'options',
				options: [
					{
						name: 'AND',
						value: 'and',
						description: 'All conditions must be true',
					},
					{
						name: 'OR',
						value: 'or',
						description: 'At least one condition must be true',
					},
				],
				default: 'and',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const trueItems: INodeExecutionData[] = [];
		const falseItems: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const conditions = this.getNodeParameter(
					'conditions.values',
					i,
					[],
				) as Condition[];
				const combineMode = this.getNodeParameter('combineConditions', i, 'and') as string;

				let pass: boolean;

				if (conditions.length === 0) {
					pass = false;
				} else if (combineMode === 'and') {
					pass = conditions.every(evaluateCondition);
				} else {
					pass = conditions.some(evaluateCondition);
				}

				const item = items[i];
				if (item.pairedItem === undefined) {
					item.pairedItem = { item: i };
				}

				if (pass) {
					trueItems.push(item);
				} else {
					falseItems.push(item);
				}
			} catch (error) {
				if (this.continueOnFail()) {
					falseItems.push(items[i]);
				} else {
					throw new NodeOperationError(this.getNode(), error as Error, {
						itemIndex: i,
					});
				}
			}
		}

		return [trueItems, falseItems];
	}
}
