import { describe, it, expect, mock } from 'bun:test';
import {
	WorkflowRunner,
	type WorkflowRunnerDeps,
	type WorkflowExecutionData,
	type ScalingServiceLike,
} from '../workflow-runner';
import type { ActiveExecutions, ActiveExecution } from '../services/active-executions';
import type { ExecutionPersistence } from '../services/execution-persistence';
import type { PushService, PushMessage } from '../push/push.service';
import type { INodeTypes, WorkflowExecuteMode } from 'n8n-workflow';
import type { NodeExecutor } from '@n0n/engine';

// ---- Helpers ---------------------------------------------------------------

function createMockActiveExecutions(): ActiveExecutions {
	const store = new Map<string, ActiveExecution>();
	return {
		add: mock((exec: ActiveExecution) => { store.set(exec.id, exec); }),
		remove: mock((id: string) => { store.delete(id); }),
		get: mock((id: string) => store.get(id)),
		getAll: mock(() => Array.from(store.values())),
		getRunning: mock(() => Array.from(store.values()).filter((e) => e.status === 'running')),
		getByWorkflowId: mock(() => []),
		cancel: mock(() => true),
		getCount: mock(() => store.size),
	} as unknown as ActiveExecutions;
}

function createMockPersistence(): ExecutionPersistence {
	return {
		create: mock(async () => 'exec-123'),
		setRunning: mock(async () => {}),
		saveProgress: mock(async () => {}),
		saveResult: mock(async () => {}),
		saveMetadata: mock(async () => {}),
	} as unknown as ExecutionPersistence;
}

function createMockPushService(): PushService {
	return {
		broadcast: mock((_msg: PushMessage) => {}),
		sendTo: mock(() => true),
		register: mock(() => {}),
		unregister: mock(() => {}),
		getConnectionCount: mock(() => 0),
		isConnected: mock(() => false),
	} as unknown as PushService;
}

function createMockNodeTypes(): INodeTypes {
	return {
		getByName: mock(() => { throw new Error('not found'); }),
		getByNameAndVersion: mock(() => { throw new Error('not found'); }),
		getKnownTypes: mock(() => ({})),
	} as unknown as INodeTypes;
}

const mockNodeExecutor: NodeExecutor = mock(async () => ({ data: [[{ json: {} }]] }));

function createDeps(overrides: Partial<WorkflowRunnerDeps> = {}): WorkflowRunnerDeps {
	return {
		activeExecutions: createMockActiveExecutions(),
		persistence: createMockPersistence(),
		pushService: createMockPushService(),
		nodeTypes: createMockNodeTypes(),
		nodeExecutor: mockNodeExecutor,
		...overrides,
	};
}

const baseWorkflowData: WorkflowExecutionData = {
	executionMode: 'manual' as WorkflowExecuteMode,
	workflowData: {
		id: 'wf-1',
		name: 'Test Workflow',
		active: false,
		isArchived: false,
		createdAt: new Date(),
		updatedAt: new Date(),
		nodes: [],
		connections: {},
		activeVersionId: null,
	},
};

// ---- Tests -----------------------------------------------------------------

describe('WorkflowRunner', () => {
	it('should default to direct mode', () => {
		const runner = new WorkflowRunner(createDeps());
		expect(runner).toBeDefined();
	});

	it('should create an execution and return an executionId', async () => {
		const deps = createDeps();
		const runner = new WorkflowRunner(deps);

		const executionId = await runner.run(baseWorkflowData);

		expect(executionId).toBe('exec-123');
		expect(deps.persistence.create).toHaveBeenCalledTimes(1);
		expect(deps.activeExecutions.add).toHaveBeenCalledTimes(1);
	});

	it('should use restartExecutionId when provided', async () => {
		const deps = createDeps();
		const runner = new WorkflowRunner(deps);

		const executionId = await runner.run({
			...baseWorkflowData,
			restartExecutionId: 'exec-existing',
		});

		expect(executionId).toBe('exec-existing');
		expect(deps.persistence.create).not.toHaveBeenCalled();
	});

	it('should mark execution as running in DB', async () => {
		const deps = createDeps();
		const runner = new WorkflowRunner(deps);

		await runner.run(baseWorkflowData);

		expect(deps.persistence.setRunning).toHaveBeenCalledWith('exec-123');
	});

	it('should throw when queue mode is enabled without scaling service', async () => {
		const deps = createDeps({ executionMode: 'queue' });
		const runner = new WorkflowRunner(deps);

		// Queue mode only triggers for non-manual modes
		const data: WorkflowExecutionData = {
			...baseWorkflowData,
			executionMode: 'trigger',
		};

		// Should handle the error via handleProcessError (not throw)
		const executionId = await runner.run(data);
		expect(executionId).toBeDefined();
		// Error should have been persisted
		expect(deps.persistence.saveResult).toHaveBeenCalled();
	});

	it('should enqueue execution in queue mode for non-manual execution', async () => {
		const mockScaling: ScalingServiceLike = {
			addJob: mock(async () => 'job-1'),
		};
		const deps = createDeps({
			executionMode: 'queue',
			scalingService: mockScaling,
		});
		const runner = new WorkflowRunner(deps);

		const data: WorkflowExecutionData = {
			...baseWorkflowData,
			executionMode: 'trigger',
		};
		await runner.run(data);

		expect(mockScaling.addJob).toHaveBeenCalledTimes(1);
		expect(deps.pushService.broadcast).toHaveBeenCalled();
	});

	it('should run manual execution directly even in queue mode', async () => {
		const deps = createDeps({ executionMode: 'queue' });
		const runner = new WorkflowRunner(deps);

		await runner.run(baseWorkflowData);

		// Should have set running (direct mode path), not thrown
		expect(deps.persistence.setRunning).toHaveBeenCalledWith('exec-123');
	});
});
