import { Elysia, t } from 'elysia';
import type { FolderService } from '../services/folder.service';

export function createFolderRoutes(folderService: FolderService) {
	return new Elysia({ prefix: '/rest/folders' })
		.get('/', async () => {
			return { data: await folderService.findAll() };
		})
		.get('/tree', async () => {
			return { data: await folderService.findTree() };
		})
		.get('/:id', async ({ params }) => {
			return folderService.findById(params.id);
		})
		.post(
			'/',
			async ({ body }) => {
				return folderService.create(body);
			},
			{
				body: t.Object({
					name: t.String(),
					parentFolderId: t.Optional(t.Union([t.String(), t.Null()])),
				}),
			},
		)
		.patch(
			'/:id',
			async ({ params, body }) => {
				return folderService.update(params.id, body);
			},
			{
				body: t.Object({
					name: t.Optional(t.String()),
					parentFolderId: t.Optional(t.Union([t.String(), t.Null()])),
				}),
			},
		)
		.delete('/:id', async ({ params }) => {
			await folderService.delete(params.id);
			return { success: true };
		});
}
