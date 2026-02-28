import { ExecutionLifecycleHooks } from '@n0n/engine';
import type { ExecutionPersistence } from '../services/execution-persistence';
import type { ActiveExecutions } from '../services/active-executions';
import type { PushService, PushMessage } from '../push/push.service';
import type { WorkflowStatisticsRepo } from '@n0n/db';
import type {
	WorkflowExecuteMode,
	ExecutionStatus,
	IRunExecutionData,
} from 'n8n-workflow';

// ---------------------------------------------------------------------------
// Dependencies interface
// ---------------------------------------------------------------------------

export interface LifecycleHookDeps {
	persistence: ExecutionPersistence;
	statisticsRepo: WorkflowStatisticsRepo;
	pushService: PushService;
	activeExecutions: ActiveExecutions;
}

export interface LifecycleHookOptions {
	/** Push ref for targeted push messages (session that started the execution) */
	pushRef?: string;
	/** Whether to save execution progress after each node */
	saveProgress?: boolean;
	/** Execution this is a retry of */
	retryOf?: string;
}

// ---------------------------------------------------------------------------
// Shared hook helpers
// ---------------------------------------------------------------------------

function determineFinalStatus(runData: IRunExecutionData): ExecutionStatus {
	const resultError = runData.resultData?.error;
	if (resultError) return 'error';
	return 'success';
}

/**
 * Send a push message directly via WebSocket (regular mode).
 * When pushRef is set, sends to the specific session; otherwise broadcasts.
 */
function pushDirect(
	pushService: PushService,
	pushRef: string | undefined,
	message: PushMessage,
): void {
	if (pushRef) {
		pushService.sendTo(pushRef, message);
	} else {
		pushService.broadcast(message);
	}
}

// ---------------------------------------------------------------------------
// Hook wiring functions
// ---------------------------------------------------------------------------

/**
 * Hooks that set execution status to running and persist the initial record.
 */
function addWorkflowStartHooks(
	hooks: ExecutionLifecycleHooks,
	deps: LifecycleHookDeps,
	opts: LifecycleHookOptions,
	sendPush: (message: PushMessage) => void,
): void {
	hooks.addHandler('workflowExecuteBefore', async (workflowId, mode) => {
		await deps.persistence.setRunning(hooks.executionId);

		sendPush({
			type: 'executionStarted',
			data: {
				executionId: hooks.executionId,
				workflowId,
				mode,
				startedAt: new Date().toISOString(),
				retryOf: opts.retryOf,
			},
		});
	});
}

/**
 * Hooks that push node lifecycle events to the frontend.
 */
function addNodePushHooks(
	hooks: ExecutionLifecycleHooks,
	sendPush: (message: PushMessage) => void,
): void {
	hooks.addHandler('nodeExecuteBefore', async (nodeName) => {
		sendPush({
			type: 'nodeExecuteBefore',
			data: { executionId: hooks.executionId, nodeName },
		});
	});

	hooks.addHandler('nodeExecuteAfter', async (nodeName, _taskData, _runExecutionData) => {
		sendPush({
			type: 'nodeExecuteAfter',
			data: { executionId: hooks.executionId, nodeName },
		});
	});
}

/**
 * Hook that saves execution progress to DB after each node completes.
 * Only attached when saveProgress option is enabled.
 */
function addProgressHook(
	hooks: ExecutionLifecycleHooks,
	deps: LifecycleHookDeps,
): void {
	hooks.addHandler('nodeExecuteAfter', async (_nodeName, _taskData, runExecutionData) => {
		try {
			await deps.persistence.saveProgress(hooks.executionId, runExecutionData, {});
		} catch {
			// Progress save failure should not abort the execution.
			// The final result will still be saved in workflowExecuteAfter.
		}
	});
}

/**
 * Hook that saves the final execution result to DB, updates statistics,
 * cleans up active executions, and pushes the finished event.
 */
function addWorkflowFinishHooks(
	hooks: ExecutionLifecycleHooks,
	deps: LifecycleHookDeps,
	opts: LifecycleHookOptions,
	sendPush: (message: PushMessage) => void,
): void {
	hooks.addHandler('workflowExecuteAfter', async (runData, executionId, status) => {
		const finalStatus = status ?? determineFinalStatus(runData);

		// Persist final result
		await deps.persistence.saveResult(executionId, runData, {}, finalStatus);

		// Update workflow statistics
		const statName = finalStatus === 'success' ? 'production_success' : 'production_error';
		try {
			await deps.statisticsRepo.increment(hooks.workflowId, statName);
		} catch {
			// Statistics failure should not break execution lifecycle
		}

		// Push execution finished event
		sendPush({
			type: 'executionFinished',
			data: {
				executionId,
				workflowId: hooks.workflowId,
				status: finalStatus,
				retryOf: opts.retryOf,
			},
		});

		// Clean up active execution tracking
		deps.activeExecutions.remove(executionId);
	});
}

/**
 * Hook that removes the execution from activeExecutions when cancelled.
 */
