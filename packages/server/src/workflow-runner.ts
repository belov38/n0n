import type {
	IRunExecutionData,
	IRun,
	INodeTypes,
	WorkflowExecuteMode,
	IPinData,
	IWorkflowBase,
	ExecutionStatus,
} from 'n8n-workflow';
import { Workflow, createRunExecutionData } from 'n8n-workflow';
import { WorkflowExecute, type NodeExecutor } from '@n0n/engine';
import type { ActiveExecutions } from './services/active-executions';
import type { ExecutionPersistence } from './services/execution-persistence';
import type { PushService } from './push/push.service';
import { getLifecycleHooksForRegularMain, type LifecycleHookDeps } from './execution-lifecycle/hooks';

// ---- Types ----------------------------------------------------------------

/** Minimal contract for the queue scaling service (from @n0n/queue). */
export interface QueueJobData {
	executionId: string;
	workflowId: string;
	mode: string;
}

/** Interface matching ScalingService.addJob(). Avoids hard dependency on @n0n/queue. */
export interface ScalingServiceLike {
	addJob(data: QueueJobData): Promise<string>;
}

/** Data passed to WorkflowRunner.run() to start an execution. */
export interface WorkflowExecutionData {
	executionMode: WorkflowExecuteMode;
	workflowData: IWorkflowBase;

	/** Pre-existing execution data (e.g. webhook payload or retry data). */
	executionData?: IRunExecutionData;

	/** Pin data overrides (manual/evaluation modes). */
	pinData?: IPinData;

	/** Destination node for partial execution. */
	destinationNode?: string;

	/** Start node override (for trigger restarts, partial runs). */
	startNode?: string;

	/** If resuming a previously waiting execution. */
	restartExecutionId?: string;

	/** Push connection ref for sending live updates to the editor. */
	pushRef?: string;

	/** Timeout override in seconds, from workflow settings. */
	executionTimeout?: number;
}

/** Dependencies injected into WorkflowRunner at construction time. */
export interface WorkflowRunnerDeps {
	activeExecutions: ActiveExecutions;
	persistence: ExecutionPersistence;
	pushService: PushService;
	nodeTypes: INodeTypes;
	nodeExecutor: NodeExecutor;

	/** Set to 'queue' to enable BullMQ delegation. Default is 'direct'. */
	executionMode?: 'direct' | 'queue';

	/** Lazy-loaded scaling service, required only when executionMode === 'queue'. */
	scalingService?: ScalingServiceLike;

	/** Global execution timeout in seconds. 0 means no timeout. */
	maxTimeout?: number;

	/** Dependencies for lifecycle hooks (statistics, etc.). */
	hookDeps?: LifecycleHookDeps;
}

// ---- WorkflowRunner -------------------------------------------------------

/**
 * Decides whether to execute a workflow directly or via BullMQ queue.
 * In direct mode, creates WorkflowExecute instances, attaches lifecycle hooks,
 * and manages the execution through ActiveExecutions.
 * In queue mode, delegates to ScalingService.addJob().
 */
export class WorkflowRunner {
	private readonly queueMode: boolean;
	private readonly activeExecutions: ActiveExecutions;
	private readonly persistence: ExecutionPersistence;
	private readonly pushService: PushService;
	private readonly nodeTypes: INodeTypes;
	private readonly nodeExecutor: NodeExecutor;
	private readonly scalingService?: ScalingServiceLike;
	private readonly maxTimeout: number;
	private readonly hookDeps?: LifecycleHookDeps;

	constructor(deps: WorkflowRunnerDeps) {
		this.queueMode =
			deps.executionMode === 'queue' || process.env.QUEUE_MODE === 'true';
		this.activeExecutions = deps.activeExecutions;
		this.persistence = deps.persistence;
		this.pushService = deps.pushService;
		this.nodeTypes = deps.nodeTypes;
		this.nodeExecutor = deps.nodeExecutor;
		this.scalingService = deps.scalingService;
		this.maxTimeout = deps.maxTimeout ?? 0;
		this.hookDeps = deps.hookDeps;
	}

	// ---- Public API ---------------------------------------------------------

	/**
	 * Main entry point. Registers the execution as active, then decides whether
	 * to run it directly or enqueue it for a worker.
	 * Returns the executionId immediately (execution runs in background).
	 */
	async run(data: WorkflowExecutionData): Promise<string> {
		const workflowId = data.workflowData.id;

		// Create a DB record and get the executionId
		const executionId =
			data.restartExecutionId ??
			(await this.persistence.create(workflowId, data.executionMode));

		// Track in active executions
		this.activeExecutions.add({
			id: executionId,
			workflowId,
			mode: data.executionMode,
			startedAt: new Date(),
			status: 'running',
		});

		const shouldEnqueue =
			this.queueMode && data.executionMode !== 'manual';

		try {
			if (shouldEnqueue) {
				await this.enqueueExecution(executionId, workflowId, data);
			} else {
				await this.runMainProcess(executionId, data);
			}
		} catch (error) {
			await this.handleProcessError(
				error instanceof Error ? error : new Error(String(error)),
				executionId,
				workflowId,
				data.executionMode,
			);
		}

		return executionId;
	}

	// ---- Direct execution ---------------------------------------------------

