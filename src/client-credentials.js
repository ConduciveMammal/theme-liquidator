import {URLSearchParams} from 'node:url';

const REQUIRED_SCOPES = ['read_themes', 'write_themes'];
const tokenCache = new Map();

export class ShopifyAuthError extends Error {
	constructor(message, options = {}) {
		super(message);
		this.name = 'ShopifyAuthError';
		this.status = options.status;
		this.details = options.details ?? [];
	}
}

function normaliseErrorMessages(value) {
	if (!value) {
		return [];
	}

	if (Array.isArray(value)) {
		return value.flatMap((entry) => normaliseErrorMessages(entry));
	}

	if (typeof value === 'string') {
		return [value];
	}

	if (typeof value === 'object') {
		if (typeof value.message === 'string') {
			return [value.message];
		}

		return Object.values(value).flatMap((entry) => normaliseErrorMessages(entry));
	}

	return [String(value)];
}

function getPayloadErrors(payload) {
	return [
		...normaliseErrorMessages(payload?.errors),
		...normaliseErrorMessages(payload?.error),
		...normaliseErrorMessages(payload?.error_description),
		...normaliseErrorMessages(payload?.message)
	];
}

function getCacheKey(shop, clientId) {
	return `${shop}::${clientId}`;
}

export function getMissingRequiredScopes(scopeValue) {
	const scopes = scopeValue
		.split(',')
		.map((scope) => scope.trim())
		.filter(Boolean);

	return REQUIRED_SCOPES.filter((scope) => {
		if (scopes.includes(scope)) {
			return false;
		}

		if (scope.startsWith('read_')) {
			const writeScope = `write_${scope.slice('read_'.length)}`;
			return !scopes.includes(writeScope);
		}

		return true;
	});
}

export async function exchangeClientCredentials({shop, clientId, clientSecret}, fetchImpl = globalThis.fetch) {
	const response = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams({
			grant_type: 'client_credentials',
			client_id: clientId,
			client_secret: clientSecret
		})
	});

	const payload = await response.json().catch(() => null);

	if (!response.ok) {
		const details = getPayloadErrors(payload);
		throw new ShopifyAuthError(`Token request failed with HTTP ${response.status}.`, {
			status: response.status,
			details
		});
	}

	if (!payload?.access_token) {
		throw new ShopifyAuthError('Token request succeeded, but Shopify did not return an access token.', {
			details: getPayloadErrors(payload)
		});
	}

	return {
		accessToken: payload.access_token,
		scope: payload.scope ?? '',
		expiresAt: Date.now() + (payload.expires_in ?? 86399) * 1000
	};
}

export async function getAccessToken(credentials, fetchImpl = globalThis.fetch) {
	const cacheKey = getCacheKey(credentials.shop, credentials.clientId);
	const cached = tokenCache.get(cacheKey);

	if (cached && Date.now() < cached.expiresAt - 60_000) {
		return cached;
	}

	const token = await exchangeClientCredentials(credentials, fetchImpl);
	tokenCache.set(cacheKey, token);
	return token;
}
