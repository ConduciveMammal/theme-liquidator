import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import http from 'node:http';
import {URL, URLSearchParams} from 'node:url';
import {promisify} from 'node:util';
import {isValidShopDomain} from './config.js';

const execFileAsync = promisify(execFile);
const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:3457/oauth/callback';
const DEFAULT_SCOPES = 'read_themes,write_themes';
const STATE_COOKIE = 'shopify_liquidator_oauth_state';

export class ShopifyOAuthError extends Error {
	constructor(message, options = {}) {
		super(message);
		this.name = 'ShopifyOAuthError';
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

export function getRedirectUri(env = process.env) {
	return env.SHOPIFY_OAUTH_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;
}

export function getRequestedScopes(env = process.env) {
	return env.SHOPIFY_SCOPES?.trim() || DEFAULT_SCOPES;
}

export function createNonce() {
	return crypto.randomBytes(16).toString('hex');
}

export function buildShopifyHmacMessage(searchParams) {
	const entries = [];

	for (const [key, value] of searchParams.entries()) {
		if (key === 'hmac' || key === 'signature') {
			continue;
		}

		entries.push(`${key}=${value}`);
	}

	return entries.sort().join('&');
}

export function verifyShopifyHmac(searchParams, clientSecret) {
	const providedHmac = searchParams.get('hmac');

	if (!providedHmac) {
		return false;
	}

	const message = buildShopifyHmacMessage(searchParams);
	const computedHmac = crypto
		.createHmac('sha256', clientSecret)
		.update(message)
		.digest('hex');

	if (computedHmac.length !== providedHmac.length) {
		return false;
	}

	return crypto.timingSafeEqual(
		Buffer.from(computedHmac, 'utf8'),
		Buffer.from(providedHmac, 'utf8')
	);
}

export function buildAuthorizeUrl({shop, clientId, redirectUri, state, scopes}) {
	const url = new URL(`https://${shop}/admin/oauth/authorize`);
	url.searchParams.set('client_id', clientId);
	url.searchParams.set('redirect_uri', redirectUri);
	url.searchParams.set('state', state);

	if (scopes) {
		url.searchParams.set('scope', scopes);
	}

	return url.toString();
}

function parseCookies(cookieHeader) {
	const cookies = {};

	for (const part of (cookieHeader ?? '').split(';')) {
		const [name, ...rest] = part.trim().split('=');

		if (!name) {
			continue;
		}

		cookies[name] = rest.join('=');
	}

	return cookies;
}

async function openBrowser(url, execImpl = execFileAsync) {
	if (process.platform === 'darwin') {
		await execImpl('open', [url]);
		return;
	}

	if (process.platform === 'win32') {
		await execImpl('cmd', ['/c', 'start', '', url]);
		return;
	}

	await execImpl('xdg-open', [url]);
}

export async function exchangeAuthorizationCode({shop, clientId, clientSecret, code}, fetchImpl = globalThis.fetch) {
	const response = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json'
		},
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			code
		})
	});

	const payload = await response.json().catch(() => null);

	if (!response.ok) {
		throw new ShopifyOAuthError(`OAuth token exchange failed with HTTP ${response.status}.`, {
			status: response.status,
			details: [
				...normaliseErrorMessages(payload?.errors),
				...normaliseErrorMessages(payload?.error),
				...normaliseErrorMessages(payload?.error_description),
				...normaliseErrorMessages(payload?.message)
			]
		});
	}

	if (!payload?.access_token) {
		throw new ShopifyOAuthError('Shopify did not return an offline access token.');
	}

	return {
		accessToken: payload.access_token,
		scope: payload.scope ?? ''
	};
}

function sendHtml(response, statusCode, title, message) {
	response.writeHead(statusCode, {'Content-Type': 'text/html; charset=utf-8'});
	response.end(`<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>${message}</p></body></html>`);
}

