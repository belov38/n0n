import type { ExecutionRepo, ExecutionDataRepo, Execution } from '@n0n/db';
import type { IRunExecutionData, IWorkflowBase } from 'n8n-workflow';
import type { ActiveExecutions } from './active-executions';
import type { BinaryDataService } from '../binary-data/binary-data.service';
import type { WorkflowRunner } from '../workflow-runner';

export class ExecutionNotFoundError extends Error {
	constructor(id: string) {
		super(`Execution "${id}" not found`);
		this.name = 'ExecutionNotFoundError';
	}
}

export class ExecutionNotStoppableError extends Error {
	constructor(id: string, status: string) {
		super(`Execution "${id}" is "${status}" and cannot be stopped`);
		this.name = 'ExecutionNotStoppableError';
	}
}

export class ExecutionNotRetryableError extends Error {
	constructor(id: string, reason: string) {
		super(`Execution "${id}" cannot be retried: ${reason}`);
		this.name = 'ExecutionNotRetryableError';
	}
}

export interface FindManyParams {
	workflowId?: string;
	status?: string;
	startedAfter?: Date;
	startedBefore?: Date;
	limit?: number;
	cursor?: string;
}

export interface ExecutionWithData extends Execution {
	data: IRunExecutionData | null;
	/** The workflow snapshot stored at execution time, cast from jsonb. */
	workflowData: IWorkflowBase | null;
}

const STOPPABLE_STATUSES = new Set(['new', 'running', 'waiting', 'unknown']);

export class ExecutionService {
	constructor(
		private executionRepo: ExecutionRepo,
		private executionDataRepo: ExecutionDataRepo,
		private activeExecutions: ActiveExecutions,
		private binaryDataService: BinaryDataService,
		private workflowRunner: WorkflowRunner,
	) {}

	async findMany(params: FindManyParams): Promise<{
		results: Execution[];
		nextCursor: string | null;
	}> {
		const limit = params.limit ?? 20;

		const results = await this.executionRepo.findMany({
			workflowId: params.workflowId,
			status: params.status,
			startedAfter: params.startedAfter,
			startedBefore: params.startedBefore,
			limit: limit + 1, // fetch one extra to determine if there's a next page
			cursor: params.cursor ? Number(params.cursor) : undefined,
		});

		let nextCursor: string | null = null;
		if (results.length > limit) {
			const lastItem = results.pop()!;
			nextCursor = String(lastItem.id);
		}

		return { results, nextCursor };
	}

	async findById(id: string): Promise<ExecutionWithData> {
		const numId = Number(id);
		const exec = await this.executionRepo.findById(numId);
		if (!exec) throw new ExecutionNotFoundError(id);

		const execData = await this.executionDataRepo.findByExecutionId(numId);

		return {
			...exec,
			data: execData ? (JSON.parse(execData.data) as IRunExecutionData) : null,
			workflowData: execData ? (execData.workflowData as unknown as IWorkflowBase) : null,
		};
	}

	async stop(id: string): Promise<{ success: true }> {
		// First check if it's an in-memory active execution
		const active = this.activeExecutions.get(id);
		if (active) {
			if (!STOPPABLE_STATUSES.has(active.status)) {
				throw new ExecutionNotStoppableError(id, active.status);
			}
			this.activeExecutions.cancel(id);
			// Mark as canceled in DB
			await this.executionRepo.updateStatus(Number(id), 'canceled', {
				stoppedAt: new Date(),
			});
			return { success: true };
		}

		// Not in active executions, check DB
		const exec = await this.executionRepo.findById(Number(id));
		if (!exec) throw new ExecutionNotFoundError(id);

		if (!STOPPABLE_STATUSES.has(exec.status)) {
			throw new ExecutionNotStoppableError(id, exec.status);
		}

		// Mark as canceled in DB (execution may be running in a different process in queue mode)
		await this.executionRepo.updateStatus(Number(id), 'canceled', {
			stoppedAt: new Date(),
		});
		return { success: true };
	}

	async retry(id: string): Promise<{ executionId: string }> {
		const fullExec = await this.findById(id);

		if (fullExec.finished) {
			throw new ExecutionNotRetryableError(id, 'execution succeeded');
		}
		if (fullExec.status === 'new') {
			throw new ExecutionNotRetryableError(id, 'execution is queued and has not run yet');
		}
		if (!fullExec.data) {
			throw new ExecutionNotRetryableError(id, 'execution data is missing');
		}
		if (!fullExec.workflowData) {
			throw new ExecutionNotRetryableError(id, 'workflow data is missing');
		}

		// Clear the previous error from run data so the engine retries from last failed node
		const retryData = { ...fullExec.data };
		if (retryData.resultData) {
			delete retryData.resultData.error;
			const { lastNodeExecuted } = retryData.resultData;
			if (lastNodeExecuted && retryData.resultData.runData[lastNodeExecuted]) {
				const nodeRuns = retryData.resultData.runData[lastNodeExecuted];
				if (nodeRuns.length > 0 && nodeRuns[nodeRuns.length - 1].error !== undefined) {
					nodeRuns.pop();
				}
			}
		}

		const newExecutionId = await this.workflowRunner.run({
			executionMode: 'retry',
			workflowData: fullExec.workflowData,
			executionData: retryData,
		});

		return { executionId: newExecutionId };
	}

	async delete(id: string): Promise<void> {
		const numId = Number(id);
		const exec = await this.executionRepo.findById(numId);
		if (!exec) throw new ExecutionNotFoundError(id);

		// Delete binary data for this execution
		await this.binaryDataService.deleteExecutionData(id);
		// Delete execution data (cascades via FK, but be explicit)
		await this.executionDataRepo.deleteByExecutionId(numId);
		// Hard delete the execution record
		await this.executionRepo.hardDelete(numId);
	}

	async bulkDelete(params: { ids?: string[]; filters?: FindManyParams }): Promise<{
		deletedCount: number;
	}> {
		let idsToDelete: number[];

		if (params.ids && params.ids.length > 0) {
			idsToDelete = params.ids.map(Number);
		} else if (params.filters) {
			// Resolve matching execution IDs from filter
			const matching = await this.executionRepo.findMany({
				workflowId: params.filters.workflowId,
				status: params.filters.status,
				startedAfter: params.filters.startedAfter,
				startedBefore: params.filters.startedBefore,
				limit: 1000, // cap to prevent unbounded deletion
			});
			idsToDelete = matching.map((e) => e.id);
		} else {
			return { deletedCount: 0 };
		}

		if (idsToDelete.length === 0) return { deletedCount: 0 };

		// Delete binary data for all executions
		await Promise.all(
			idsToDelete.map((id) => this.binaryDataService.deleteExecutionData(String(id))),
		);
		// Batch delete execution data and executions
		await this.executionDataRepo.deleteByExecutionIds(idsToDelete);
		await this.executionRepo.bulkDelete(idsToDelete);

		return { deletedCount: idsToDelete.length };
	}

	getActiveIds(): string[] {
		return this.activeExecutions.getAll().map((e) => e.id);
	}

	getActiveExecutions() {
		return this.activeExecutions.getAll();
	}
}
