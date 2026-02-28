import { randomBytes } from 'crypto';

export class InstanceSettings {
	private readonly encryptionKey: string;

	constructor() {
		this.encryptionKey =
			process.env.N8N_ENCRYPTION_KEY ?? process.env.N0N_ENCRYPTION_KEY ?? this.generateKey();
	}

	getEncryptionKey(): string {
		return this.encryptionKey;
	}

	private generateKey(): string {
		const key = randomBytes(24).toString('base64');
		console.warn(
			'No encryption key set. Using generated key. Set N0N_ENCRYPTION_KEY for persistence.',
		);
		return key;
	}
}
