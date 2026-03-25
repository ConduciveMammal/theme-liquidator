import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/webhooks.js';
import {computeWebhookHmac, verifyWebhookHmac} from '../src/webhooks.js';

const clientSecret = 'shpss_test_secret';

function createResponseRecorder() {
	return {
		statusCode: 200,
		headers: {},
		body: '',
		setHeader(name, value) {
			this.headers[name.toLowerCase()] = value;
		},
		end(value = '') {
			this.body = value;
		}
	};
}

function createRequest({method = 'POST', topic = 'customers/redact', rawBody = Buffer.from('{}'), hmac, headers = {}} = {}) {
	const resolvedHmac = hmac ?? computeWebhookHmac(rawBody, clientSecret);
	const request = {
		method,
		headers: {
			'x-shopify-topic': topic,
			'x-shopify-hmac-sha256': resolvedHmac,
			...headers
		},
		body: rawBody,
		async *[Symbol.asyncIterator]() {
			if (rawBody.length > 0) {
				yield rawBody;
			}
		}
	};

	return request;
}

test('verifyWebhookHmac accepts a valid Shopify webhook signature', () => {
	const rawBody = Buffer.from(JSON.stringify({shop_id: 123}));
	const headers = {
		'x-shopify-hmac-sha256': computeWebhookHmac(rawBody, clientSecret)
	};

	assert.equal(verifyWebhookHmac(rawBody, headers, clientSecret), true);
});

test('verifyWebhookHmac rejects an invalid Shopify webhook signature', () => {
	const rawBody = Buffer.from(JSON.stringify({shop_id: 123}));
	const headers = {
		'x-shopify-hmac-sha256': computeWebhookHmac(Buffer.from('different'), clientSecret)
	};

	assert.equal(verifyWebhookHmac(rawBody, headers, clientSecret), false);
});

test('webhook handler returns 200 for a valid compliance webhook', async () => {
	process.env.SHOPIFY_APP_CLIENT_ID = 'test-client-id';
	process.env.SHOPIFY_APP_CLIENT_SECRET = clientSecret;
	process.env.SHOPIFY_APP_URL = 'https://liquidator.example.com';
	process.env.SHOPIFY_LIQUIDATOR_SESSION_SECRET = 'test-session-secret';

	const rawBody = Buffer.from(JSON.stringify({shop_id: 123}));
	const request = createRequest({rawBody});
	const response = createResponseRecorder();

	await handler(request, response);

	assert.equal(response.statusCode, 200);
	assert.deepEqual(JSON.parse(response.body), {ok: true});
});

test('webhook handler returns 401 for an invalid HMAC', async () => {
	process.env.SHOPIFY_APP_CLIENT_ID = 'test-client-id';
	process.env.SHOPIFY_APP_CLIENT_SECRET = clientSecret;
	process.env.SHOPIFY_APP_URL = 'https://liquidator.example.com';
	process.env.SHOPIFY_LIQUIDATOR_SESSION_SECRET = 'test-session-secret';

	const rawBody = Buffer.from(JSON.stringify({shop_id: 123}));
	const request = createRequest({
		rawBody,
		hmac: computeWebhookHmac(Buffer.from('tampered'), clientSecret)
	});
	const response = createResponseRecorder();

	await handler(request, response);

	assert.equal(response.statusCode, 401);
	assert.deepEqual(JSON.parse(response.body), {error: 'Invalid webhook HMAC.'});
});

test('webhook handler rejects unsupported webhook topics', async () => {
	process.env.SHOPIFY_APP_CLIENT_ID = 'test-client-id';
	process.env.SHOPIFY_APP_CLIENT_SECRET = clientSecret;
	process.env.SHOPIFY_APP_URL = 'https://liquidator.example.com';
	process.env.SHOPIFY_LIQUIDATOR_SESSION_SECRET = 'test-session-secret';

	const rawBody = Buffer.from(JSON.stringify({shop_id: 123}));
	const request = createRequest({topic: 'orders/create', rawBody});
	const response = createResponseRecorder();

	await handler(request, response);

	assert.equal(response.statusCode, 400);
	assert.deepEqual(JSON.parse(response.body), {error: 'Unsupported webhook topic.'});
});
