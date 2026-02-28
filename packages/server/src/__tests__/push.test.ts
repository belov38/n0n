import { describe, expect, test, beforeEach } from 'bun:test';

import { PushService } from '../push/push.service';
import type { PushMessage } from '../push/push.service';

function createMockWs() {
	const sent: string[] = [];
	return {
		sent,
		send(data: string) {
			sent.push(data);
		},
	};
}

function createFailingWs() {
	return {
		send(_data: string) {
			throw new Error('connection closed');
		},
	};
}

const testMessage: PushMessage = {
	type: 'executionStarted',
	data: { executionId: '123' },
};

describe('PushService', () => {
	let service: PushService;

	beforeEach(() => {
		service = new PushService();
	});

	test('register and unregister connections', () => {
		const ws = createMockWs();
		service.register('ref-1', ws);

		expect(service.isConnected('ref-1')).toBe(true);
		expect(service.getConnectionCount()).toBe(1);

		service.unregister('ref-1');
		expect(service.isConnected('ref-1')).toBe(false);
		expect(service.getConnectionCount()).toBe(0);
	});

	test('sendTo sends to correct pushRef', () => {
		const ws1 = createMockWs();
		const ws2 = createMockWs();
		service.register('ref-1', ws1);
		service.register('ref-2', ws2);

		const result = service.sendTo('ref-1', testMessage);

		expect(result).toBe(true);
		expect(ws1.sent).toHaveLength(1);
		expect(JSON.parse(ws1.sent[0])).toEqual(testMessage);
		expect(ws2.sent).toHaveLength(0);
	});

	test('sendTo returns false for unknown pushRef', () => {
		const result = service.sendTo('unknown', testMessage);
		expect(result).toBe(false);
	});

	test('broadcast sends to all connections', () => {
		const ws1 = createMockWs();
		const ws2 = createMockWs();
		const ws3 = createMockWs();
		service.register('ref-1', ws1);
		service.register('ref-2', ws2);
		service.register('ref-3', ws3);

		service.broadcast(testMessage);

		const expected = JSON.stringify(testMessage);
		expect(ws1.sent).toEqual([expected]);
		expect(ws2.sent).toEqual([expected]);
		expect(ws3.sent).toEqual([expected]);
	});

	test('failed send removes connection', () => {
		const failWs = createFailingWs();
		service.register('ref-fail', failWs);

		expect(service.isConnected('ref-fail')).toBe(true);

		const result = service.sendTo('ref-fail', testMessage);

		expect(result).toBe(false);
		expect(service.isConnected('ref-fail')).toBe(false);
		expect(service.getConnectionCount()).toBe(0);
	});

	test('broadcast removes failing connections but delivers to healthy ones', () => {
		const goodWs = createMockWs();
		const failWs = createFailingWs();
		service.register('good', goodWs);
		service.register('fail', failWs);

		service.broadcast(testMessage);

		expect(goodWs.sent).toHaveLength(1);
		expect(service.isConnected('good')).toBe(true);
		expect(service.isConnected('fail')).toBe(false);
		expect(service.getConnectionCount()).toBe(1);
	});

	test('re-registering a pushRef replaces the previous connection', () => {
		const ws1 = createMockWs();
		const ws2 = createMockWs();
		service.register('ref-1', ws1);
		service.register('ref-1', ws2);

		expect(service.getConnectionCount()).toBe(1);

		service.sendTo('ref-1', testMessage);
		expect(ws1.sent).toHaveLength(0);
		expect(ws2.sent).toHaveLength(1);
	});

	test('isConnected returns false for never-registered pushRef', () => {
		expect(service.isConnected('nonexistent')).toBe(false);
	});

	test('getConnectionCount reflects current state', () => {
		expect(service.getConnectionCount()).toBe(0);

		service.register('a', createMockWs());
		service.register('b', createMockWs());
		expect(service.getConnectionCount()).toBe(2);

		service.unregister('a');
		expect(service.getConnectionCount()).toBe(1);
	});
});
