import { Elysia, t } from 'elysia';
import type { TagService } from '../services/tag.service';

export function createTagRoutes(tagService: TagService) {
	return new Elysia({ prefix: '/rest/tags' })
		.get('/', async () => {
			return { data: await tagService.findAll() };
		})
		.post(
			'/',
			async ({ body }) => {
				return tagService.create(body);
			},
			{
				body: t.Object({ name: t.String() }),
			},
		)
		.patch(
			'/:id',
			async ({ params, body }) => {
				return tagService.update(params.id, body);
			},
			{
				body: t.Object({ name: t.String() }),
			},
		)
		.delete('/:id', async ({ params }) => {
			await tagService.delete(params.id);
			return { success: true };
		});
}
