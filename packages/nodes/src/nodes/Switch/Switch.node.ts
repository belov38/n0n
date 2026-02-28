import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

type SwitchMode = 'rules' | 'expression';

interface RuleCondition {
	value1: string;
	operation: string;
	value2: string;
}

interface Rule {
	conditions: RuleCondition[];
	outputIndex: number;
}

function evaluateRuleCondition(condition: RuleCondition): boolean {
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
		case 'regex':
			return new RegExp(value2).test(String(value1));
		case 'notRegex':
			return !new RegExp(value2).test(String(value1));
		default:
			return false;
	}
}

export class Switch implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Switch',
		name: 'n0n-nodes.switch',
		group: ['transform'],
		version: 1,
		description: 'Route items to different outputs based on rules',
		defaults: {
			name: 'Switch',
			color: '#506000',
		},
		inputs: [{ type: 'main' as const }],
		outputs: `={{(${configuredOutputs})($parameter)}}`,
		properties: [
			{
				displayName: 'Mode',
				name: 'mode',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Rules',
						value: 'rules',
						description: 'Build a matching rule for each output',
					},
					{
						name: 'Expression',
						value: 'expression',
						description: 'Write an expression to return the output index',
					},
				],
				default: 'rules',
			},
			{
				displayName: 'Number of Outputs',
				name: 'numberOutputs',
				type: 'number',
				displayOptions: {
					show: { mode: ['expression'] },
				},
				default: 4,
				description: 'How many outputs to create',
			},
			{
				displayName: 'Output Index',
				name: 'output',
				type: 'number',
				displayOptions: {
					show: { mode: ['expression'] },
				},
				default: 0,
				description: 'The output index to route each item to (expression)',
			},
			{
				displayName: 'Routing Rules',
				name: 'rules',
				placeholder: 'Add Routing Rule',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
					sortable: true,
				},
				default: { values: [] },
				displayOptions: {
					show: { mode: ['rules'] },
				},
				options: [
					{
						name: 'values',
						displayName: 'Rule',
						values: [
							{
								displayName: 'Value 1',
								name: 'value1',
								type: 'string',
								default: '',
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
							},
							{
								displayName: 'Output Index',
								name: 'outputIndex',
								type: 'number',
								default: 0,
								description: 'Index of the output to route matching items to',
							},
						],
					},
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Fallback Output',
						name: 'fallbackOutput',
						type: 'options',
						options: [
							{
								name: 'None',
								value: 'none',
								description: 'Items will be ignored if no rule matches',
							},
							{
								name: 'Extra Output',
								value: 'extra',
								description: 'Items will be sent to an extra output',
							},
						],
						default: 'none',
						description: 'What to do when no rule matches',
					},
					{
						displayName: 'Send to All Matches',
						name: 'allMatchingOutputs',
						type: 'boolean',
						default: false,
						description:
							'Whether to send items to all matching outputs instead of only the first match',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const mode = this.getNodeParameter('mode', 0) as SwitchMode;

		let returnData: INodeExecutionData[][] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const item = items[itemIndex];
				item.pairedItem = { item: itemIndex };

				if (mode === 'expression') {
					const numberOutputs = this.getNodeParameter('numberOutputs', itemIndex) as number;
					if (itemIndex === 0) {
						returnData = Array.from({ length: numberOutputs }, () => []);
					}
					const outputIndex = this.getNodeParameter('output', itemIndex) as number;

					if (outputIndex < 0 || outputIndex >= returnData.length) {
						throw new NodeOperationError(
							this.getNode(),
							`Output index ${outputIndex} is out of range (0-${returnData.length - 1})`,
							{ itemIndex },
						);
					}

					returnData[outputIndex].push(item);
				} else {
					const rules = this.getNodeParameter(
						'rules.values',
						itemIndex,
						[],
					) as Rule[];
					const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
					const fallbackOutput = options.fallbackOutput as string | undefined;
					const allMatchingOutputs = options.allMatchingOutputs === true;

					if (itemIndex === 0) {
						const outputCount =
							rules.length + (fallbackOutput === 'extra' ? 1 : 0);
						returnData = Array.from(
							{ length: Math.max(outputCount, 1) },
							() => [],
						);
					}

					let matchFound = false;

					for (const rule of rules) {
						const conditions = Array.isArray(rule.conditions)
							? rule.conditions
							: [rule as unknown as RuleCondition];

						const conditionPass = conditions.every(evaluateRuleCondition);

						if (conditionPass) {
							matchFound = true;
							const targetIndex = (rule as { outputIndex?: number }).outputIndex ?? 0;

							if (targetIndex >= 0 && targetIndex < returnData.length) {
								returnData[targetIndex].push(item);
							}

							if (!allMatchingOutputs) {
								break;
							}
						}
					}

					if (!matchFound && fallbackOutput !== undefined && fallbackOutput !== 'none') {
						if (fallbackOutput === 'extra') {
							returnData[returnData.length - 1].push(item);
						}
					}
				}
			} catch (error) {
				if (this.continueOnFail()) {
					if (returnData.length > 0) {
						returnData[0].push({ json: { error: (error as Error).message } });
					}
					continue;
				}
				if (error instanceof NodeOperationError) {
					throw error;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		if (!returnData.length) return [[]];
		return returnData;
	}
}

function configuredOutputs(parameters: IDataObject): Array<{ type: string; displayName: string }> {
	const mode = parameters.mode as string;

	if (mode === 'expression') {
		return Array.from({ length: (parameters.numberOutputs as number) || 4 }, (_, i) => ({
			type: 'main',
			displayName: i.toString(),
		}));
	}

	const rules = ((parameters.rules as IDataObject)?.values as IDataObject[]) ?? [];
	const outputs = rules.map((_, index) => ({
		type: 'main',
		displayName: index.toString(),
	}));

	if ((parameters.options as IDataObject)?.fallbackOutput === 'extra') {
		outputs.push({ type: 'main', displayName: 'Fallback' });
	}

	// At least one output
	if (outputs.length === 0) {
		outputs.push({ type: 'main', displayName: '0' });
	}

	return outputs;
}
