import { describe, it, expect, beforeEach, mock } from 'bun:test';
import type {
	IRunExecutionData,
	ITaskData,
	ExecutionStatus,
	WorkflowExecuteMode,
} from 'n8n-workflow';

import {
	ExecutionLifecycleHooks,
	type ExecutionLifecycleHookHandlers,
} from '../execution-lifecycle-hooks';

describe('ExecutionLifecycleHooks', () => {
	const executionId = 'exec-123';
	const workflowId = 'wf-456';
	const mode: WorkflowExecuteMode = 'manual';

	let hooks: ExecutionLifecycleHooks;

	beforeEach(() => {
		hooks = new ExecutionLifecycleHooks(executionId, workflowId, mode);
	});

	describe('constructor', () => {
		it('should initialize with correct properties', () => {
			expect(hooks.executionId).toBe(executionId);
			expect(hooks.workflowId).toBe(workflowId);
			expect(hooks.mode).toBe(mode);
		});

		it('should initialize all handler arrays as empty', () => {
			const hookNames: Array<keyof ExecutionLifecycleHookHandlers> = [
				'workflowExecuteBefore',
				'workflowExecuteAfter',
				'nodeExecuteBefore',
				'nodeExecuteAfter',
				'workflowExecuteCancel',
				'nodeSaveProgress',
			];
			for (const name of hookNames) {
				expect(hooks.handlers[name]).toEqual([]);
			}
		});
	});

	describe('addHandler', () => {
		it('should register a single handler', () => {
			const handler = mock(async (_nodeName: string) => {});
			hooks.addHandler('nodeExecuteBefore', handler);
			expect(hooks.handlers.nodeExecuteBefore).toHaveLength(1);
		});

		it('should register multiple handlers in one call', () => {
			const h1 = mock(async (_nodeName: string) => {});
			const h2 = mock(async (_nodeName: string) => {});
			hooks.addHandler('nodeExecuteBefore', h1, h2);
			expect(hooks.handlers.nodeExecuteBefore).toHaveLength(2);
		});

		it('should accumulate handlers across multiple calls', () => {
			const h1 = mock(async (_nodeName: string) => {});
			const h2 = mock(async (_nodeName: string) => {});
			hooks.addHandler('nodeExecuteBefore', h1);
			hooks.addHandler('nodeExecuteBefore', h2);
			expect(hooks.handlers.nodeExecuteBefore).toHaveLength(2);
		});
	});

	describe('executeHook', () => {
		it('should execute without error when no handlers registered', async () => {
			await hooks.executeHook('nodeExecuteBefore', ['testNode']);
			await hooks.executeHook('workflowExecuteCancel', []);
			await hooks.executeHook('nodeSaveProgress', [
				executionId,
				{} as IRunExecutionData,
			]);
		});

		it('should pass arguments correctly to nodeExecuteBefore', async () => {
			const handler = mock(async (_nodeName: string) => {});
			hooks.addHandler('nodeExecuteBefore', handler);

			await hooks.executeHook('nodeExecuteBefore', ['myNode']);

			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith('myNode');
		});

		it('should pass arguments correctly to nodeExecuteAfter', async () => {
			const taskData = { startTime: Date.now() } as ITaskData;
			const runData = {} as IRunExecutionData;
			const handler = mock(
				async (
					_nodeName: string,
					_taskData: ITaskData,
					_runData: IRunExecutionData,
				) => {},
			);
			hooks.addHandler('nodeExecuteAfter', handler);

			await hooks.executeHook('nodeExecuteAfter', ['myNode', taskData, runData]);

			expect(handler).toHaveBeenCalledWith('myNode', taskData, runData);
		});

		it('should pass arguments correctly to workflowExecuteBefore', async () => {
			const handler = mock(
				async (_wfId: string, _mode: WorkflowExecuteMode) => {},
			);
			hooks.addHandler('workflowExecuteBefore', handler);

			await hooks.executeHook('workflowExecuteBefore', [workflowId, 'manual']);

			expect(handler).toHaveBeenCalledWith(workflowId, 'manual');
		});

		it('should pass arguments correctly to workflowExecuteAfter', async () => {
			const runData = {} as IRunExecutionData;
			const status: ExecutionStatus = 'success';
			const handler = mock(
				async (
					_runData: IRunExecutionData,
					_execId: string,
					_status: ExecutionStatus,
				) => {},
			);
			hooks.addHandler('workflowExecuteAfter', handler);

			await hooks.executeHook('workflowExecuteAfter', [
				runData,
				executionId,
				status,
			]);

			expect(handler).toHaveBeenCalledWith(runData, executionId, status);
		});

		it('should execute multiple handlers in registration order', async () => {
			const order: number[] = [];
			const h1 = mock(async () => {
				order.push(1);
			});
			const h2 = mock(async () => {
				order.push(2);
			});
			const h3 = mock(async () => {
				order.push(3);
			});

			hooks.addHandler('nodeExecuteBefore', h1, h2);
			hooks.addHandler('nodeExecuteBefore', h3);

			await hooks.executeHook('nodeExecuteBefore', ['testNode']);

			expect(order).toEqual([1, 2, 3]);
			expect(h1).toHaveBeenCalledTimes(1);
			expect(h2).toHaveBeenCalledTimes(1);
			expect(h3).toHaveBeenCalledTimes(1);
		});

		it('should bind `this` to the hooks instance', async () => {
			let capturedThis: ExecutionLifecycleHooks | undefined;
			const handler = async function (
				this: ExecutionLifecycleHooks,
				_nodeName: string,
			) {
				capturedThis = this;
			};
			hooks.addHandler('nodeExecuteBefore', handler);

			await hooks.executeHook('nodeExecuteBefore', ['testNode']);

			expect(capturedThis).toBe(hooks);
			expect(capturedThis!.executionId).toBe(executionId);
		});

		it('should propagate handler errors', async () => {
			const handler = mock(async () => {
				throw new Error('hook failed');
			});
			hooks.addHandler('workflowExecuteCancel', handler);

			await expect(
				hooks.executeHook('workflowExecuteCancel', []),
			).rejects.toThrow('hook failed');
		});

		it('should stop execution on first handler error', async () => {
			const h1 = mock(async () => {
				throw new Error('fail');
			});
			const h2 = mock(async () => {});

			hooks.addHandler('workflowExecuteCancel', h1, h2);

			await expect(
				hooks.executeHook('workflowExecuteCancel', []),
			).rejects.toThrow('fail');
			expect(h2).not.toHaveBeenCalled();
		});

		it('should support synchronous handlers', async () => {
			const called = { value: false };
			const handler = (_nodeName: string) => {
				called.value = true;
			};
			hooks.addHandler('nodeExecuteBefore', handler);

			await hooks.executeHook('nodeExecuteBefore', ['testNode']);

			expect(called.value).toBe(true);
		});
	});
});