function addCancelHook(
	hooks: ExecutionLifecycleHooks,
	deps: LifecycleHookDeps,
): void {
	hooks.addHandler('workflowExecuteCancel', async () => {
		deps.activeExecutions.remove(hooks.executionId);
	});
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Creates lifecycle hooks for direct execution mode (no queue).
 *
 * Wired with:
 * - workflowExecuteBefore: set status to running, push executionStarted
 * - nodeExecuteBefore/After: push node events to frontend
 * - nodeExecuteAfter (optional): save execution progress
 * - workflowExecuteAfter: save final result, update statistics, push executionFinished, clean up
 * - workflowExecuteCancel: clean up active executions
 */
export function getLifecycleHooksForRegularMain(
	executionId: string,
	workflowId: string,
	mode: WorkflowExecuteMode,
	deps: LifecycleHookDeps,
	opts: LifecycleHookOptions = {},
): ExecutionLifecycleHooks {
	const hooks = new ExecutionLifecycleHooks(executionId, workflowId, mode);

	const sendPush = (message: PushMessage) => {
		pushDirect(deps.pushService, opts.pushRef, message);
	};

	addWorkflowStartHooks(hooks, deps, opts, sendPush);
	addNodePushHooks(hooks, sendPush);

	if (opts.saveProgress) {
		addProgressHook(hooks, deps);
	}

	addWorkflowFinishHooks(hooks, deps, opts, sendPush);
	addCancelHook(hooks, deps);

	return hooks;
}

/**
 * Creates lifecycle hooks for a queue worker process.
 *
 * Same as regular main, but push events are broadcast (no pushRef targeting)
 * since the frontend session lives on the main process, not the worker.
 * In a full implementation, these would relay via pub/sub (Redis) so
 * the main process can forward to the correct WebSocket session.
 *
 * Wired with:
 * - workflowExecuteBefore: set status to running, broadcast executionStarted
 * - nodeExecuteBefore/After: broadcast node events (relayed via pub/sub)
 * - nodeExecuteAfter (optional): save execution progress
 * - workflowExecuteAfter: save final result, update statistics, broadcast executionFinished
 * - workflowExecuteCancel: clean up active executions
 */
export function getLifecycleHooksForScalingWorker(
	executionId: string,
	workflowId: string,
	mode: WorkflowExecuteMode,
	deps: LifecycleHookDeps,
	opts: LifecycleHookOptions = {},
): ExecutionLifecycleHooks {
	const hooks = new ExecutionLifecycleHooks(executionId, workflowId, mode);

	// Workers always broadcast - the main process picks up these events
	// via pub/sub and routes them to the correct WebSocket session.
	const sendPush = (message: PushMessage) => {
		deps.pushService.broadcast(message);
	};

	addWorkflowStartHooks(hooks, deps, opts, sendPush);
	addNodePushHooks(hooks, sendPush);

	if (opts.saveProgress) {
		addProgressHook(hooks, deps);
	}

	addWorkflowFinishHooks(hooks, deps, opts, sendPush);
	addCancelHook(hooks, deps);

	return hooks;
}

/**
 * Creates lifecycle hooks for the main process in scaling (queue) mode.
 *
 * The main process only tracks workflow-level metadata. Node execution
 * is handled entirely by the worker, so node hooks are intentionally omitted.
 *
 * Wired with:
 * - workflowExecuteBefore: push executionStarted to the session that triggered it
 * - workflowExecuteAfter: push executionFinished, clean up active executions
 * - workflowExecuteCancel: clean up active executions
 */
export function getLifecycleHooksForScalingMain(
	executionId: string,
	workflowId: string,
	mode: WorkflowExecuteMode,
	deps: LifecycleHookDeps,
	opts: LifecycleHookOptions = {},
): ExecutionLifecycleHooks {
	const hooks = new ExecutionLifecycleHooks(executionId, workflowId, mode);

	const sendPush = (message: PushMessage) => {
		pushDirect(deps.pushService, opts.pushRef, message);
	};

	// Workflow start: only push notification, no DB status update
	// (worker handles the actual execution lifecycle)
	hooks.addHandler('workflowExecuteBefore', async (wfId, wfMode) => {
		sendPush({
			type: 'executionStarted',
			data: {
				executionId: hooks.executionId,
				workflowId: wfId,
				mode: wfMode,
				startedAt: new Date().toISOString(),
				retryOf: opts.retryOf,
			},
		});
	});

	// Workflow finish: push notification and cleanup only.
	// DB persistence and statistics are handled by the worker.
	hooks.addHandler('workflowExecuteAfter', async (_runData, execId, status) => {
		sendPush({
			type: 'executionFinished',
			data: {
				executionId: execId,
				workflowId: hooks.workflowId,
				status: status ?? 'unknown',
				retryOf: opts.retryOf,
			},
		});

		deps.activeExecutions.remove(execId);
	});

	addCancelHook(hooks, deps);

	return hooks;
}
