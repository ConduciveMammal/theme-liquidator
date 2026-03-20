import {getBearerToken, sendJson} from './http.js';
import {getStorage} from './storage.js';
import {getShopifyBrokerConfig} from './env.js';
import {getCliTokenRecord, getShopToken} from './broker-state.js';

export async function requireCliSession(request, response) {
	const token = getBearerToken(request);

	if (!token) {
		sendJson(response, 401, {
			error: 'Missing bearer token.'
		});
		return null;
	}

	const storage = getStorage();
	const brokerConfig = getShopifyBrokerConfig();
	const tokenRecord = await getCliTokenRecord(storage, {
		token,
		sessionSecret: brokerConfig.sessionSecret
	});

	if (!tokenRecord?.shop) {
		sendJson(response, 401, {
			error: 'The broker session is invalid or has expired.'
		});
		return null;
	}

	const shopRecord = await getShopToken(storage, tokenRecord.shop);

	if (!shopRecord?.accessToken) {
		sendJson(response, 401, {
			error: 'No stored Shopify installation was found for this shop.'
		});
		return null;
	}

	return {
		token,
		tokenRecord,
		shopRecord,
		brokerConfig,
		storage
	};
}
