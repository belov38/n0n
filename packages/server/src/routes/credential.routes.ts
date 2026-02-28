import { Elysia, t } from 'elysia';
import { NotFoundError, type CredentialService } from '../services/credential.service';

export function createCredentialRoutes(credentialService: CredentialService) {
	return new Elysia({ prefix: '/rest/credentials' })
		.onError(({ error, set }) => {
			if (error instanceof NotFoundError) {
				set.status = 404;
				return { error: error.message };
			}
		})
		.get('/', async ({ query }) => {
			const credentials = await credentialService.findMany(query.type);
			return { data: credentials };
		})
		.get('/:id', async ({ params }) => {
			return credentialService.findById(params.id);
		})
		.post(
			'/',
			async ({ body }) => {
				return credentialService.create(body);
			},
			{
				body: t.Object({
					name: t.String(),
					type: t.String(),
					data: t.Record(t.String(), t.Unknown()),
				}),
			},
		)
		.patch(
			'/:id',
			async ({ params, body }) => {
				return credentialService.update(params.id, body);
			},
			{
				body: t.Object({
					name: t.Optional(t.String()),
					data: t.Optional(t.Record(t.String(), t.Unknown())),
				}),
			},
		)
		.delete('/:id', async ({ params }) => {
			await credentialService.delete(params.id);
			return { success: true };
		})
		.post(
			'/test',
			async ({ body }) => {
				return credentialService.test(body.id);
			},
			{
				body: t.Object({
					id: t.String(),
				}),
			},
		);
}
