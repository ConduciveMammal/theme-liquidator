import {normaliseApiBaseUrl} from '../../src/config.js';

const DEFAULT_SCOPES = 'read_themes,write_themes';
const DEFAULT_CLI_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_AUTH_SESSION_TTL_SECONDS = 10 * 60;

function readRequiredEnv(name, env = process.env) {
	const value = env[name]?.trim();

	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}

	return value;
}

export function getShopifyBrokerConfig(env = process.env) {
	const clientId = (env.SHOPIFY_APP_CLIENT_ID ?? env.SHOPIFY_CLIENT_ID ?? '').trim();
	const clientSecret = (env.SHOPIFY_APP_CLIENT_SECRET ?? env.SHOPIFY_CLIENT_SECRET ?? '').trim();
	const appUrl = normaliseApiBaseUrl(env.SHOPIFY_APP_URL ?? (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : ''));

	if (!clientId) {
		throw new Error('Missing required environment variable: SHOPIFY_APP_CLIENT_ID');
	}

	if (!clientSecret) {
		throw new Error('Missing required environment variable: SHOPIFY_APP_CLIENT_SECRET');
	}

	if (!appUrl) {
		throw new Error('Missing required environment variable: SHOPIFY_APP_URL');
	}

	return {
		clientId,
		clientSecret,
		appUrl,
		scopes: env.SHOPIFY_SCOPES?.trim() || DEFAULT_SCOPES,
		sessionSecret: readRequiredEnv('SHOPIFY_LIQUIDATOR_SESSION_SECRET', env),
		authSessionTtlSeconds: Number.parseInt(env.SHOPIFY_LIQUIDATOR_AUTH_TTL_SECONDS ?? '', 10) || DEFAULT_AUTH_SESSION_TTL_SECONDS,
		cliTokenTtlSeconds: Number.parseInt(env.SHOPIFY_LIQUIDATOR_CLI_TOKEN_TTL_SECONDS ?? '', 10) || DEFAULT_CLI_TOKEN_TTL_SECONDS
	};
}
