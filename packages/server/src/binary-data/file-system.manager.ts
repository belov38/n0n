import { mkdir, writeFile, readFile, rm, stat } from 'fs/promises';
import { createReadStream } from 'fs';
import { join, relative } from 'path';
import type { Readable } from 'stream';

import type { BinaryDataManager, BinaryMetadata } from './binary-data.service';

export class FileSystemManager implements BinaryDataManager {
	constructor(private storagePath: string) {}

	async init(): Promise<void> {
		await mkdir(this.storagePath, { recursive: true });
	}

	async store(
		_workflowId: string,
		executionId: string,
		binaryData: Buffer | Readable,
		metadata: BinaryMetadata,
	): Promise<string> {
		const fileUuid = crypto.randomUUID();
		const dir = this.executionDir(executionId);
		await mkdir(dir, { recursive: true });

		const filePath = join(dir, fileUuid);
		await writeFile(filePath, binaryData);

		const fileSize = (await stat(filePath)).size;
		const storedMetadata: BinaryMetadata = { ...metadata, fileSize };
		await writeFile(`${filePath}.metadata`, JSON.stringify(storedMetadata), 'utf-8');

		return `filesystem:${executionId}:${fileUuid}`;
	}

	async retrieve(identifier: string): Promise<Buffer> {
		const filePath = this.resolveIdentifier(identifier);
		return readFile(filePath);
	}

	async retrieveAsStream(identifier: string): Promise<Readable> {
		const filePath = this.resolveIdentifier(identifier);
		// Verify file exists before creating stream
		await stat(filePath);
		return createReadStream(filePath);
	}

	async getMetadata(identifier: string): Promise<BinaryMetadata> {
		const filePath = this.resolveIdentifier(identifier);
		const raw = await readFile(`${filePath}.metadata`, 'utf-8');
		return JSON.parse(raw) as BinaryMetadata;
	}

	async getSize(identifier: string): Promise<number> {
		const filePath = this.resolveIdentifier(identifier);
		const stats = await stat(filePath);
		return stats.size;
	}

	async deleteMany(identifiers: string[]): Promise<void> {
		for (const identifier of identifiers) {
			const filePath = this.resolveIdentifier(identifier);
			await rm(filePath, { force: true });
			await rm(`${filePath}.metadata`, { force: true });
		}
	}

	async deleteExecutionData(executionId: string): Promise<void> {
		const dir = this.executionDir(executionId);
		await rm(dir, { recursive: true, force: true });
	}

	private executionDir(executionId: string): string {
		return join(this.storagePath, executionId);
	}

	private resolveIdentifier(identifier: string): string {
		// Format: filesystem:{executionId}:{uuid}
		const parts = identifier.split(':');
		if (parts.length !== 3 || parts[0] !== 'filesystem') {
			throw new Error(`Invalid binary data identifier: ${identifier}`);
		}
		const [, executionId, fileUuid] = parts;
		const resolved = join(this.storagePath, executionId, fileUuid);

		// Path traversal guard
		if (relative(this.storagePath, resolved).startsWith('..')) {
			throw new Error(`Disallowed file path: ${resolved}`);
		}

		return resolved;
	}
}
