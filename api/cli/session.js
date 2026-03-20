import {sendJson, sendMethodNotAllowed} from '../_lib/http.js';
import {requireCliSession} from '../_lib/require-cli-session.js';
import {revokeCliToken} from '../_lib/broker-state.js';

export default async function handler(request, response) {
	if (!['GET', 'POST'].includes(request.method)) {
		sendMethodNotAllowed(response, ['GET', 'POST']);
		return;
	}

	const session = await requireCliSession(request, response);

	if (!session) {
		return;
	}

	if (request.method === 'POST') {
		await revokeCliToken(session.storage, {
			token: session.token,
			sessionSecret: session.brokerConfig.sessionSecret
		});
		sendJson(response, 200, {
			revoked: true
		});
		return;
	}

	sendJson(response, 200, {
		shop: session.shopRecord.shop,
		scope: session.shopRecord.scope ?? '',
		authenticatedAt: session.shopRecord.authenticatedAt ?? '',
		tokenType: 'broker_session'
	});
}
