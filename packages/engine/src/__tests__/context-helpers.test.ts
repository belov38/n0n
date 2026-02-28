import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import {
	httpRequest,
	httpRequestWithAuthentication,
	prepareBinaryData,
	getBinaryDataBuffer,
	checkProcessedAndRecord,
	type ProcessedDataService,
} from '../context/helpers';

// --- binary-helpers ---

describe('prepareBinaryData', () => {
	it('encodes buffer to base64 with detected mime type', async () => {
		const buf = Buffer.from('hello world');
		const result = await prepareBinaryData(buf, 'test.txt');

		expect(result.data).toBe(buf.toString('base64'));
		expect(result.mimeType).toBe('text/plain');
		expect(result.fileName).toBe('test.txt');
		expect(result.fileExtension).toBe('txt');
		expect(result.bytes).toBe(buf.length);
	});

	it('uses provided mime type over detected', async () => {
		const buf = Buffer.from('data');
		const result = await prepareBinaryData(buf, 'file.txt', 'application/custom');
		expect(result.mimeType).toBe('application/custom');
	});

	it('defaults to octet-stream when extension unknown', async () => {
		const buf = Buffer.from('data');
		const result = await prepareBinaryData(buf, 'file.xyz');
		expect(result.mimeType).toBe('application/octet-stream');
	});

	it('defaults to octet-stream when no filename', async () => {
		const buf = Buffer.from('data');
		const result = await prepareBinaryData(buf);
		expect(result.mimeType).toBe('application/octet-stream');
		expect(result.fileName).toBeUndefined();
	});

	it('detects common mime types', async () => {
		const testCases: [string, string][] = [
			['image.png', 'image/png'],
			['photo.jpg', 'image/jpeg'],
			['styles.css', 'text/css'],
			['data.json', 'application/json'],
			['archive.zip', 'application/zip'],
			['doc.pdf', 'application/pdf'],
		];

		for (const [fileName, expectedMime] of testCases) {
			const result = await prepareBinaryData(Buffer.from('x'), fileName);
			expect(result.mimeType).toBe(expectedMime);
		}
	});

	it('formats file size correctly', async () => {
		const result = await prepareBinaryData(Buffer.alloc(1500), 'file.bin');
		expect(result.fileSize).toBe('1.46 KB');
	});
});

describe('getBinaryDataBuffer', () => {
	it('decodes base64 data back to buffer', () => {
		const original = Buffer.from('hello world');
		const binaryData = {
			data: original.toString('base64'),
			mimeType: 'text/plain',
		};

		const result = getBinaryDataBuffer(binaryData);
		expect(result.toString()).toBe('hello world');
	});

	it('throws on empty data', () => {
		expect(() => getBinaryDataBuffer({ data: '', mimeType: 'text/plain' })).toThrow(
			'Binary data is empty',
		);
	});

	it('round-trips with prepareBinaryData', async () => {
		const original = Buffer.from('test content 123');
		const prepared = await prepareBinaryData(original, 'test.txt');
		const restored = getBinaryDataBuffer(prepared);
		expect(restored).toEqual(original);
	});
});

// --- dedup-helpers ---

