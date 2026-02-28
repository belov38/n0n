import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

import type { InstanceSettings } from './instance-settings';

// CryptoJS-compatible prefix: ASCII "Salted__"
const SALTED_PREFIX = Buffer.from('53616c7465645f5f', 'hex');

const ALGORITHM = 'aes-256-cbc';

export class Cipher {
	constructor(private readonly instanceSettings: InstanceSettings) {}

	encrypt(data: Record<string, unknown>): string {
		const salt = randomBytes(8);
		const [key, iv] = this.getKeyAndIv(salt);
		const cipher = createCipheriv(ALGORITHM, key, iv);
		const encrypted = cipher.update(JSON.stringify(data));
		return Buffer.concat([SALTED_PREFIX, salt, encrypted, cipher.final()]).toString('base64');
	}

	decrypt(encryptedData: string): Record<string, unknown> {
		const input = Buffer.from(encryptedData, 'base64');
		if (input.length < 16) {
			throw new Error('Invalid encrypted data: too short');
		}
		const salt = input.subarray(8, 16);
		const [key, iv] = this.getKeyAndIv(salt);
		const contents = input.subarray(16);
		const decipher = createDecipheriv(ALGORITHM, key, iv);
		const decrypted = Buffer.concat([decipher.update(contents), decipher.final()]).toString(
			'utf-8',
		);
		return JSON.parse(decrypted) as Record<string, unknown>;
	}

	// EVP_BytesToKey: MD5-based key derivation matching n8n / OpenSSL / CryptoJS
	private getKeyAndIv(salt: Buffer): [Buffer, Buffer] {
		const password = Buffer.concat([
			Buffer.from(this.instanceSettings.getEncryptionKey(), 'binary'),
			salt,
		]);
		const hash1 = createHash('md5').update(password).digest();
		const hash2 = createHash('md5')
			.update(Buffer.concat([hash1, password]))
			.digest();
		const iv = createHash('md5')
			.update(Buffer.concat([hash2, password]))
			.digest();
		const key = Buffer.concat([hash1, hash2]);
		return [key, iv];
	}
}