export async function runOAuthBrowserFlow(
	{shop, clientId, clientSecret, redirectUri = getRedirectUri(), scopes = getRequestedScopes()},
	{
		fetchImpl = globalThis.fetch,
		openBrowserImpl = openBrowser
	} = {}
) {
	if (!isValidShopDomain(shop)) {
		throw new ShopifyOAuthError(`Invalid shop identifier "${shop}".`);
	}

	const redirectUrl = new URL(redirectUri);
	const callbackState = createNonce();
	const startPath = '/oauth/start';

	const result = await new Promise((resolve, reject) => {
		let settled = false;

		const finish = (handler, value) => {
			if (settled) {
				return;
			}

			settled = true;
			server.close(() => handler(value));
		};

		const server = http.createServer(async (request, response) => {
			try {
				const requestUrl = new URL(request.url, `${redirectUrl.protocol}//${redirectUrl.host}`);

				if (requestUrl.pathname === startPath) {
					response.writeHead(302, {
						Location: buildAuthorizeUrl({
							shop,
							clientId,
							redirectUri,
							state: callbackState,
							scopes
						}),
						'Set-Cookie': `${STATE_COOKIE}=${callbackState}; HttpOnly; Path=/; SameSite=Lax; Max-Age=600`
					});
					response.end();
					return;
				}

				if (requestUrl.pathname !== redirectUrl.pathname) {
					sendHtml(response, 404, 'Not found', 'This OAuth endpoint only handles Shopify login callbacks.');
					return;
				}

				const cookies = parseCookies(request.headers.cookie);
				const state = requestUrl.searchParams.get('state');
				const shopParam = requestUrl.searchParams.get('shop');
				const code = requestUrl.searchParams.get('code');

				if (!code || !state || !shopParam) {
					sendHtml(response, 400, 'Authentication failed', 'Shopify did not return the expected OAuth parameters.');
					finish(reject, new ShopifyOAuthError('Shopify did not return the expected OAuth parameters.'));
					return;
				}

				if (cookies[STATE_COOKIE] !== callbackState || state !== callbackState) {
					sendHtml(response, 400, 'Authentication failed', 'The OAuth state check failed.');
					finish(reject, new ShopifyOAuthError('The OAuth state check failed.'));
					return;
				}

				if (!isValidShopDomain(shopParam)) {
					sendHtml(response, 400, 'Authentication failed', 'Shopify returned an invalid shop hostname.');
					finish(reject, new ShopifyOAuthError('Shopify returned an invalid shop hostname.'));
					return;
				}

				if (shopParam !== shop) {
					sendHtml(response, 400, 'Authentication failed', 'Shopify returned a different shop than the one you selected.');
					finish(reject, new ShopifyOAuthError('Shopify returned a different shop than the one you selected.'));
					return;
				}

				if (!verifyShopifyHmac(requestUrl.searchParams, clientSecret)) {
					sendHtml(response, 400, 'Authentication failed', 'The Shopify callback HMAC was invalid.');
					finish(reject, new ShopifyOAuthError('The Shopify callback HMAC was invalid.'));
					return;
				}

				const token = await exchangeAuthorizationCode(
					{
						shop: shopParam,
						clientId,
						clientSecret,
						code
					},
					fetchImpl
				);

				sendHtml(response, 200, 'Authentication complete', 'You can return to the terminal now.');
				finish(resolve, {
					shop: shopParam,
					accessToken: token.accessToken,
					scope: token.scope
				});
			} catch (error) {
				sendHtml(response, 500, 'Authentication failed', 'An unexpected error occurred while completing OAuth.');
				finish(reject, error);
			}
		});

		server.once('error', (error) => {
			finish(reject, new ShopifyOAuthError(`Could not start the local OAuth callback server: ${error.message}`));
		});

		server.listen(Number(redirectUrl.port), redirectUrl.hostname, async () => {
			try {
				await openBrowserImpl(new URL(startPath, `${redirectUrl.protocol}//${redirectUrl.host}`).toString());
			} catch (error) {
				finish(reject, new ShopifyOAuthError(`Could not open the browser automatically. Open this URL manually: ${new URL(startPath, `${redirectUrl.protocol}//${redirectUrl.host}`).toString()}`));
			}
		});
	});

	return result;
}
