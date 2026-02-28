import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPairedItemData,
	ISourceData,
} from 'n8n-workflow';
import { deepCopy } from 'n8n-workflow';

interface SplitInBatchesContext {
	items: INodeExecutionData[];
	processedItems: INodeExecutionData[];
	currentRunIndex: number;
	maxRunIndex: number;
	sourceData: ISourceData;
	noItemsLeft: boolean;
	done: boolean;
}

export class SplitInBatches implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Loop Over Items',
		name: 'n0n-nodes.splitInBatches',
		group: ['organization'],
		version: 1,
		description: 'Split data into batches and iterate over each batch',
		defaults: {
			name: 'Loop Over Items',
			color: '#007755',
		},
		inputs: [{ type: 'main' as const }],
		outputs: [
			{ type: 'main' as const, displayName: 'loop' },
			{ type: 'main' as const, displayName: 'done' },
		],
		properties: [
			{
				displayName: 'Batch Size',
				name: 'batchSize',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				default: 10,
				description: 'The number of items to return with each call',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Reset',
						name: 'reset',
						type: 'boolean',
						default: false,
						description:
							'Whether to start again from the beginning, treating incoming data as a new set',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][] | null> {
		const items = this.getInputData().slice();
		const nodeContext = this.getContext('node') as SplitInBatchesContext;
		const batchSize = this.getNodeParameter('batchSize', 0) as number;
		const options = this.getNodeParameter('options', 0, {}) as IDataObject;

		const returnItems: INodeExecutionData[] = [];

		if (nodeContext.items === undefined || options.reset === true) {
			// First run: save all items and return first batch
			const sourceData = this.getInputSourceData();

			nodeContext.currentRunIndex = 0;
			nodeContext.maxRunIndex = Math.ceil(items.length / batchSize);
			nodeContext.sourceData = deepCopy(sourceData);

			returnItems.push(...items.splice(0, batchSize));

			nodeContext.items = [...items];
			nodeContext.processedItems = [];
		} else {
			// Subsequent runs: return next batch
			nodeContext.currentRunIndex += 1;
			returnItems.push(
				...(nodeContext.items as INodeExecutionData[]).splice(0, batchSize),
			);

			const addSourceOverwrite = (pairedItem: IPairedItemData | number): IPairedItemData => {
				if (typeof pairedItem === 'number') {
					return {
						item: pairedItem,
						sourceOverwrite: nodeContext.sourceData,
					};
				}
				return {
					...pairedItem,
					sourceOverwrite: nodeContext.sourceData,
				};
			};

			const getPairedItemInfo = (
				item: INodeExecutionData,
			): IPairedItemData | IPairedItemData[] => {
				if (item.pairedItem === undefined) {
					return {
						item: 0,
						sourceOverwrite: nodeContext.sourceData,
					};
				}
				if (Array.isArray(item.pairedItem)) {
					return item.pairedItem.map(addSourceOverwrite);
				}
				return addSourceOverwrite(item.pairedItem);
			};

			const sourceOverwrite = this.getInputSourceData();
			const newItems = items.map((item, index) => ({
				...item,
				pairedItem: { sourceOverwrite, item: index },
			}));

			nodeContext.processedItems = [...nodeContext.processedItems, ...newItems];

			for (const item of returnItems) {
				item.pairedItem = getPairedItemInfo(item);
			}
		}

		nodeContext.noItemsLeft = nodeContext.items.length === 0;

		if (returnItems.length === 0) {
			// All batches processed, output to "done" (index 1)
			nodeContext.done = true;
			return [returnItems, nodeContext.processedItems];
		}

		// Output batch to "loop" (index 0), empty to "done" (index 1)
		nodeContext.done = false;
		return [returnItems, []];
	}
}
