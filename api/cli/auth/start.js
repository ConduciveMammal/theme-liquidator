import {buildAuthorizeUrl} from '../../../src/oauth.js';
import {isValidShopDomain, normaliseShopDomain} from '../../../src/config.js';
import {sendJson, sendMethodNotAllowed, readJsonBody} from '../../_lib/http.js';
import {getShopifyBrokerConfig} from '../../_lib/env.js';
import {getStorage} from '../../_lib/storage.js';
import {createPendingAuthSession, createSessionId, createStateToken} from '../../_lib/broker-state.js';

export default async function handler(request, response) {
	if (request.method !== 'POST') {
		sendMethodNotAllowed(response, ['POST']);
		return;
	}

	try {
		const body = await readJsonBody(request);
		const shop = normaliseShopDomain(body.shop ?? '');

		if (!isValidShopDomain(shop)) {
			sendJson(response, 400, {
				error: 'Invalid shop identifier.'
			});
			return;
		}

		const brokerConfig = getShopifyBrokerConfig();
		const storage = getStorage();
		const sessionId = createSessionId();
		const state = createStateToken();
		const redirectUri = `${brokerConfig.appUrl}/api/shopify/callback?session=${encodeURIComponent(sessionId)}`;

		await createPendingAuthSession(storage, {
			sessionId,
			shop,
			state
		}, brokerConfig.authSessionTtlSeconds);

		sendJson(response, 200, {
			sessionId,
			authorizeUrl: buildAuthorizeUrl({
				shop,
				clientId: brokerConfig.clientId,
				redirectUri,
				state,
				scopes: brokerConfig.scopes
			}),
			pollIntervalMs: 1500
		});
	} catch (error) {
		sendJson(response, 500, {
			error: error.message
		});
	}
}
