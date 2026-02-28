import { Elysia, t } from 'elysia';
import type { SettingsService } from '../services/settings.service';

export function createSettingsRoutes(settingsService: SettingsService) {
	return new Elysia({ prefix: '/rest/settings' })
		.get('/', async () => {
			return { data: await settingsService.findAll() };
		})
		.patch(
			'/',
			async ({ body }) => {
				const results = [];
				for (const [key, value] of Object.entries(body)) {
					results.push(await settingsService.upsert(key, value));
				}
				return { data: results };
			},
			{
				body: t.Record(t.String(), t.String()),
			},
		);
}
