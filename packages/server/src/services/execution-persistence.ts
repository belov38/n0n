import type { ExecutionRepo, ExecutionDataRepo, ExecutionMetadataRepo } from '@n0n/db';
import type { IRunExecutionData, WorkflowExecuteMode, ExecutionStatus } from 'n8n-workflow';

export class ExecutionPersistence {
	constructor(
		private executionRepo: ExecutionRepo,
		private executionDataRepo: ExecutionDataRepo,
		private metadataRepo: ExecutionMetadataRepo,
	) {}

	// Create new execution record before starting
	async create(workflowId: string, mode: WorkflowExecuteMode): Promise<string> {
		const execution = await this.executionRepo.create({
			workflowId,
			mode,
			status: 'new',
			startedAt: new Date(),
			finished: false,
		});
		return String(execution.id);
	}

	async setRunning(executionId: string): Promise<void> {
		await this.executionRepo.updateStatus(Number(executionId), 'running');
	}

	// Save execution progress after each node completes
	async saveProgress(
		executionId: string,
		runData: IRunExecutionData,
		workflowData: Record<string, unknown>,
	): Promise<void> {
		const numId = Number(executionId);
		const existing = await this.executionDataRepo.findByExecutionId(numId);
		if (existing) {
			await this.executionDataRepo.update(numId, {
				data: JSON.stringify(runData),
				workflowData,
			});
		} else {
			await this.executionDataRepo.create({
				executionId: numId,
				data: JSON.stringify(runData),
				workflowData,
			});
		}
	}

	// Save final execution result
	async saveResult(
		executionId: string,
		runData: IRunExecutionData,
		workflowData: Record<string, unknown>,
		status: ExecutionStatus,
	): Promise<void> {
		const numId = Number(executionId);
		await this.executionRepo.markAsFinished(numId, status);

		const existing = await this.executionDataRepo.findByExecutionId(numId);
		if (existing) {
			await this.executionDataRepo.update(numId, {
				data: JSON.stringify(runData),
				workflowData,
			});
		} else {
			await this.executionDataRepo.create({
				executionId: numId,
				data: JSON.stringify(runData),
				workflowData,
			});
		}
	}

	async saveMetadata(executionId: string, metadata: Record<string, string>): Promise<void> {
		const entries = Object.entries(metadata).map(([key, value]) => ({ key, value }));
		if (entries.length > 0) {
			await this.metadataRepo.createMany(Number(executionId), entries);
		}
	}
}
