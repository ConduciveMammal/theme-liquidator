import test from 'node:test';
import assert from 'node:assert/strict';
import {exchangeClientCredentials, getMissingRequiredScopes, ShopifyAuthError} from '../src/client-credentials.js';

function createJsonResponse(status, body) {
	return {
		ok: status >= 200 && status < 300,
		status,
		async json() {
			return body;
		}
	};
}

test('exchangeClientCredentials returns token metadata on success', async () => {
	const fetchImpl = async () => createJsonResponse(200, {
		access_token: 'shpat_test',
		scope: 'read_themes,write_themes',
		expires_in: 86399
	});

	const token = await exchangeClientCredentials(
		{
			shop: 'alpha.myshopify.com',
			clientId: 'client-id',
			clientSecret: 'client-secret'
		},
		fetchImpl
	);

	assert.equal(token.accessToken, 'shpat_test');
	assert.equal(token.scope, 'read_themes,write_themes');
	assert.ok(token.expiresAt > Date.now());
});

test('exchangeClientCredentials surfaces shop_not_permitted style errors', async () => {
	const fetchImpl = async () => createJsonResponse(403, {
		error_description: 'Oauth error shop_not_permitted: Client credentials cannot be performed on this shop.'
	});

	await assert.rejects(
		() => exchangeClientCredentials(
			{
				shop: 'alpha.myshopify.com',
				clientId: 'client-id',
				clientSecret: 'client-secret'
			},
			fetchImpl
		),
		(error) => {
			assert.equal(error instanceof ShopifyAuthError, true);
			assert.match(error.message, /HTTP 403/);
			assert.deepEqual(error.details, ['Oauth error shop_not_permitted: Client credentials cannot be performed on this shop.']);
			return true;
		}
	);
});

test('getMissingRequiredScopes finds missing theme scopes', () => {
	assert.deepEqual(getMissingRequiredScopes('read_themes,write_themes'), []);
	assert.deepEqual(getMissingRequiredScopes('write_themes'), []);
	assert.deepEqual(getMissingRequiredScopes('read_themes'), ['write_themes']);
});
