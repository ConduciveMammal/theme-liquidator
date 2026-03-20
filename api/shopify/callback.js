import {URL} from 'node:url';
import {getMissingRequiredScopes} from '../../src/client-credentials.js';
import {exchangeAuthorizationCode, verifyShopifyHmac} from '../../src/oauth.js';
import {isValidShopDomain} from '../../src/config.js';
import {getShopifyBrokerConfig} from '../_lib/env.js';
import {sendHtml} from '../_lib/http.js';
import {getStorage} from '../_lib/storage.js';
import {
	completeAuthSession,
	failAuthSession,
	getAuthSession,
	issueCliToken,
	saveShopToken
} from '../_lib/broker-state.js';

function getRequestUrl(request, appUrl) {
	if (request.url.startsWith('http://') || request.url.startsWith('https://')) {
		return new URL(request.url);
	}

	return new URL(request.url, appUrl);
}

export default async function handler(request, response) {
	const brokerConfig = getShopifyBrokerConfig();
	const storage = getStorage();
	const requestUrl = getRequestUrl(request, brokerConfig.appUrl);
	const sessionId = requestUrl.searchParams.get('session') ?? '';
	const authSession = sessionId ? await getAuthSession(storage, sessionId) : null;

	async function fail(statusCode, title, message, details = []) {
		if (sessionId) {
			await failAuthSession(storage, sessionId, message, details);
		}

		sendHtml(response, statusCode, title, message);
	}

	try {
		const state = requestUrl.searchParams.get('state') ?? '';
		const shop = requestUrl.searchParams.get('shop') ?? '';
		const code = requestUrl.searchParams.get('code') ?? '';

		if (!sessionId || !authSession) {
			await fail(400, 'Authentication failed', 'The hosted auth session is missing or expired.');
			return;
		}

		if (!code || !state || !shop) {
			await fail(400, 'Authentication failed', 'Shopify did not return the expected OAuth parameters.');
			return;
		}

		if (!isValidShopDomain(shop)) {
			await fail(400, 'Authentication failed', 'Shopify returned an invalid shop hostname.');
			return;
		}

		if (shop !== authSession.shop) {
			await fail(400, 'Authentication failed', 'Shopify returned a different shop than the one selected in the CLI.');
			return;
		}

		if (state !== authSession.state) {
			await fail(400, 'Authentication failed', 'The hosted auth state check failed.');
			return;
		}

		if (!verifyShopifyHmac(requestUrl.searchParams, brokerConfig.clientSecret)) {
			await fail(400, 'Authentication failed', 'The Shopify callback HMAC was invalid.');
			return;
		}

		const token = await exchangeAuthorizationCode({
			shop,
			clientId: brokerConfig.clientId,
			clientSecret: brokerConfig.clientSecret,
			code
		});
		const missingScopes = getMissingRequiredScopes(token.scope);

		if (missingScopes.length > 0) {
			await fail(403, 'Authentication failed', `The Shopify app is missing required scopes: ${missingScopes.join(', ')}.`);
			return;
		}

		await saveShopToken(storage, shop, {
			accessToken: token.accessToken,
			scope: token.scope,
			authenticatedAt: new Date().toISOString()
		});

		const cliToken = await issueCliToken(storage, {
			shop,
			tokenTtlSeconds: brokerConfig.cliTokenTtlSeconds,
			sessionSecret: brokerConfig.sessionSecret
		});

		await completeAuthSession(storage, sessionId, {
			shop,
			scope: token.scope,
			cliToken
		});

		sendHtml(response, 200, 'Authentication complete', 'The Shopify app is authorised. Return to the terminal to continue.');
	} catch (error) {
		await fail(500, 'Authentication failed', error.message, error.details ?? []);
	}
}
