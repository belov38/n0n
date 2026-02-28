import type { CredentialRepo } from '@n0n/db';
import { Cipher } from '../encryption/cipher';
import type { InstanceSettings } from '../encryption/instance-settings';

export class NotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NotFoundError';
	}
}

export class CredentialService {
	private cipher: Cipher;

	constructor(
		private credentialRepo: CredentialRepo,
		instanceSettings: InstanceSettings,
	) {
		this.cipher = new Cipher(instanceSettings);
	}

	async findById(id: string) {
		const credential = await this.credentialRepo.findById(id);
		if (!credential) throw new NotFoundError('Credential not found');
		return { ...credential, data: undefined };
	}

	async findMany(type?: string) {
		const credentials = await this.credentialRepo.findMany(type ? { type } : undefined);
		return credentials.map((c) => ({ ...c, data: undefined }));
	}

	async create(data: { name: string; type: string; data: Record<string, unknown> }) {
		const encryptedData = this.cipher.encrypt(data.data);
		return this.credentialRepo.create({
			id: crypto.randomUUID(),
			name: data.name,
			type: data.type,
			data: encryptedData,
		});
	}

	async update(id: string, data: { name?: string; data?: Record<string, unknown> }) {
		const updatePayload: Partial<{ name: string; data: string }> = {};
		if (data.name) updatePayload.name = data.name;
		if (data.data) updatePayload.data = this.cipher.encrypt(data.data);
		return this.credentialRepo.update(id, updatePayload);
	}

	async delete(id: string) {
		await this.credentialRepo.delete(id);
	}

	/** Get decrypted credential data (for internal use by nodes) */
	async getDecrypted(id: string): Promise<Record<string, unknown>> {
		const credential = await this.credentialRepo.findById(id);
		if (!credential) throw new NotFoundError('Credential not found');
		return this.cipher.decrypt(credential.data);
	}

	async test(credentialId: string): Promise<{ success: boolean; message?: string }> {
		try {
			await this.getDecrypted(credentialId);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				message: error instanceof Error ? error.message : 'Unknown error',
			};
		}
	}
}
