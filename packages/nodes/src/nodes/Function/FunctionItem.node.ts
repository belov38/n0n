import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export class FunctionItem implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Function Item',
		name: 'n0n-nodes.functionItem',
		icon: 'fa:code',
		group: ['transform'],
		version: 1,
		description: 'Run custom function code which gets executed once per item',
		defaults: {
			name: 'Function Item',
			color: '#ddbb33',
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
				default: `// Code here will run once per input item.\n// Add a new field called 'myNewField' to the JSON of the item\nitem.myNewField = 1;\n\nreturn item;`,
				description: 'The JavaScript code to execute for each item',
				noDataExpression: true,
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			const functionCode = this.getNodeParameter(
				'functionCode',
				itemIndex,
			) as string;

			// Expose item.json data directly as `item` (matching n8n legacy behavior)
			const itemData: IDataObject = { ...items[itemIndex].json };

			try {
				const fn = new Function(
					'item',
					`return (async () => { ${functionCode} })();`,
				);

				const result: unknown = await fn(itemData);

				if (result === undefined || result === null) {
					throw new NodeOperationError(
						this.getNode(),
						'No data got returned. Always return an object!',
						{ itemIndex },
					);
				}

				if (typeof result !== 'object' || Array.isArray(result)) {
					throw new NodeOperationError(
						this.getNode(),
						'The returned value must be a plain object, not an array or primitive',
						{ itemIndex },
					);
				}

				const returnItem: INodeExecutionData = {
					json: result as IDataObject,
					pairedItem: { item: itemIndex },
				};

				if (items[itemIndex].binary) {
					returnItem.binary = items[itemIndex].binary;
				}

				returnData.push(returnItem);
			} catch (error) {
				if (this.continueOnFail()) {
					const message =
						error instanceof Error ? error.message : String(error);
					returnData.push({
						json: { error: message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				if (error instanceof NodeOperationError) {
					throw error;
				}
				const message =
					error instanceof Error ? error.message : String(error);
				throw new NodeOperationError(
					this.getNode(),
					`Code execution error: ${message} [Item Index: ${itemIndex}]`,
					{ itemIndex },
				);
			}
		}

		return [returnData];
	}
}
