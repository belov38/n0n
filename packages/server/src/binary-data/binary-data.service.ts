import type { Readable } from 'stream';

import { FileSystemManager } from './file-system.manager';

export interface BinaryMetadata {
	fileName?: string;
	mimeType: string;
	fileSize: number;
}

export interface BinaryDataManager {
	init(): Promise<void>;
	store(
		workflowId: string,
		executionId: string,
		binaryData: Buffer | Readable,
		metadata: BinaryMetadata,
	): Promise<string>;
	retrieve(identifier: string): Promise<Buffer>;
	retrieveAsStream(identifier: string): Promise<Readable>;
	getMetadata(identifier: string): Promise<BinaryMetadata>;
	getSize(identifier: string): Promise<number>;
	deleteMany(identifiers: string[]): Promise<void>;
	deleteExecutionData(executionId: string): Promise<void>;
}

export class BinaryDataService {
	private manager: BinaryDataManager;

	constructor(mode: 'filesystem' | 'memory' = 'filesystem', storagePath?: string) {
		if (mode === 'filesystem') {
			this.manager = new FileSystemManager(storagePath ?? './binary-data');
		} else {
			this.manager = new InMemoryManager();
		}
	}

	async init(): Promise<void> {
		await this.manager.init();
	}

	async store(
		workflowId: string,
		executionId: string,
		binaryData: Buffer | Readable,
		metadata: BinaryMetadata,
	): Promise<string> {
		return this.manager.store(workflowId, executionId, binaryData, metadata);
	}

	async retrieve(identifier: string): Promise<Buffer> {
		return this.manager.retrieve(identifier);
	}

	async retrieveAsStream(identifier: string): Promise<Readable> {
		return this.manager.retrieveAsStream(identifier);
	}

	async getMetadata(identifier: string): Promise<BinaryMetadata> {
		return this.manager.getMetadata(identifier);
	}

	async getSize(identifier: string): Promise<number> {
		return this.manager.getSize(identifier);
	}

	async deleteMany(identifiers: string[]): Promise<void> {
		return this.manager.deleteMany(identifiers);
	}

	async deleteExecutionData(executionId: string): Promise<void> {
		return this.manager.deleteExecutionData(executionId);
	}
}

class InMemoryManager implements BinaryDataManager {
	private data = new Map<string, { buffer: Buffer; metadata: BinaryMetadata }>();

	async init(): Promise<void> {}

	async store(
		_workflowId: string,
		executionId: string,
		binaryData: Buffer | Readable,
		metadata: BinaryMetadata,
	): Promise<string> {
		const id = `memory:${executionId}:${crypto.randomUUID()}`;
		const buffer = Buffer.isBuffer(binaryData) ? binaryData : await streamToBuffer(binaryData);
		this.data.set(id, { buffer, metadata: { ...metadata, fileSize: buffer.length } });
		return id;
	}

	async retrieve(identifier: string): Promise<Buffer> {
		const entry = this.data.get(identifier);
		if (!entry) throw new Error(`Binary data not found: ${identifier}`);
		return entry.buffer;
	}

	async retrieveAsStream(identifier: string): Promise<Readable> {
		const buffer = await this.retrieve(identifier);
		const { Readable } = await import('stream');
		return Readable.from(buffer);
	}

	async getMetadata(identifier: string): Promise<BinaryMetadata> {
		const entry = this.data.get(identifier);
		if (!entry) throw new Error(`Binary data not found: ${identifier}`);
		return entry.metadata;
	}

	async getSize(identifier: string): Promise<number> {
		const entry = this.data.get(identifier);
		if (!entry) throw new Error(`Binary data not found: ${identifier}`);
		return entry.buffer.length;
	}

	async deleteMany(identifiers: string[]): Promise<void> {
		for (const id of identifiers) {
			this.data.delete(id);
		}
	}

	async deleteExecutionData(executionId: string): Promise<void> {
		for (const key of this.data.keys()) {
			if (key.startsWith(`memory:${executionId}:`)) {
				this.data.delete(key);
			}
		}
	}
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}
