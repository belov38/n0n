import { Elysia, t } from 'elysia';
import { NotFoundError, type WorkflowService } from '../services/workflow.service';

export function createWorkflowRoutes(workflowService: WorkflowService) {
	return new Elysia({ prefix: '/rest/workflows' })
		.onError(({ error, set }) => {
			if (error instanceof NotFoundError) {
				set.status = 404;
				return { error: error.message };
			}
		})
		.get('/', async ({ query }) => {
			const workflows = await workflowService.findMany({
				active:
					query.active === 'true' ? true : query.active === 'false' ? false : undefined,
				name: query.name,
				limit: query.limit ? parseInt(query.limit) : 20,
				offset: query.offset ? parseInt(query.offset) : 0,
			});
			return { data: workflows };
		})
		.get('/:id', async ({ params }) => {
			return workflowService.findById(params.id);
		})
		.post(
			'/',
			async ({ body }) => {
				return workflowService.create(body);
			},
			{
				body: t.Object({
					name: t.String(),
					nodes: t.Array(t.Unknown()),
					connections: t.Record(t.String(), t.Unknown()),
					settings: t.Optional(t.Record(t.String(), t.Unknown())),
					tags: t.Optional(t.Array(t.String())),
				}),
			},
		)
		.patch('/:id', async ({ params, body }) => {
			return workflowService.update(params.id, body as Record<string, unknown>);
		})
		.delete('/:id', async ({ params }) => {
			await workflowService.delete(params.id);
			return { success: true };
		})
		.post('/:id/activate', async ({ params }) => {
			return workflowService.activate(params.id);
		})
		.post('/:id/deactivate', async ({ params }) => {
			return workflowService.deactivate(params.id);
		})
		.get('/:id/versions', async ({ params }) => {
			return workflowService.getVersions(params.id);
		})
		.post('/:id/run', async ({ params }) => {
			// Stub: will be wired to execution engine later
			return {
				executionId: crypto.randomUUID(),
				workflowId: params.id,
				status: 'started',
			};
		});
}
