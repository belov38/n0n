import { Elysia, t } from 'elysia';
import type { VariableService } from '../services/variable.service';

export function createVariableRoutes(variableService: VariableService) {
	return new Elysia({ prefix: '/rest/variables' })
		.get('/', async () => {
			return { data: await variableService.findAll() };
		})
		.post(
			'/',
			async ({ body }) => {
				return variableService.create(body);
			},
			{
				body: t.Object({
					key: t.String(),
					value: t.String(),
					type: t.Optional(t.String()),
				}),
			},
		)
		.patch(
			'/:id',
			async ({ params, body }) => {
				return variableService.update(parseInt(params.id), body);
			},
			{
				body: t.Object({
					key: t.Optional(t.String()),
					value: t.Optional(t.String()),
					type: t.Optional(t.String()),
				}),
			},
		)
		.delete('/:id', async ({ params }) => {
			await variableService.delete(parseInt(params.id));
			return { success: true };
		});
}
