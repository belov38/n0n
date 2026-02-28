import type {
	IRunExecutionData,
	ITaskData,
	WorkflowExecuteMode,
	ExecutionStatus,
} from 'n8n-workflow';

export type HookFunction<TArgs extends unknown[]> = (
	this: ExecutionLifecycleHooks,
	...args: TArgs
) => Promise<void> | void;

export interface ExecutionLifecycleHookHandlers {
	/** Called before the workflow starts executing */
	workflowExecuteBefore: HookFunction<[workflowId: string, mode: WorkflowExecuteMode]>[];

	/** Called after the workflow finishes (success or error) */
	workflowExecuteAfter: HookFunction<
		[runData: IRunExecutionData, executionId: string, status: ExecutionStatus]
	>[];

	/** Called before each node starts executing */
	nodeExecuteBefore: HookFunction<[nodeName: string]>[];

	/** Called after each node finishes executing */
	nodeExecuteAfter: HookFunction<
		[nodeName: string, taskData: ITaskData, runExecutionData: IRunExecutionData]
	>[];

	/** Called when the workflow is cancelled */
	workflowExecuteCancel: HookFunction<[]>[];

	/** Called to save execution progress (after each node completes) */
	nodeSaveProgress: HookFunction<
		[executionId: string, runExecutionData: IRunExecutionData]
	>[];
}

export type ExecutionLifecycleHookName = keyof ExecutionLifecycleHookHandlers;

/**
 * Contains hooks that trigger at specific events in an execution's lifecycle.
 * Every hook has an array of callbacks to run.
 *
 * Infrastructure (DB saves, push notifications, statistics) is injected via
 * hooks, keeping the engine pure.
 */
export class ExecutionLifecycleHooks {
	readonly handlers: ExecutionLifecycleHookHandlers = {
		workflowExecuteBefore: [],
		workflowExecuteAfter: [],
		nodeExecuteBefore: [],
		nodeExecuteAfter: [],
		workflowExecuteCancel: [],
		nodeSaveProgress: [],
	};

	constructor(
		readonly executionId: string,
		readonly workflowId: string,
		readonly mode: WorkflowExecuteMode,
	) {}

	addHandler<K extends keyof ExecutionLifecycleHookHandlers>(
		hookName: K,
		...handlers: Array<ExecutionLifecycleHookHandlers[K][number]>
	): void {
		for (const handler of handlers) {
			(this.handlers[hookName] as Array<ExecutionLifecycleHookHandlers[K][number]>).push(
				handler,
			);
		}
	}

	async executeHook<K extends keyof ExecutionLifecycleHookHandlers>(
		hookName: K,
		args: Parameters<ExecutionLifecycleHookHandlers[K][number]>,
	): Promise<void> {
		const hooks = this.handlers[hookName];
		for (const hook of hooks) {
			const fn = hook as (
				this: ExecutionLifecycleHooks,
				...a: Parameters<ExecutionLifecycleHookHandlers[K][number]>
			) => Promise<void> | void;
			await fn.apply(this, args);
		}
	}
}
