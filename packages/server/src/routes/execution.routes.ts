import { Elysia, t } from 'elysia';
import {
	ExecutionNotFoundError,
	ExecutionNotStoppableError,
	ExecutionNotRetryableError,
	type ExecutionService,
} from '../services/execution.service';

export function createExecutionRoutes(executionService: ExecutionService) {
	return new Elysia({ prefix: '/rest/executions' })
		.onError(({ error, set }) => {
			if (error instanceof ExecutionNotFoundError) {
				set.status = 404;
				return { error: error.message };
			}
			if (error instanceof ExecutionNotStoppableError) {
				set.status = 409;
				return { error: error.message };
			}
			if (error instanceof ExecutionNotRetryableError) {
				set.status = 409;
				return { error: error.message };
			}
		})

		// List currently running execution IDs
		.get('/active', () => {
			return { data: executionService.getActiveIds() };
		})

		// Bulk delete by IDs or filter
		.post(
			'/delete',
			async ({ body }) => {
				const result = await executionService.bulkDelete({
					ids: body.ids,
					filters: body.filters
						? {
								workflowId: body.filters.workflowId,
								status: body.filters.status,
								startedAfter: body.filters.startedAfter
									? new Date(body.filters.startedAfter)
									: undefined,
								startedBefore: body.filters.startedBefore
									? new Date(body.filters.startedBefore)
									: undefined,
							}
						: undefined,
				});
				return { success: true, deletedCount: result.deletedCount };
			},
			{
				body: t.Object({
					ids: t.Optional(t.Array(t.String())),
					filters: t.Optional(
						t.Object({
							workflowId: t.Optional(t.String()),
							status: t.Optional(t.String()),
							startedAfter: t.Optional(t.String()),
							startedBefore: t.Optional(t.String()),
						}),
					),
				}),
			},
		)

		// List executions with cursor pagination and filters
		.get(
			'/',
			async ({ query }) => {
				const result = await executionService.findMany({
					workflowId: query.workflowId,
					status: query.status,
					startedAfter: query.startedAfter ? new Date(query.startedAfter) : undefined,
					startedBefore: query.startedBefore ? new Date(query.startedBefore) : undefined,
					limit: query.limit ? parseInt(query.limit, 10) : 20,
					cursor: query.cursor,
				});
				return {
					data: result.results,
					nextCursor: result.nextCursor,
				};
			},
			{
				query: t.Object({
					workflowId: t.Optional(t.String()),
					status: t.Optional(t.String()),
					startedAfter: t.Optional(t.String()),
					startedBefore: t.Optional(t.String()),
					limit: t.Optional(t.String()),
					cursor: t.Optional(t.String()),
				}),
			},
		)

		// Get single execution with full run data
		.get('/:id', async ({ params }) => {
			return executionService.findById(params.id);
		})

		// Hard delete execution + data + binary data
		.delete('/:id', async ({ params }) => {
			await executionService.delete(params.id);
			return { success: true };
		})

		// Cancel a running execution
		.post('/:id/stop', async ({ params }) => {
			return executionService.stop(params.id);
		})

		// Retry a failed execution
		.post('/:id/retry', async ({ params }) => {
			return executionService.retry(params.id);
		});
}