describe('checkProcessedAndRecord', () => {
	let service: ProcessedDataService;
	let storedData: Map<string, Set<string>>;

	beforeEach(() => {
		storedData = new Map();
		service = {
			getProcessedData: async (_wfId: string, ctx: string) =>
				storedData.get(ctx) ?? new Set(),
			saveProcessedData: async (_wfId: string, ctx: string, data: Set<string>) => {
				storedData.set(ctx, data);
			},
		};
	});

	it('returns all items on first run', async () => {
		const items = [{ id: '1' }, { id: '2' }, { id: '3' }];
		const result = await checkProcessedAndRecord(
			service, 'wf-1', 'trigger', items, 'id',
		);
		expect(result).toEqual(items);
	});

	it('filters already processed items on second run', async () => {
		const items1 = [{ id: '1' }, { id: '2' }];
		await checkProcessedAndRecord(service, 'wf-1', 'trigger', items1, 'id');

		const items2 = [{ id: '2' }, { id: '3' }, { id: '4' }];
		const result = await checkProcessedAndRecord(
			service, 'wf-1', 'trigger', items2, 'id',
		);
		expect(result).toEqual([{ id: '3' }, { id: '4' }]);
	});

	it('returns all items in "all" mode', async () => {
		const items1 = [{ id: '1' }];
		await checkProcessedAndRecord(service, 'wf-1', 'trigger', items1, 'id');

		const items2 = [{ id: '1' }, { id: '2' }];
		const result = await checkProcessedAndRecord(
			service, 'wf-1', 'trigger', items2, 'id', 'all',
		);
		expect(result).toEqual(items2);
	});

	it('uses separate contexts for different nodes', async () => {
		const items = [{ id: '1' }];
		await checkProcessedAndRecord(service, 'wf-1', 'nodeA', items, 'id');

		const result = await checkProcessedAndRecord(
			service, 'wf-1', 'nodeB', items, 'id',
		);
		expect(result).toEqual([{ id: '1' }]);
	});

	it('handles missing property with empty string', async () => {
		const items = [{ name: 'test' }];
		await checkProcessedAndRecord(service, 'wf-1', 'trigger', items, 'id');

		// Same items again — the empty string key was already processed
		const result = await checkProcessedAndRecord(
			service, 'wf-1', 'trigger', items, 'id',
		);
		expect(result).toEqual([]);
	});
});

// --- request-helpers ---

