import {execFile} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {promisify} from 'node:util';
import {normaliseApiBaseUrl} from './config.js';
import {ShopifyApiError} from './shopify.js';

const execFileAsync = promisify(execFile);
const DEFAULT_AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1500;

function parseResponseText(payload) {
	if (typeof payload === 'string') {
		return payload;
	}

	return '';
}

function normaliseDetails(payload, fallbackText = '') {
	const details = [];

	if (Array.isArray(payload?.details)) {
		for (const detail of payload.details) {
			if (typeof detail === 'string' && detail.trim()) {
				details.push(detail.trim());
			}
		}
	}

	for (const field of ['error', 'message']) {
		if (typeof payload?.[field] === 'string' && payload[field].trim()) {
			details.push(payload[field].trim());
		}
	}

	if (details.length === 0 && fallbackText) {
		details.push(fallbackText);
	}

	return [...new Set(details)];
}

async function parseResponsePayload(response) {
	const contentType = response.headers.get('content-type') ?? '';

	if (contentType.includes('application/json')) {
		return response.json().catch(() => null);
	}

	return response.text().catch(() => '');
}

async function requestBroker(apiBaseUrl, pathname, options = {}, fetchImpl = globalThis.fetch) {
	const baseUrl = normaliseApiBaseUrl(apiBaseUrl);

	if (!baseUrl) {
		throw new Error('Missing hosted API base URL. Set `SHOPIFY_LIQUIDATOR_API_BASE_URL`.');
	}

	const {
		method = 'GET',
		body,
		token = '',
		headers = {}
	} = options;
	const url = new URL(pathname, `${baseUrl}/`);
	const requestHeaders = {
		Accept: 'application/json',
		...headers
	};

	if (body !== undefined) {
		requestHeaders['Content-Type'] = 'application/json';
	}

	if (token) {
		requestHeaders.Authorization = `Bearer ${token}`;
	}

	let response;

	try {
		response = await fetchImpl(url, {
			method,
			headers: requestHeaders,
			body: body === undefined ? undefined : JSON.stringify(body)
		});
	} catch (error) {
		throw new ShopifyApiError('Network error while calling the hosted Shopify broker.', {
			operation: pathname,
			details: [error.message]
		});
	}

	const payload = await parseResponsePayload(response);

	if (!response.ok) {
		const fallbackText = parseResponseText(payload);
		const details = normaliseDetails(payload, fallbackText);
		throw new ShopifyApiError(
			typeof payload?.message === 'string' ? payload.message : `Hosted broker request failed with HTTP ${response.status}.`,
			{
				operation: pathname,
				status: response.status,
				code: typeof payload?.code === 'string' ? payload.code : '',
				details
			}
		);
	}

	return payload;
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

function formatDeleteFailure(error, themeName) {
	if (error instanceof ShopifyApiError) {
		return [error.message, ...error.details].filter(Boolean).join(' ');
	}

	return `Unexpected error while deleting ${themeName}.`;
}

export function getBrokerApiBaseUrl(env = process.env, authConfig = null, shopProfile = null) {
	const envUrl = normaliseApiBaseUrl(env.SHOPIFY_LIQUIDATOR_API_BASE_URL ?? '');

	if (envUrl) {
		return envUrl;
	}

	const shopUrl = normaliseApiBaseUrl(shopProfile?.apiBaseUrl ?? '');

	if (shopUrl) {
		return shopUrl;
	}

	return normaliseApiBaseUrl(authConfig?.credentials?.apiBaseUrl ?? '');
}

export function isBrokerConfigured(env = process.env, authConfig = null, shopProfile = null) {
	return Boolean(getBrokerApiBaseUrl(env, authConfig, shopProfile));
}

export async function startBrokeredAuth({apiBaseUrl, shop}, fetchImpl = globalThis.fetch) {
	return requestBroker(apiBaseUrl, '/api/cli/auth/start', {
		method: 'POST',
		body: {shop}
	}, fetchImpl);
}

export async function pollBrokeredAuthSession({apiBaseUrl, sessionId}, fetchImpl = globalThis.fetch) {
	const url = new URL('/api/cli/auth/poll', `${normaliseApiBaseUrl(apiBaseUrl)}/`);
	url.searchParams.set('session', sessionId);
	return requestBroker(apiBaseUrl, url.pathname + url.search, {}, fetchImpl);
}

export async function completeBrokeredAuth(
	{apiBaseUrl, shop, authTimeoutMs = DEFAULT_AUTH_TIMEOUT_MS},
	{
		fetchImpl = globalThis.fetch,
		openBrowserImpl = openBrowser,
		onPoll = null
	} = {}
) {
	const started = await startBrokeredAuth({apiBaseUrl, shop}, fetchImpl);
	await openBrowserImpl(started.authorizeUrl);

	const pollIntervalMs = Number.isFinite(started.pollIntervalMs) ? started.pollIntervalMs : DEFAULT_POLL_INTERVAL_MS;
	const startedAt = Date.now();

	while (Date.now() - startedAt < authTimeoutMs) {
		await delay(pollIntervalMs);
		const polled = await pollBrokeredAuthSession({apiBaseUrl, sessionId: started.sessionId}, fetchImpl);
		onPoll?.(polled);

		if (polled.status === 'complete') {
			return polled;
		}

		if (polled.status === 'failed') {
			throw new ShopifyApiError(polled.error || 'Hosted Shopify login failed.', {
				operation: 'broker_auth_poll',
				code: polled.code ?? '',
				details: polled.details ?? []
			});
		}
	}

	throw new ShopifyApiError('Timed out while waiting for the hosted Shopify login to complete.', {
		operation: 'broker_auth_poll'
	});
}

export async function validateBrokerSession({apiBaseUrl, token}, fetchImpl = globalThis.fetch) {
	return requestBroker(apiBaseUrl, '/api/cli/session', {
		token
	}, fetchImpl);
}

export async function revokeBrokerSession({apiBaseUrl, token}, fetchImpl = globalThis.fetch) {
	return requestBroker(apiBaseUrl, '/api/cli/session', {
		method: 'POST',
		token
	}, fetchImpl);
}

export async function fetchAllThemesViaBroker({apiBaseUrl, token}, fetchImpl = globalThis.fetch) {
	const payload = await requestBroker(apiBaseUrl, '/api/cli/themes', {
		token
	}, fetchImpl);
	return payload.themes ?? [];
}

export async function deleteThemeViaBroker({apiBaseUrl, token, theme, dryRun = false}, fetchImpl = globalThis.fetch) {
	const payload = await requestBroker(apiBaseUrl, '/api/cli/themes/delete', {
		method: 'POST',
		token,
		body: {
			theme,
			dryRun
		}
	}, fetchImpl);
	return payload.result;
}

export async function deleteThemesSequentiallyViaBroker(config, themes, onProgress, fetchImpl = globalThis.fetch, options = {}) {
	const results = [];

	for (const [index, theme] of themes.entries()) {
		onProgress?.(theme.id, 'pending', '');

		try {
			const result = await deleteThemeViaBroker({
				apiBaseUrl: config.apiBaseUrl,
				token: config.token,
				theme,
				dryRun: options.dryRun
			}, fetchImpl);
			results.push(result);
			onProgress?.(theme.id, result.status, result.error);
		} catch (error) {
			const message = formatDeleteFailure(error, theme.name);
			const isFatal = error instanceof ShopifyApiError && error.code === 'theme_delete_permission_denied';
			const result = {
				status: 'failed',
				id: theme.id,
				name: theme.name,
				role: theme.role,
				theme,
				error: message,
				fatal: isFatal
			};
			results.push(result);
			onProgress?.(theme.id, result.status, result.error);

			if (isFatal) {
				for (const remainingTheme of themes.slice(index + 1)) {
					const remainingResult = {
						status: 'failed',
						id: remainingTheme.id,
						name: remainingTheme.name,
						role: remainingTheme.role,
						theme: remainingTheme,
						error: 'Skipped. Theme deletion is blocked for this app.',
						fatal: true
					};
					results.push(remainingResult);
					onProgress?.(remainingTheme.id, remainingResult.status, remainingResult.error);
				}

				break;
			}
		}
	}

	return results;
}
