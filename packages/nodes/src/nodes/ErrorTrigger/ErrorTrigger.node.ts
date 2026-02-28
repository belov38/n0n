import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	ITriggerFunctions,
	ITriggerResponse,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

export class ErrorTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Error Trigger',
		name: 'n0n-nodes.errorTrigger',
		group: ['trigger'],
		version: 1,
		description: 'Triggers when a workflow execution fails',
		eventTriggerDescription: '',
		maxNodes: 1,
		defaults: {
			name: 'Error Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		properties: [],
	};

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		// Triggered externally by the engine error handling system
		return {};
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		return [items];
	}
}