describe('httpRequest', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('makes a basic GET request and parses JSON', async () => {
		const mockFetch = mock((_url: string, _init?: RequestInit) =>
			Promise.resolve(new Response(JSON.stringify({ ok: true }), {
				headers: { 'Content-Type': 'application/json' },
			})),
		);
		globalThis.fetch = mockFetch as unknown as typeof fetch;

		const result = await httpRequest({ url: 'https://example.com/api' });
		expect(result).toEqual({ ok: true });

		const [calledUrl, calledInit] = mockFetch.mock.calls[0];
		expect(calledUrl).toBe('https://example.com/api');
		expect(calledInit?.method).toBe('GET');
	});

	it('appends query parameters', async () => {
		const mockFetch = mock((_url: string, _init?: RequestInit) =>
			Promise.resolve(new Response('ok')),
		);
		globalThis.fetch = mockFetch as unknown as typeof fetch;

		await httpRequest({
			url: 'https://example.com/api',
			qs: { page: 1, q: 'test' },
		});

		const [calledUrl] = mockFetch.mock.calls[0];
		const url = new URL(calledUrl);
		expect(url.searchParams.get('page')).toBe('1');
		expect(url.searchParams.get('q')).toBe('test');
	});

	it('sends JSON body with POST', async () => {
		const mockFetch = mock((_url: string, _init?: RequestInit) =>
			Promise.resolve(new Response('ok')),
		);
		globalThis.fetch = mockFetch as unknown as typeof fetch;

		await httpRequest({
			url: 'https://example.com/api',
			method: 'POST',
			body: { key: 'value' },
		});

		const [, calledInit] = mockFetch.mock.calls[0];
		expect(calledInit?.method).toBe('POST');
		expect(calledInit?.body).toBe('{"key":"value"}');
		expect((calledInit?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
	});

	it('returns full response when requested', async () => {
		const mockFetch = mock((_url: string, _init?: RequestInit) =>
			Promise.resolve(new Response(JSON.stringify({ data: 1 }), {
				status: 200,
				statusText: 'OK',
				headers: { 'Content-Type': 'application/json', 'X-Custom': 'val' },
			})),
		);
		globalThis.fetch = mockFetch as unknown as typeof fetch;

		const result = await httpRequest({
			url: 'https://example.com/api',
			returnFullResponse: true,
		});

		const resp = result as { body: unknown; headers: Record<string, string>; statusCode: number };
		expect(resp.statusCode).toBe(200);
		expect(resp.body).toEqual({ data: 1 });
		expect(resp.headers['x-custom']).toBe('val');
	});

	it('returns buffer for arraybuffer encoding', async () => {
		const content = Buffer.from('binary content');
		const mockFetch = mock((_url: string, _init?: RequestInit) =>
			Promise.resolve(new Response(content)),
		);
		globalThis.fetch = mockFetch as unknown as typeof fetch;

		const result = await httpRequest({
			url: 'https://example.com/file',
			encoding: 'arraybuffer',
		});

		expect(Buffer.isBuffer(result)).toBe(true);
		expect((result as Buffer).toString()).toBe('binary content');
	});

	it('applies basic auth from options.auth', async () => {
		const mockFetch = mock((_url: string, _init?: RequestInit) =>
			Promise.resolve(new Response('ok')),
		);
		globalThis.fetch = mockFetch as unknown as typeof fetch;

		await httpRequest({
			url: 'https://example.com/api',
			auth: { username: 'user', password: 'pass' },
		});

		const [, calledInit] = mockFetch.mock.calls[0];
		const headers = calledInit?.headers as Record<string, string>;
		const expected = Buffer.from('user:pass').toString('base64');
		expect(headers['Authorization']).toBe(`Basic ${expected}`);
	});

	it('uses manual redirect when disableFollowRedirect is true', async () => {
		const mockFetch = mock((_url: string, _init?: RequestInit) =>
			Promise.resolve(new Response('ok')),
		);
		globalThis.fetch = mockFetch as unknown as typeof fetch;

		await httpRequest({
			url: 'https://example.com/api',
			disableFollowRedirect: true,
		});

		const [, calledInit] = mockFetch.mock.calls[0];
		expect(calledInit?.redirect).toBe('manual');
	});
});

describe('httpRequestWithAuthentication', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('adds bearer token from credentials', async () => {
		const mockFetch = mock((_url: string, _init?: RequestInit) =>
			Promise.resolve(new Response('ok')),
		);
		globalThis.fetch = mockFetch as unknown as typeof fetch;

		await httpRequestWithAuthentication(
			{ url: 'https://example.com/api' },
			'oauth2',
			{ token: 'my-token' },
		);

		const [, calledInit] = mockFetch.mock.calls[0];
		const headers = calledInit?.headers as Record<string, string>;
		expect(headers['Authorization']).toBe('Bearer my-token');
	});

	it('adds API key with custom header name', async () => {
		const mockFetch = mock((_url: string, _init?: RequestInit) =>
			Promise.resolve(new Response('ok')),
		);
		globalThis.fetch = mockFetch as unknown as typeof fetch;

		await httpRequestWithAuthentication(
			{ url: 'https://example.com/api' },
			'apiKey',
			{ apiKey: 'secret-key', apiKeyHeader: 'X-Secret' },
		);

		const [, calledInit] = mockFetch.mock.calls[0];
		const headers = calledInit?.headers as Record<string, string>;
		expect(headers['X-Secret']).toBe('secret-key');
	});

	it('adds basic auth from user/password credentials', async () => {
		const mockFetch = mock((_url: string, _init?: RequestInit) =>
			Promise.resolve(new Response('ok')),
		);
		globalThis.fetch = mockFetch as unknown as typeof fetch;

		await httpRequestWithAuthentication(
			{ url: 'https://example.com/api' },
			'basic',
			{ user: 'admin', password: 'secret' },
		);

		const [, calledInit] = mockFetch.mock.calls[0];
		const headers = calledInit?.headers as Record<string, string>;
		const expected = Buffer.from('admin:secret').toString('base64');
		expect(headers['Authorization']).toBe(`Basic ${expected}`);
	});
});
