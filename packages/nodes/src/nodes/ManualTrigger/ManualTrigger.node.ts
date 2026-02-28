import type {
	INodeType,
	INodeTypeDescription,
	ITriggerFunctions,
	ITriggerResponse,
} from 'n8n-workflow';

export class ManualTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Manual Trigger',
		name: 'n0n-nodes.manualTrigger',
		group: ['trigger'],
		version: 1,
		description: 'Runs the workflow on clicking a button in n0n',
		eventTriggerDescription: '',
		maxNodes: 1,
		defaults: {
			name: 'When clicking "Test workflow"',
		},
		inputs: [],
		outputs: [{ type: 'main' as const }],
		properties: [],
	};

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const manualTriggerFunction = async () => {
			this.emit([this.helpers.returnJsonArray([{}])]);
		};

		return { manualTriggerFunction };
	}
}
