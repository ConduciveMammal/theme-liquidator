import {sendJson, sendMethodNotAllowed, readRawBody} from './_lib/http.js';
import {getShopifyBrokerConfig} from './_lib/env.js';
import {getWebhookTopic, verifyWebhookHmac} from '../src/webhooks.js';

const COMPLIANCE_TOPICS = new Set([
	'customers/data_request',
	'customers/redact',
	'shop/redact'
]);

export default async function handler(request, response) {
	if (request.method !== 'POST') {
		sendMethodNotAllowed(response, ['POST']);
		return;
	}

	try {
		const brokerConfig = getShopifyBrokerConfig();
		const rawBody = await readRawBody(request);

		if (!verifyWebhookHmac(rawBody, request.headers, brokerConfig.clientSecret)) {
			sendJson(response, 401, {
				error: 'Invalid webhook HMAC.'
			});
			return;
		}

		const topic = getWebhookTopic(request.headers);

		if (!COMPLIANCE_TOPICS.has(topic)) {
			sendJson(response, 400, {
				error: 'Unsupported webhook topic.'
			});
			return;
		}

		sendJson(response, 200, {
			ok: true
		});
	} catch (error) {
		sendJson(response, 500, {
			error: error.message
		});
	}
}
