import { Elysia } from 'elysia';
import type { WorkflowService } from '../services/workflow.service';
import type { TagService } from '../services/tag.service';

interface ImportedWorkflow {
	name: string;
	nodes: unknown[];
	connections: Record<string, unknown>;
	settings?: Record<string, unknown>;
	tags?: string[];
}

function isValidWorkflow(wf: unknown): wf is ImportedWorkflow {
	if (typeof wf !== 'object' || wf === null) return false;
	const obj = wf as Record<string, unknown>;
	return (
		typeof obj.name === 'string' &&
		Array.isArray(obj.nodes) &&
		typeof obj.connections === 'object' &&
		obj.connections !== null
	);
}

export function createImportExportRoutes(
	workflowService: WorkflowService,
	tagService?: TagService,
) {
	return new Elysia({ prefix: '/rest' })
		.post('/workflows/import', async ({ body }) => {
			const workflows = Array.isArray(body) ? body : [body];
			const results: Array<
				| { success: true; workflow: Awaited<ReturnType<WorkflowService['create']>> }
				| { success: false; error: string; index: number }
			> = [];

			for (let i = 0; i < workflows.length; i++) {
				const wf = workflows[i];
				if (!isValidWorkflow(wf)) {
					results.push({
						success: false,
						error: 'Invalid workflow structure: requires name, nodes, and connections',
						index: i,
					});
					continue;
				}
				try {
					const created = await workflowService.create(wf);
					results.push({ success: true, workflow: created });
				} catch (error) {
					results.push({
						success: false,
						error: error instanceof Error ? error.message : 'Unknown error',
						index: i,
					});
				}
			}
			return { data: results };
		})
		.get('/workflows/:id/export', async ({ params }) => {
			const workflow = await workflowService.findById(params.id);
			const tags = tagService
				? await tagService.findByWorkflowId(params.id)
				: [];
			return { ...workflow, tags };
		});
}
