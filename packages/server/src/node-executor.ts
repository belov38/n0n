import type {
	IWorkflowExecuteAdditionalData,
	INodeExecutionData,
	IExecuteFunctions,
	ITriggerFunctions,
	IPollFunctions,
} from 'n8n-workflow';
import type { NodeExecutor } from '@n0n/engine';
import {
	ExecuteContext,
	TriggerContext,
	PollContext,
	type NodeExecutionContextOptions,
} from '@n0n/engine';

export function createNodeExecutor(
	additionalData: IWorkflowExecuteAdditionalData,
): NodeExecutor {
	return async (params) => {
		const {
			workflow,
			node,
			nodeType,
			mode,
			runExecutionData,
			runIndex,
			connectionInputData,
			inputData,
			executionData,
			abortSignal,
		} = params;

		const contextOptions: NodeExecutionContextOptions = {
			workflow,
			node,
			additionalData,
			mode,
			runExecutionData,
			runIndex,
			connectionInputData,
			inputData,
			executeData: executionData,
			abortSignal,
		};

		if (nodeType.execute) {
			const context = new ExecuteContext(contextOptions);
			const result = await nodeType.execute.call(
				context as unknown as IExecuteFunctions,
			);
			return { data: result as INodeExecutionData[][] | null | undefined };
		}

		if (nodeType.trigger) {
			const context = new TriggerContext({
				...contextOptions,
				activation: 'init',
			});
			await nodeType.trigger.call(context as unknown as ITriggerFunctions);
			return { data: null };
		}

		if (nodeType.poll) {
			const context = new PollContext({
				...contextOptions,
				activation: 'init',
			});
			const result = await nodeType.poll.call(
				context as unknown as IPollFunctions,
			);
			return { data: result };
		}

		throw new Error(
			`Node type "${node.type}" does not have an execute, trigger, or poll method`,
		);
	};
}
