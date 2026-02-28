import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

type MergeMode = 'append' | 'combine' | 'chooseBranch';
type CombinationMode = 'mergeByPosition' | 'mergeByField';
type JoinMode = 'inner' | 'left' | 'right' | 'full';

function getNestedValue(obj: IDataObject, path: string): unknown {
	const parts = path.split('.');
	let current: unknown = obj;
	for (const part of parts) {
		if (current === undefined || current === null || typeof current !== 'object') {
			return undefined;
		}
		current = (current as IDataObject)[part];
	}
	return current;
}

export class Merge implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Merge',
		name: 'n0n-nodes.merge',
		group: ['transform'],
		version: 1,
		description: 'Merges data from two inputs',
		defaults: {
			name: 'Merge',
		},
		inputs: [
			{ type: 'main' as const, displayName: 'Input 1' },
			{ type: 'main' as const, displayName: 'Input 2' },
		],
		outputs: [{ type: 'main' as const }],
		// Both branches required for chooseBranch, else any input suffices
		requiredInputs: '={{ $parameter["mode"] === "chooseBranch" ? [0, 1] : 1 }}',
		properties: [
			{
				displayName: 'Mode',
				name: 'mode',
				type: 'options',
				options: [
					{
						name: 'Append',
						value: 'append',
						description: 'All items of input 1, then all items of input 2',
					},
					{
						name: 'Combine',
						value: 'combine',
						description: 'Merge items together',
					},
					{
						name: 'Choose Branch',
						value: 'chooseBranch',
						description: 'Output only items from one of the inputs',
					},
				],
				default: 'append',
			},
			{
				displayName: 'Combination Mode',
				name: 'combinationMode',
				type: 'options',
				options: [
					{
						name: 'Merge By Position',
						value: 'mergeByPosition',
						description: 'Combine items based on their order',
					},
					{
						name: 'Merge By Field',
						value: 'mergeByField',
						description: 'Combine items with matching field values',
					},
				],
				default: 'mergeByPosition',
				displayOptions: {
					show: { mode: ['combine'] },
				},
			},
			{
				displayName: 'Join Mode',
				name: 'joinMode',
				type: 'options',
				options: [
					{ name: 'Inner Join', value: 'inner', description: 'Only matching items' },
					{
						name: 'Left Join',
						value: 'left',
						description: 'All from input 1, matched from input 2',
					},
					{
						name: 'Right Join',
						value: 'right',
						description: 'All from input 2, matched from input 1',
					},
					{
						name: 'Full Join',
						value: 'full',
						description: 'All items from both inputs',
					},
				],
				default: 'inner',
				displayOptions: {
					show: { mode: ['combine'], combinationMode: ['mergeByField'] },
				},
			},
			{
				displayName: 'Field to Match Input 1',
				name: 'mergeByField1',
				type: 'string',
				default: '',
				placeholder: 'e.g. id',
				displayOptions: {
					show: { mode: ['combine'], combinationMode: ['mergeByField'] },
				},
			},
			{
				displayName: 'Field to Match Input 2',
				name: 'mergeByField2',
				type: 'string',
				default: '',
				placeholder: 'e.g. id',
				displayOptions: {
					show: { mode: ['combine'], combinationMode: ['mergeByField'] },
				},
			},
			{
				displayName: 'Output',
				name: 'chooseBranchOutput',
				type: 'options',
				options: [
					{ name: 'Input 1', value: 'input1' },
					{ name: 'Input 2', value: 'input2' },
				],
				default: 'input1',
				displayOptions: {
					show: { mode: ['chooseBranch'] },
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const mode = this.getNodeParameter('mode', 0) as MergeMode;
		const returnData: INodeExecutionData[] = [];

		const input1 = this.getInputData(0) ?? [];
		const input2 = this.getInputData(1) ?? [];

		if (mode === 'append') {
			returnData.push(...input1, ...input2);
			return [returnData];
		}

		if (mode === 'chooseBranch') {
			const output = this.getNodeParameter('chooseBranchOutput', 0) as string;
			if (output === 'input1') {
				returnData.push(...input1);
			} else {
				returnData.push(...input2);
			}
			return [returnData];
		}

		// combine mode
		const combinationMode = this.getNodeParameter('combinationMode', 0) as CombinationMode;

		if (combinationMode === 'mergeByPosition') {
			const maxLen = Math.max(input1.length, input2.length);

			for (let i = 0; i < maxLen; i++) {
				const item1 = input1[i];
				const item2 = input2[i];

				if (item1 && item2) {
					returnData.push({
						json: { ...item1.json, ...item2.json },
						pairedItem: [
							{ item: i, input: 0 },
							{ item: i, input: 1 },
						],
					});
				} else if (item1) {
					returnData.push({ ...item1, pairedItem: { item: i, input: 0 } });
				} else if (item2) {
					returnData.push({ ...item2, pairedItem: { item: i, input: 1 } });
				}
			}

			return [returnData];
		}

		// mergeByField
		const field1 = this.getNodeParameter('mergeByField1', 0) as string;
		const field2 = this.getNodeParameter('mergeByField2', 0) as string;
		const joinMode = this.getNodeParameter('joinMode', 0) as JoinMode;

		if (!field1 || !field2) {
			throw new NodeOperationError(
				this.getNode(),
				'Both merge fields must be specified',
			);
		}

		// Index input2 by match field
		const input2Map = new Map<string, INodeExecutionData[]>();
		const input2Matched = new Set<number>();

		for (const item of input2) {
			const key = String(getNestedValue(item.json, field2) ?? '');
			if (!input2Map.has(key)) {
				input2Map.set(key, []);
			}
			input2Map.get(key)!.push(item);
		}

		// Process input1
		const input1Matched = new Set<number>();

		for (let i = 0; i < input1.length; i++) {
			const item1 = input1[i];
			const key = String(getNestedValue(item1.json, field1) ?? '');
			const matchingItems = input2Map.get(key);

			if (matchingItems && matchingItems.length > 0) {
				input1Matched.add(i);
				for (const item2 of matchingItems) {
					const idx2 = input2.indexOf(item2);
					input2Matched.add(idx2);
					returnData.push({
						json: { ...item1.json, ...item2.json },
						pairedItem: [
							{ item: i, input: 0 },
							{ item: idx2, input: 1 },
						],
					});
				}
			} else if (joinMode === 'left' || joinMode === 'full') {
				returnData.push({ ...item1, pairedItem: { item: i, input: 0 } });
			}
		}

		// For right/full join, add unmatched from input2
		if (joinMode === 'right' || joinMode === 'full') {
			for (let i = 0; i < input2.length; i++) {
				if (!input2Matched.has(i)) {
					returnData.push({ ...input2[i], pairedItem: { item: i, input: 1 } });
				}
			}
		}

		return [returnData];
	}
}
