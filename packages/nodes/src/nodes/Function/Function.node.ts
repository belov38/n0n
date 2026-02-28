import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const DynamicFunction = globalThis.Function;

export class Function implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Function',
		name: 'n0n-nodes.function',
		icon: 'fa:code',
		group: ['transform'],
		version: 1,
		description:
			'Run custom function code which gets executed once and allows you to add, remove, change and replace items',
		defaults: {
			name: 'Function',
			color: '#FF9922',
		},
		inputs: [{ type: 'main' as const }],
		outputs: [{ type: 'main' as const }],
		properties: [
			{
				displayName:
					'A newer version of this node type is available, called the "Code" node',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'JavaScript Code',
				name: 'functionCode',
				typeOptions: {
					alwaysOpenEditWindow: true,
					editor: 'jsEditor',
					rows: 10,
				},
				type: 'string',
				default: `// Code here will run only once, no matter how many input items there are.\n// Loop over inputs and add a new field called 'myNewField' to the JSON of each one\nfor (const item of items) {\n  item.json.myNewField = 1;\n}\n\nreturn items;`,
				description: 'The JavaScript code to execute',
				noDataExpression: true,
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const functionCode = this.getNodeParameter('functionCode', 0) as string;

		// Deep-copy items so user code cannot mutate originals
		const itemsCopy: INodeExecutionData[] = items.map((item, index) => ({
			json: { ...item.json },
			pairedItem: { item: index },
			...(item.binary ? { binary: item.binary } : {}),
		}));

		try {
			const fn = new DynamicFunction(
				'items',
				`return (async () => { ${functionCode} })();`,
			);

			const result: unknown = await fn(itemsCopy);

			if (result === undefined || result === null) {
				throw new NodeOperationError(
					this.getNode(),
					'No data got returned. Always return an Array of items!',
				);
			}

			if (!Array.isArray(result)) {
				throw new NodeOperationError(
					this.getNode(),
					'Always an Array of items has to be returned!',
				);
			}

			const normalizedItems = normalizeItems(result);
			return [normalizedItems];
		} catch (error) {
			if (this.continueOnFail()) {
				const message =
					error instanceof Error ? error.message : String(error);
				return [[{ json: { error: message } }]];
			}
			if (error instanceof NodeOperationError) {
				throw error;
			}
			const message =
				error instanceof Error ? error.message : String(error);
			throw new NodeOperationError(
				this.getNode(),
				`Code execution error: ${message}`,
			);
		}
	}
}

/**
 * Normalize raw results from user code into proper INodeExecutionData[].
 * Each item must have a `json` property that is a plain object.
 */
function normalizeItems(result: unknown[]): INodeExecutionData[] {
	return result.map((entry, index) => {
		if (
			typeof entry === 'object' &&
			entry !== null &&
			'json' in entry &&
			typeof (entry as INodeExecutionData).json === 'object'
		) {
			return {
				json: (entry as INodeExecutionData).json,
				pairedItem: { item: index },
				...('binary' in entry && (entry as INodeExecutionData).binary
					? { binary: (entry as INodeExecutionData).binary }
					: {}),
			};
		}

		if (typeof entry === 'object' && entry !== null) {
			return {
				json: entry as IDataObject,
				pairedItem: { item: index },
			};
		}

		return {
			json: { data: entry } as IDataObject,
			pairedItem: { item: index },
		};
	});
}
