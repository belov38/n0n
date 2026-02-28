import { Elysia, t } from 'elysia';

import { getPushService } from './push.service';

export const pushRoutes = new Elysia({ prefix: '/push' }).ws('/ws', {
	query: t.Object({
		pushRef: t.String(),
	}),
	open(ws) {
		const { pushRef } = ws.data.query;
		if (!pushRef) {
			ws.close();
			return;
		}
		getPushService().register(pushRef, ws);
	},
	message(_ws, _message) {
		// Client messages (heartbeat, etc.) are not handled yet
	},
	close(ws) {
		const { pushRef } = ws.data.query;
		if (pushRef) {
			getPushService().unregister(pushRef);
		}
	},
});
