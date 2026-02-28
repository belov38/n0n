export interface PushConnection {
	pushRef: string;
	ws: WebSocket | { send(data: string): void };
	userId?: string;
}

export type PushEventType =
	| 'executionStarted'
	| 'executionFinished'
	| 'executionRecovered'
	| 'executionWaiting'
	| 'nodeExecuteBefore'
	| 'nodeExecuteAfter'
	| 'workflowActivated'
	| 'workflowDeactivated'
	| 'workflowFailedToActivate'
	| 'sendWorkerStatusMessage'
	| 'reloadNodeType'
	| 'testWebhookReceived'
	| 'testWebhookDeleted';

export interface PushMessage {
	type: PushEventType;
	data: Record<string, unknown>;
}

export class PushService {
	private connections = new Map<string, PushConnection>();

	register(pushRef: string, ws: WebSocket | { send(data: string): void }): void {
		this.connections.set(pushRef, { pushRef, ws });
	}

	unregister(pushRef: string): void {
		this.connections.delete(pushRef);
	}

	sendTo(pushRef: string, message: PushMessage): boolean {
		const connection = this.connections.get(pushRef);
		if (!connection) return false;

		try {
			connection.ws.send(JSON.stringify(message));
			return true;
		} catch {
			this.connections.delete(pushRef);
			return false;
		}
	}

	broadcast(message: PushMessage): void {
		const payload = JSON.stringify(message);
		for (const [pushRef, connection] of this.connections) {
			try {
				connection.ws.send(payload);
			} catch {
				this.connections.delete(pushRef);
			}
		}
	}

	getConnectionCount(): number {
		return this.connections.size;
	}

	isConnected(pushRef: string): boolean {
		return this.connections.has(pushRef);
	}
}

let pushServiceInstance: PushService | undefined;

export function getPushService(): PushService {
	if (!pushServiceInstance) {
		pushServiceInstance = new PushService();
	}
	return pushServiceInstance;
}
