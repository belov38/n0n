import type { ICredentialTestRequest } from 'n8n-workflow';
import type { CredentialService } from './credential.service';
import type { NodeTypes } from '@n0n/nodes';

export class CredentialsTester {
	constructor(
		private credentialService: CredentialService,
		private nodeTypes: NodeTypes,
	) {}

	async testCredential(
		credentialId: string,
		nodeTypeName: string,
	): Promise<{ success: boolean; message?: string }> {
		const credential = await this.credentialService.findById(credentialId);

		let nodeType;
		try {
			nodeType = this.nodeTypes.getByNameAndVersion(nodeTypeName);
		} catch {
			return { success: false, message: `Unknown node type: ${nodeTypeName}` };
		}

		const testRequest = this.findTestRequest(nodeType, credential.type);
		if (!testRequest) {
			return { success: true, message: 'No test available for this credential type' };
		}

		try {
			const decryptedData = await this.credentialService.getDecrypted(credentialId);
			await this.executeTestRequest(testRequest, decryptedData);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				message: error instanceof Error ? error.message : 'Credential test failed',
			};
		}
	}

	private findTestRequest(
		nodeType: { description: { credentials?: Array<{ name: string; testedBy?: ICredentialTestRequest | string }> } },
		credentialType: string,
	): ICredentialTestRequest | undefined {
		const credDef = nodeType.description.credentials?.find(
			(c) => c.name === credentialType,
		);
		if (!credDef?.testedBy || typeof credDef.testedBy === 'string') {
			return undefined;
		}
		return credDef.testedBy;
	}

	private async executeTestRequest(
		testRequest: ICredentialTestRequest,
		credentials: Record<string, unknown>,
	): Promise<void> {
		const { request, rules } = testRequest;
		const rawUrl = request.url;
		if (!rawUrl) {
			throw new Error('Credential test request has no URL configured');
		}
		const url = this.resolveCredentialExpressions(rawUrl, credentials);
		const headers: Record<string, string> = {};
		if (request.headers) {
			for (const [key, value] of Object.entries(request.headers)) {
				headers[key] = this.resolveCredentialExpressions(String(value), credentials);
			}
		}

		const response = await fetch(url, {
			method: request.method ?? 'GET',
			headers,
		});

		if (rules?.length) {
			for (const rule of rules) {
				if ('responseCode' in rule && response.status !== rule.responseCode) {
					throw new Error(`Credential test failed with status ${response.status}`);
				}
			}
		} else if (!response.ok) {
			throw new Error(`Credential test failed with status ${response.status}`);
		}
	}

	private resolveCredentialExpressions(
		template: string,
		credentials: Record<string, unknown>,
	): string {
		return template.replace(/\{\{([$\w.]+)\}\}/g, (_match, path: string) => {
			const cleanPath = path.replace('$credentials.', '');
			return String(credentials[cleanPath] ?? '');
		});
	}
}
