import { Elysia } from 'elysia';
import type { CredentialService } from '../services/credential.service';

const BASE_URL = process.env.N0N_BASE_URL || 'http://localhost:5678';
const REDIRECT_URI = `${BASE_URL}/rest/oauth2-credential/callback`;

export function createOAuthRoutes(credentialService: CredentialService) {
	return new Elysia()
		.get('/rest/oauth2-credential/auth', async ({ query, set }) => {
			const credentialId = query.id;
			if (!credentialId) {
				set.status = 400;
				return { error: 'Missing credential id' };
			}

			const credential = await credentialService.getDecrypted(credentialId);

			const authUrl = new URL(credential.authUrl as string);
			authUrl.searchParams.set('client_id', credential.clientId as string);
			authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
			authUrl.searchParams.set('response_type', 'code');
			authUrl.searchParams.set('state', credentialId);
			if (credential.scope) {
				authUrl.searchParams.set('scope', credential.scope as string);
			}

			return { url: authUrl.toString() };
		})
		.get('/rest/oauth2-credential/callback', async ({ query, set }) => {
			const code = query.code;
			const state = query.state; // credentialId

			if (!code || !state) {
				set.status = 400;
				return { error: 'Missing code or state' };
			}

			const credential = await credentialService.getDecrypted(state);

			const tokenResponse = await fetch(credential.accessTokenUrl as string, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					grant_type: 'authorization_code',
					code,
					client_id: credential.clientId as string,
					client_secret: credential.clientSecret as string,
					redirect_uri: REDIRECT_URI,
				}),
			});

			const tokens = (await tokenResponse.json()) as Record<string, unknown>;

			await credentialService.update(state, {
				data: { ...credential, oauthTokenData: tokens },
			});

			set.headers['Content-Type'] = 'text/html';
			return '<html><body><script>window.close();</script></body></html>';
		});
}
