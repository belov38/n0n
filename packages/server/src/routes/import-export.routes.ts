import { Elysia } from 'elysia';
import type { WorkflowService } from '../services/workflow.service';

export function createImportExportRoutes(workflowService: WorkflowService) {
	return new Elysia({ prefix: '/rest' })
		.post('/workflows/import', async ({ body }) => {
			const workflows = Array.isArray(body) ? body : [body];
			const results = [];
			for (const wf of workflows) {
				const created = await workflowService.create(
					wf as Parameters<WorkflowService['create']>[0],
				);
				results.push(created);
			}
			return { data: results };
		})
		.get('/workflows/:id/export', async ({ params }) => {
			return workflowService.findById(params.id);
		});
}