	/**
	 * Runs the workflow in the current process.
	 * Creates a Workflow instance, a WorkflowExecute instance, attaches
	 * lifecycle hooks, and starts execution.
	 */
	private async runMainProcess(
		executionId: string,
		data: WorkflowExecutionData,
	): Promise<void> {
		const workflowId = data.workflowData.id;

		// Resolve pin data for manual executions
		let pinData: IPinData | undefined;
		if (data.executionMode === 'manual') {
			pinData = data.pinData ?? data.workflowData.pinData;
		}

		// Build the Workflow object
		const workflow = new Workflow({
			id: workflowId,
			name: data.workflowData.name,
			nodes: data.workflowData.nodes,
			connections: data.workflowData.connections,
			active: data.workflowData.active,
			nodeTypes: this.nodeTypes,
			staticData: data.workflowData.staticData,
			settings: data.workflowData.settings,
			pinData,
		});

		// Create lifecycle hooks wired to persistence + push
		const hooks = this.hookDeps
			? getLifecycleHooksForRegularMain(
					executionId,
					workflowId,
					data.executionMode,
					this.hookDeps,
					{ pushRef: data.pushRef },
			  )
			: undefined;

		// Mark execution as running in DB
		await this.persistence.setRunning(executionId);

		// Compute timeout
		const workflowTimeout = this.resolveTimeout(data);
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

		// Create the engine
		const additionalData = {
			executionId,
			executionTimeoutTimestamp:
				workflowTimeout > 0 ? Date.now() + workflowTimeout * 1000 : undefined,
		};

		const workflowExecute = new WorkflowExecute(
			additionalData,
			data.executionMode,
			this.nodeExecutor,
			data.executionData ?? createRunExecutionData(),
			hooks,
		);

		// Wire cancel into active executions
		const activeEntry = this.activeExecutions.get(executionId);
		if (activeEntry) {
			activeEntry.cancel = () => workflowExecute.cancel();
		}

		// Start the execution (returns a promise that resolves with the full run)
		let executionPromise: Promise<IRun>;
		if (data.executionData) {
			// Resume from existing data (webhook, retry, waiting resume)
			executionPromise = workflowExecute.runFrom(workflow);
		} else if (data.startNode) {
			const startNode = workflow.getNode(data.startNode);
			executionPromise = workflowExecute.run(
				workflow,
				startNode ?? undefined,
				data.destinationNode,
				pinData,
			);
		} else {
			executionPromise = workflowExecute.run(
				workflow,
				undefined,
				data.destinationNode,
				pinData,
			);
		}

		// Set up soft timeout
		if (workflowTimeout > 0) {
			timeoutHandle = setTimeout(() => {
				workflowExecute.cancel();
			}, workflowTimeout * 1000);
		}

		// Handle completion in background (don't await -- caller gets executionId immediately)
		executionPromise
			.then(() => {
				if (timeoutHandle) clearTimeout(timeoutHandle);
				this.activeExecutions.remove(executionId);
			})
			.catch(async (error: Error) => {
				if (timeoutHandle) clearTimeout(timeoutHandle);
				await this.handleProcessError(
					error,
					executionId,
					workflowId,
					data.executionMode,
				);
			});
	}

	// ---- Queue execution ----------------------------------------------------

	/**
	 * Delegates execution to BullMQ via ScalingService.
	 * The worker process picks up the job and runs it independently.
	 */
	private async enqueueExecution(
		executionId: string,
		workflowId: string,
		data: WorkflowExecutionData,
	): Promise<void> {
		if (!this.scalingService) {
			throw new Error(
				'Queue mode enabled but no ScalingService provided. ' +
				'Pass scalingService in WorkflowRunnerDeps.',
			);
		}

		const jobData: QueueJobData = {
			executionId,
			workflowId,
			mode: data.executionMode,
		};

		await this.scalingService.addJob(jobData);

		// Notify editor that execution started (push)
		this.pushService.broadcast({
			type: 'executionStarted',
			data: { executionId, workflowId, mode: data.executionMode },
		});
	}

	// ---- Error handling -----------------------------------------------------

	/**
	 * Handles a fatal process error: builds a failed run result, persists it,
	 * and removes the execution from active tracking.
	 */
	private async handleProcessError(
		error: Error,
		executionId: string,
		workflowId: string,
		mode: WorkflowExecuteMode,
	): Promise<void> {
		const failedRunData: IRunExecutionData = createRunExecutionData();
		failedRunData.resultData.runData = {};
		// Store the error on the run data. The engine's IRun uses ExecutionBaseError
		// which is a class, but for process-level errors we just need the message.
		// The persistence layer serializes this to JSON anyway.
		(failedRunData.resultData as Record<string, unknown>).error = {
			message: error.message,
			stack: error.stack,
		};

		const status: ExecutionStatus = 'error';

		try {
			await this.persistence.saveResult(
				executionId,
				failedRunData,
				{},
				status,
			);
		} catch (persistError) {
			console.error(
				`Failed to persist error for execution ${executionId}:`,
				persistError,
			);
		}

		this.pushService.broadcast({
			type: 'executionFinished',
			data: { executionId, workflowId, mode, status: 'error' },
		});

		this.activeExecutions.remove(executionId);
	}

	// ---- Helpers ------------------------------------------------------------

	/**
	 * Resolve the effective timeout in seconds, clamped to maxTimeout.
	 * Returns 0 if no timeout is configured.
	 */
	private resolveTimeout(data: WorkflowExecutionData): number {
		const settings = data.workflowData.settings;
		const workflowTimeout =
			data.executionTimeout ??
			(settings?.executionTimeout as number | undefined) ??
			0;

		if (workflowTimeout <= 0) return 0;
		if (this.maxTimeout <= 0) return workflowTimeout;

		return Math.min(workflowTimeout, this.maxTimeout);
	}
}
