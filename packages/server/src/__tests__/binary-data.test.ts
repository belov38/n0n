import { describe, expect, test } from 'bun:test';
import { Readable } from 'stream';

import { BinaryDataService, type BinaryMetadata } from '../binary-data';

function createService(): BinaryDataService {
	return new BinaryDataService('memory');
}

describe('BinaryDataService (in-memory)', () => {
	const metadata: BinaryMetadata = {
		fileName: 'test.png',
		mimeType: 'image/png',
		fileSize: 0, // will be set by store
	};

	test('store and retrieve binary data', async () => {
		const service = createService();
		await service.init();

		const data = Buffer.from('hello binary world');
		const id = await service.store('wf-1', 'exec-1', data, metadata);

		expect(id).toContain('exec-1');

		const retrieved = await service.retrieve(id);
		expect(retrieved).toEqual(data);
	});

	test('store from stream and retrieve', async () => {
		const service = createService();
		await service.init();

		const content = Buffer.from('stream content');
		const stream = Readable.from(content);
		const id = await service.store('wf-1', 'exec-1', stream, metadata);

		const retrieved = await service.retrieve(id);
		expect(retrieved).toEqual(content);
	});

	test('retrieve throws for unknown identifier', async () => {
		const service = createService();
		await service.init();

		expect(service.retrieve('nonexistent')).rejects.toThrow('Binary data not found');
	});

	test('get metadata', async () => {
		const service = createService();
		await service.init();

		const data = Buffer.from('metadata test');
		const id = await service.store('wf-1', 'exec-1', data, {
			fileName: 'doc.pdf',
			mimeType: 'application/pdf',
			fileSize: 0,
		});

		const result = await service.getMetadata(id);
		expect(result.fileName).toBe('doc.pdf');
		expect(result.mimeType).toBe('application/pdf');
		expect(result.fileSize).toBe(data.length);
	});

	test('get size', async () => {
		const service = createService();
		await service.init();

		const data = Buffer.from('size check');
		const id = await service.store('wf-1', 'exec-1', data, metadata);

		const size = await service.getSize(id);
		expect(size).toBe(data.length);
	});

	test('delete by identifiers', async () => {
		const service = createService();
		await service.init();

		const id1 = await service.store('wf-1', 'exec-1', Buffer.from('a'), metadata);
		const id2 = await service.store('wf-1', 'exec-1', Buffer.from('b'), metadata);

		await service.deleteMany([id1]);

		expect(service.retrieve(id1)).rejects.toThrow('Binary data not found');
		const stillThere = await service.retrieve(id2);
		expect(stillThere).toEqual(Buffer.from('b'));
	});

	test('delete by execution ID removes all related data', async () => {
		const service = createService();
		await service.init();

		const id1 = await service.store('wf-1', 'exec-1', Buffer.from('a'), metadata);
		const id2 = await service.store('wf-1', 'exec-1', Buffer.from('b'), metadata);
		const id3 = await service.store('wf-1', 'exec-2', Buffer.from('c'), metadata);

		await service.deleteExecutionData('exec-1');

		expect(service.retrieve(id1)).rejects.toThrow('Binary data not found');
		expect(service.retrieve(id2)).rejects.toThrow('Binary data not found');
		// Different execution should be unaffected
		const stillThere = await service.retrieve(id3);
		expect(stillThere).toEqual(Buffer.from('c'));
	});

	test('retrieve as stream', async () => {
		const service = createService();
		await service.init();

		const data = Buffer.from('stream retrieval test');
		const id = await service.store('wf-1', 'exec-1', data, metadata);

		const stream = await service.retrieveAsStream(id);
		const chunks: Buffer[] = [];
		for await (const chunk of stream) {
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		}
		expect(Buffer.concat(chunks)).toEqual(data);
	});

	test('store empty buffer', async () => {
		const service = createService();
		await service.init();

		const data = Buffer.alloc(0);
		const id = await service.store('wf-1', 'exec-1', data, metadata);

		const retrieved = await service.retrieve(id);
		expect(retrieved.length).toBe(0);

		const size = await service.getSize(id);
		expect(size).toBe(0);
	});
});
