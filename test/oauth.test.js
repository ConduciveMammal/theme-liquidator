import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {URL} from 'node:url';
import {
	buildAuthorizeUrl,
	buildShopifyHmacMessage,
	exchangeAuthorizationCode,
	verifyShopifyHmac
} from '../src/oauth.js';

function createJsonResponse(status, body) {
	return {
		ok: status >= 200 && status < 300,
		status,
		async json() {
			return body;
		}
	};
}

test('buildAuthorizeUrl includes the expected Shopify OAuth parameters', () => {
	const url = new URL(buildAuthorizeUrl({
		shop: 'alpha.myshopify.com',
		clientId: 'client-id',
		redirectUri: 'http://127.0.0.1:3457/oauth/callback',
		state: 'nonce-value',
		scopes: 'read_themes,write_themes'
	}));

	assert.equal(url.origin, 'https://alpha.myshopify.com');
	assert.equal(url.pathname, '/admin/oauth/authorize');
	assert.equal(url.searchParams.get('client_id'), 'client-id');
	assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:3457/oauth/callback');
	assert.equal(url.searchParams.get('state'), 'nonce-value');
	assert.equal(url.searchParams.get('scope'), 'read_themes,write_themes');
	assert.equal(url.searchParams.has('grant_options[]'), false);
});

test('buildShopifyHmacMessage sorts parameters and skips hmac fields', () => {
	const searchParams = new URLSearchParams('code=test-code&shop=alpha.myshopify.com&timestamp=123&hmac=ignore-me&signature=skip-me');

	assert.equal(
		buildShopifyHmacMessage(searchParams),
		'code=test-code&shop=alpha.myshopify.com&timestamp=123'
	);
});

test('verifyShopifyHmac validates a signed Shopify callback', () => {
	const searchParams = new URLSearchParams('code=test-code&shop=alpha.myshopify.com&state=nonce-value&timestamp=123');
	const clientSecret = 'client-secret';
	const message = buildShopifyHmacMessage(searchParams);
	const hmac = crypto.createHmac('sha256', clientSecret).update(message).digest('hex');
	searchParams.set('hmac', hmac);

	assert.equal(verifyShopifyHmac(searchParams, clientSecret), true);
});

test('verifyShopifyHmac returns false for malformed HMAC lengths', () => {
	const searchParams = new URLSearchParams('code=test-code&shop=alpha.myshopify.com&state=nonce-value&timestamp=123&hmac=short');

	assert.equal(verifyShopifyHmac(searchParams, 'client-secret'), false);
});

test('exchangeAuthorizationCode returns token metadata on success', async () => {
	const fetchImpl = async () => createJsonResponse(200, {
		access_token: 'shpua_test',
		scope: 'read_themes,write_themes'
	});

	const token = await exchangeAuthorizationCode(
		{
			shop: 'alpha.myshopify.com',
			clientId: 'client-id',
			clientSecret: 'client-secret',
			code: 'test-code'
		},
		fetchImpl
	);

	assert.equal(token.accessToken, 'shpua_test');
	assert.equal(token.scope, 'read_themes,write_themes');
});

test('exchangeAuthorizationCode surfaces OAuth payload errors', async () => {
	const fetchImpl = async () => createJsonResponse(400, {
		error: 'invalid_request',
		error_description: 'The authorisation code has expired.'
	});

	await assert.rejects(
		() => exchangeAuthorizationCode(
			{
				shop: 'alpha.myshopify.com',
				clientId: 'client-id',
				clientSecret: 'client-secret',
				code: 'expired-code'
			},
			fetchImpl
		),
		(error) => {
			assert.match(error.message, /HTTP 400/);
			assert.deepEqual(error.details, ['invalid_request', 'The authorisation code has expired.']);
			return true;
		}
	);
});
