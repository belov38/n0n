import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

type CodeExecutionMode = 'runOnceForAllItems' | 'runOnceForEachItem';

export class Code implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Code',
		name: 'n0n-nodes.code',
		group: ['transform'],
		version: 1,
		description: 'Run custom JavaScript code',
		defaults: {
			name: 'Code',
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
						name: 'Run Once for All Items',
						value: 'runOnceForAllItems',
						description: 'Run this code only once, no matter how many input items there are',
					},
					{
						name: 'Run Once for Each Item',
						value: 'runOnceForEachItem',
						description: 'Run this code as many times as there are input items',
					},
				],
				default: 'runOnceForAllItems',
			},
			{
				displayName: 'JavaScript Code',
				name: 'jsCode',
				type: 'string',
				typeOptions: {
					editor: 'jsEditor',
					rows: 10,
				},
				default:
					'// Run Once for All Items\nconst items = $input.all();\n\nreturn items;',
				displayOptions: {
					show: {
						mode: ['runOnceForAllItems'],
					},
				},
				description: 'JavaScript code to execute',
				noDataExpression: true,
			},
			{
				displayName: 'JavaScript Code',
				name: 'jsCode',
				type: 'string',
				typeOptions: {
					editor: 'jsEditor',
					rows: 10,
				},
				default:
					'// Run Once for Each Item\nconst item = $input.item;\n\nreturn item;',
				displayOptions: {
					show: {
						mode: ['runOnceForEachItem'],
					},
				},
				description: 'JavaScript code to execute for each item',
				noDataExpression: true,
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const mode = this.getNodeParameter('mode', 0) as CodeExecutionMode;
		const items = this.getInputData();

		if (mode === 'runOnceForAllItems') {
			return runAllItems(this, items);
		}
		return runEachItem(this, items);
	}
}

async function runAllItems(
	context: IExecuteFunctions,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[][]> {
	const code = context.getNodeParameter('jsCode', 0) as string;

	const allItems = items.map((item) => ({ json: { ...item.json } }));

	const sandbox = buildSandbox(allItems, allItems[0]?.json ?? {});

	try {
		const fn = new Function(
			'$input',
			'$json',
			'$items',
			`return (async () => { ${code} })();`,
		);

		const result = await fn(sandbox.$input, sandbox.$json, sandbox.$items);
		return [normalizeOutput(result, items)];
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new NodeOperationError(context.getNode(), `Code execution error: ${message}`);
	}
}

async function runEachItem(
	context: IExecuteFunctions,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[][]> {
	const returnData: INodeExecutionData[] = [];

	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		const code = context.getNodeParameter('jsCode', itemIndex) as string;
		const currentItem = items[itemIndex];
		const allItems = items.map((item) => ({ json: { ...item.json } }));

		const sandbox = buildSandbox(allItems, currentItem.json, currentItem);

		try {
			const fn = new Function(
				'$input',
				'$json',
				'$items',
				`return (async () => { ${code} })();`,
			);

			const result = await fn(sandbox.$input, sandbox.$json, sandbox.$items);

			if (result === undefined || result === null) {
				continue;
			}

			if (Array.isArray(result)) {
				for (const entry of result) {
					returnData.push({
						json: typeof entry === 'object' && entry !== null && 'json' in entry
							? (entry as INodeExecutionData).json
							: (entry as IDataObject),
						pairedItem: { item: itemIndex },
					});
				}
			} else if (typeof result === 'object' && result !== null) {
				const data = 'json' in result
					? (result as INodeExecutionData).json
					: (result as IDataObject);
				returnData.push({
					json: data,
					pairedItem: { item: itemIndex },
				});
			}
		} catch (error) {
			if (context.continueOnFail()) {
				const message = error instanceof Error ? error.message : String(error);
				returnData.push({
					json: { error: message },
					pairedItem: { item: itemIndex },
				});
				continue;
			}
			const message = error instanceof Error ? error.message : String(error);
			throw new NodeOperationError(context.getNode(), `Code execution error: ${message}`, {
				itemIndex,
			});
		}
	}

	return [returnData];
}

interface CodeSandbox {
	$input: {
		all: () => INodeExecutionData[];
		first: () => INodeExecutionData | undefined;
		last: () => INodeExecutionData | undefined;
		item: INodeExecutionData | undefined;
	};
	$json: IDataObject;
	$items: () => INodeExecutionData[];
}

function buildSandbox(
	allItems: INodeExecutionData[],
	firstJson: IDataObject,
	currentItem?: INodeExecutionData,
): CodeSandbox {
	return {
		$input: {
			all: () => allItems,
			first: () => allItems[0],
			last: () => allItems[allItems.length - 1],
			item: currentItem,
		},
		$json: firstJson,
		$items: () => allItems,
	};
}

function normalizeOutput(
	result: unknown,
	originalItems: INodeExecutionData[],
): INodeExecutionData[] {
	if (result === undefined || result === null) {
		return [];
	}

	if (Array.isArray(result)) {
		return result.map((entry, index) => {
			if (typeof entry === 'object' && entry !== null && 'json' in entry) {
				return {
					json: (entry as INodeExecutionData).json,
					pairedItem: { item: index },
				};
			}
			return {
				json: typeof entry === 'object' && entry !== null ? (entry as IDataObject) : { data: entry },
				pairedItem: { item: index },
			};
		});
	}

	if (typeof result === 'object' && result !== null) {
		if ('json' in result) {
			return [{ json: (result as INodeExecutionData).json, pairedItem: { item: 0 } }];
		}
		return [{ json: result as IDataObject, pairedItem: { item: 0 } }];
	}

	return [{ json: { data: result }, pairedItem: { item: 0 } }];
}
