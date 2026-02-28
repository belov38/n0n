import type { WorkflowRepo } from '@n0n/db';
import type { TagRepo } from '@n0n/db';
import type { WorkflowHistoryRepo } from '@n0n/db';
import { randomUUID } from 'crypto';

export class NotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NotFoundError';
	}
}

export class WorkflowService {
	constructor(
		private workflowRepo: WorkflowRepo,
		private tagRepo: TagRepo,
		private historyRepo: WorkflowHistoryRepo,
	) {}

	async findById(id: string) {
		const workflow = await this.workflowRepo.findById(id);
		if (!workflow) throw new NotFoundError('Workflow not found');
		return workflow;
	}

	async findMany(params: {
		active?: boolean;
		name?: string;
		tags?: string[];
		limit?: number;
		offset?: number;
	}) {
		return this.workflowRepo.findMany(params);
	}

	async create(data: {
		name: string;
		nodes: unknown[];
		connections: Record<string, unknown>;
		settings?: Record<string, unknown>;
		tags?: string[];
	}) {
		const id = randomUUID();
		const versionId = randomUUID();
		const workflow = await this.workflowRepo.create({
			id,
			name: data.name,
			nodes: data.nodes,
			connections: data.connections,
			settings: data.settings,
			versionId,
		});

		if (data.tags?.length) {
			await this.tagRepo.setWorkflowTags(id, data.tags);
		}

		await this.historyRepo.create({
			versionId,
			workflowId: id,
			nodes: data.nodes,
			connections: data.connections,
			authors: 'system',
		});

		return workflow;
	}

	async update(id: string, data: Record<string, unknown>) {
		const existing = await this.findById(id);
		const versionId = randomUUID();

		const updated = await this.workflowRepo.update(id, {
			...data,
			versionId,
		});

		if (data.nodes || data.connections) {
			await this.historyRepo.create({
				versionId,
				workflowId: id,
				nodes: (data.nodes ?? existing.nodes) as unknown[],
				connections: (data.connections ?? existing.connections) as Record<string, unknown>,
				authors: 'system',
			});
		}

		return updated;
	}

	async activate(id: string) {
		await this.findById(id);
		return this.workflowRepo.activate(id);
	}

	async deactivate(id: string) {
		await this.findById(id);
		return this.workflowRepo.deactivate(id);
	}

	async delete(id: string) {
		await this.findById(id);
		await this.workflowRepo.delete(id);
	}

	async getVersions(id: string) {
		await this.findById(id);
		return this.historyRepo.findByWorkflowId(id);
	}
}
