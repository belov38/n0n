import type { ICredentialType, ICredentialTypes } from 'n8n-workflow';

export class CredentialTypes implements ICredentialTypes {
	private credentialTypes: Map<string, ICredentialType> = new Map();

	register(credentialType: ICredentialType): void {
		this.credentialTypes.set(credentialType.name, credentialType);
	}

	getByName(name: string): ICredentialType {
		const found = this.credentialTypes.get(name);
		if (!found) {
			throw new Error(`Unknown credential type: ${name}`);
		}
		return found;
	}

	getAll(): ICredentialType[] {
		return Array.from(this.credentialTypes.values());
	}

	recognizes(name: string): boolean {
		return this.credentialTypes.has(name);
	}

	getSupportedNodes(type: string): string[] {
		const cred = this.credentialTypes.get(type);
		return cred?.supportedNodes ?? [];
	}

	getParentTypes(typeName: string): string[] {
		const cred = this.credentialTypes.get(typeName);
		if (!cred?.extends) {
			return [];
		}
		// Recursively collect parent types
		const parents: string[] = [];
		for (const parentName of cred.extends) {
			parents.push(parentName);
			parents.push(...this.getParentTypes(parentName));
		}
		return parents;
	}
}
