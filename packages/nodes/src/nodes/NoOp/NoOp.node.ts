import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

export class NoOp implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'No Operation, do nothing',
		name: 'n0n-nodes.noOp',
		group: ['organization'],
		version: 1,
		description: 'No operation — passes data through unchanged',
		defaults: {
			name: 'No Operation, do nothing',
		},
		inputs: [{ type: 'main' as const }],
		outputs: [{ type: 'main' as const }],
		properties: [],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return [this.getInputData()];
	}
}
