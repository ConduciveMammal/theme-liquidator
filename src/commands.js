import {extractShopHandle} from './config.js';
import {
	clearGlobalCredentials,
	clearBrokerApiBaseUrl,
	createEmptyAuthConfig,
	readAuthConfig,
	removeShopProfile,
	saveBrokerApiBaseUrl,
	saveGlobalCredentials,
	saveShopProfile,
	setDefaultShop,
	writeAuthConfig
} from './auth-store.js';
import {getMissingRequiredScopes, ShopifyAuthError} from './client-credentials.js';
import {
	deleteAppClientSecret,
	deleteClientSecret,
	deleteShopAccessToken,
	getAppClientSecret,
	getClientSecret,
	getShopAccessToken,
	setAppClientSecret,
	setShopAccessToken
} from './secret-store.js';
import {getRedirectUri, runOAuthBrowserFlow, ShopifyOAuthError} from './oauth.js';
import {requestGraphQL, ShopifyApiError} from './shopify.js';
import {
	completeBrokeredAuth,
	getBrokerApiBaseUrl,
	revokeBrokerSession,
	validateBrokerSession
} from './broker-client.js';

const AUTH_PROBE_QUERY = `query AuthProbe {
  themes(first: 1) {
    nodes {
      id
    }
  }
}`;

function formatDetails(error) {
	return error.details?.length ? `\n${error.details.join('\n')}` : '';
}

function formatScopeSummary(scopeValue) {
	return scopeValue || 'No scopes returned';
}

function getMissingAppCredentialsMessage() {
	return 'Missing Shopify app credentials. Set `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` so `theme-liquidate` can open the Shopify login window.';
}

function getMissingBrokerConfigurationMessage() {
	return 'Missing hosted broker configuration. Set `SHOPIFY_LIQUIDATOR_API_BASE_URL` to use your Vercel-hosted Shopify app.';
}

function isBrokerProfile(profile) {
	return profile?.tokenType === 'broker_session' || profile?.authMethod === 'brokered';
}

async function migrateLegacyAppSecret(authConfig, env = process.env, shop = '') {
	const candidateShops = [
		shop,
		authConfig.defaultShop,
		...Object.keys(authConfig.shops)
	].filter(Boolean);
	const storedClientId = authConfig.credentials.clientId;

	for (const candidateShop of new Set(candidateShops)) {
		const legacySecret = await getClientSecret(candidateShop);

		if (!legacySecret) {
			continue;
		}

		const clientId = storedClientId || authConfig.shops[candidateShop]?.clientId || '';

		if (!clientId) {
			continue;
		}

		await saveGlobalCredentials(clientId, env);
		await setAppClientSecret(legacySecret);
		return {
			clientId,
			clientSecret: legacySecret
		};
	}

	return null;
}

async function ensureAppCredentials(authConfig, env = process.env, shop = '') {
	const envClientId = (env.SHOPIFY_CLIENT_ID ?? '').trim();
	const envClientSecret = (env.SHOPIFY_CLIENT_SECRET ?? '').trim();

	if ((envClientId && !envClientSecret) || (!envClientId && envClientSecret)) {
		throw new Error('Set both `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET`, or neither.');
	}

	if (envClientId && envClientSecret) {
		if (authConfig.credentials.clientId !== envClientId) {
			await saveGlobalCredentials(envClientId, env);
		}

		await setAppClientSecret(envClientSecret);
		return {
			clientId: envClientId,
			clientSecret: envClientSecret
		};
	}

	const storedClientId = authConfig.credentials.clientId;
	const storedClientSecret = await getAppClientSecret();

	if (storedClientId && storedClientSecret) {
		return {
			clientId: storedClientId,
			clientSecret: storedClientSecret
		};
	}

	const migrated = await migrateLegacyAppSecret(authConfig, env, shop);

	if (migrated) {
		return migrated;
	}

	throw new Error(getMissingAppCredentialsMessage());
}

async function validateStoredToken(shop, accessToken, env = process.env) {
	await requestGraphQL(
		{
			shop,
			token: accessToken
		},
		AUTH_PROBE_QUERY,
		{},
		'themes'
	);

	await saveShopProfile(
		shop,
		{
			lastValidatedAt: new Date().toISOString()
		},
		env
	);
}

async function validateStoredBrokerToken(shop, apiBaseUrl, sessionToken, env = process.env) {
	const response = await validateBrokerSession({
		apiBaseUrl,
		token: sessionToken
	});

	if (response.shop && response.shop !== shop) {
		throw new ShopifyApiError('The hosted broker returned a session for a different shop.', {
			operation: 'broker_session',
			details: [`Expected ${shop}, received ${response.shop}.`]
		});
	}

	await saveShopProfile(
		shop,
		{
			lastValidatedAt: new Date().toISOString(),
			scope: response.scope ?? ''
		},
		env
	);

	return response;
}

async function authenticateShop(shop, authConfig, env = process.env) {
	const {clientId, clientSecret} = await ensureAppCredentials(authConfig, env, shop);
	process.stdout.write(`Opening Shopify login for ${shop}...\n`);

	const token = await runOAuthBrowserFlow({
		shop,
		clientId,
		clientSecret
	});
	const missingScopes = getMissingRequiredScopes(token.scope);

	if (missingScopes.length > 0) {
		throw new Error(`The approved app is missing required scopes for this CLI: ${missingScopes.join(', ')}.`);
	}

	await validateStoredToken(shop, token.accessToken, env);
	await setShopAccessToken(shop, token.accessToken);

	const timestamp = new Date().toISOString();
	const configAfterSave = await saveShopProfile(
		shop,
		{
			scope: token.scope,
			authMethod: 'authorization_code',
			authenticatedAt: timestamp,
			lastValidatedAt: timestamp
		},
		env
	);

	if (!configAfterSave.defaultShop) {
		await setDefaultShop(shop, env);
	}

	return {
		shop,
		accessToken: token.accessToken,
		scope: token.scope
	};
}

async function authenticateShopViaBroker(shop, authConfig, env = process.env) {
	const apiBaseUrl = getBrokerApiBaseUrl(env, authConfig, authConfig.shops[shop]);

	if (!apiBaseUrl) {
		throw new Error(getMissingBrokerConfigurationMessage());
	}

	if (authConfig.credentials.apiBaseUrl !== apiBaseUrl) {
		await saveBrokerApiBaseUrl(apiBaseUrl, env);
	}

	process.stdout.write(`Opening hosted Shopify login for ${shop}...\n`);
	const completedAuth = await completeBrokeredAuth({
		apiBaseUrl,
		shop
	});
	const timestamp = new Date().toISOString();
	const configAfterSave = await saveShopProfile(
		completedAuth.shop ?? shop,
		{
			scope: completedAuth.scope ?? '',
			authMethod: 'brokered',
			tokenType: 'broker_session',
			authenticatedAt: timestamp,
			lastValidatedAt: timestamp,
			apiBaseUrl
		},
		env
	);

	await setShopAccessToken(completedAuth.shop ?? shop, completedAuth.cliToken);

	if (!configAfterSave.defaultShop) {
		await setDefaultShop(completedAuth.shop ?? shop, env);
	}

	return {
		shop: completedAuth.shop ?? shop,
		sessionToken: completedAuth.cliToken,
		scope: completedAuth.scope ?? '',
		apiBaseUrl
	};
}

function shouldReauthenticate(error) {
	return error instanceof ShopifyApiError && [401, 403].includes(error.status);
}

export async function resolveRunConfig(command, env = process.env) {
	const authConfig = await readAuthConfig(env);
	const shop = command.shop || authConfig.defaultShop;

	if (!shop) {
		throw new Error('No shop was selected. Run `theme-liquidate --shop <store>` to open the Shopify login flow.');
	}

	const shopProfile = authConfig.shops[shop];
	const brokerApiBaseUrl = getBrokerApiBaseUrl(env, authConfig, shopProfile);
	const brokerMode = Boolean(brokerApiBaseUrl);
	const storedAccessToken = await getShopAccessToken(shop);

	if (storedAccessToken) {
		try {
			if (brokerMode) {
				const validatedSession = await validateStoredBrokerToken(shop, brokerApiBaseUrl, storedAccessToken, env);
				return {
					shop,
					shopHandle: command.shopHandle || extractShopHandle(shop),
					token: storedAccessToken,
					dry: command.dry,
					verbose: command.verbose,
					authMode: 'broker',
					apiBaseUrl: brokerApiBaseUrl,
					scope: validatedSession.scope ?? shopProfile?.scope ?? ''
				};
			}

			await validateStoredToken(shop, storedAccessToken, env);
			return {
				shop,
				shopHandle: command.shopHandle || extractShopHandle(shop),
				token: storedAccessToken,
				dry: command.dry,
				verbose: command.verbose,
				authMode: 'direct'
			};
		} catch (error) {
			if (!shouldReauthenticate(error)) {
				throw error;
			}

			process.stdout.write(`Stored authentication for ${shop} is no longer valid. Opening Shopify login again...\n`);
		}
	}

	if (brokerMode) {
		const authenticatedShop = await authenticateShopViaBroker(shop, authConfig, env);
		return {
			shop: authenticatedShop.shop,
			shopHandle: command.shopHandle || extractShopHandle(authenticatedShop.shop),
			token: authenticatedShop.sessionToken,
			dry: command.dry,
			verbose: command.verbose,
			authMode: 'broker',
			apiBaseUrl: authenticatedShop.apiBaseUrl,
			scope: authenticatedShop.scope
		};
	}

	const authenticatedShop = await authenticateShop(shop, authConfig, env);

	return {
		shop: authenticatedShop.shop,
		shopHandle: command.shopHandle || extractShopHandle(authenticatedShop.shop),
		token: authenticatedShop.accessToken,
		dry: command.dry,
		verbose: command.verbose,
		authMode: 'direct',
		scope: authenticatedShop.scope
	};
}

export async function executeAuthCommand(command, env = process.env) {
	if (command.type === 'auth-list') {
		const authConfig = await readAuthConfig(env);
		const brokerApiBaseUrl = getBrokerApiBaseUrl(env, authConfig);

		if (brokerApiBaseUrl) {
			process.stdout.write(`Hosted broker: ${brokerApiBaseUrl}\n`);
		} else {
			const appSecret = await getAppClientSecret();
			const loginStatus = authConfig.credentials.clientId && appSecret ? 'configured' : 'missing';
			process.stdout.write(`App login: ${loginStatus}\n`);
			process.stdout.write(`OAuth redirect URI: ${getRedirectUri(env)}\n`);
		}

		const shops = Object.entries(authConfig.shops);

		if (shops.length === 0) {
			process.stdout.write('No authenticated shops have been stored yet.\n');
			return 0;
		}

		for (const [shop, profile] of shops) {
			const defaultMarker = authConfig.defaultShop === shop ? '* ' : '  ';
			const method = profile.authMethod ? `  auth=${profile.authMethod}` : '';
			process.stdout.write(`${defaultMarker}${shop}  scopes=${formatScopeSummary(profile.scope)}${method}\n`);
		}

		return 0;
	}

	if (command.type === 'auth-use') {
		await setDefaultShop(command.shop, env);
		process.stdout.write(`Default shop set to ${command.shop}.\n`);
		return 0;
	}

	if (command.type === 'auth-remove') {
		const authConfig = await readAuthConfig(env);
		const profile = authConfig.shops[command.shop];
		const brokerApiBaseUrl = getBrokerApiBaseUrl(env, authConfig, profile);
		const storedToken = await getShopAccessToken(command.shop);

		if (storedToken && brokerApiBaseUrl && isBrokerProfile(profile)) {
			try {
				await revokeBrokerSession({
					apiBaseUrl: brokerApiBaseUrl,
					token: storedToken
				});
			} catch (error) {
				if (!shouldReauthenticate(error)) {
					throw error;
				}
			}
		}

		const updatedConfig = await removeShopProfile(command.shop, env);
		await deleteShopAccessToken(command.shop);
		await deleteClientSecret(command.shop);
		process.stdout.write(`Removed stored authentication for ${command.shop}.\n`);

		if (updatedConfig.defaultShop) {
			process.stdout.write(`Current default shop: ${updatedConfig.defaultShop}\n`);
		}

		return 0;
	}

	if (command.type === 'auth-login') {
		const authConfig = await readAuthConfig(env);
		const shop = command.shop || authConfig.defaultShop;

		if (!shop) {
			throw new Error('No shop was selected. Run `theme-liquidate auth login --shop <store>` to open the Shopify login flow.');
		}

		const brokerApiBaseUrl = getBrokerApiBaseUrl(env, authConfig, authConfig.shops[shop]);

		if (brokerApiBaseUrl) {
			const authenticatedShop = await authenticateShopViaBroker(shop, authConfig, env);
			process.stdout.write(`Authenticated ${authenticatedShop.shop} via hosted broker.\n`);
			process.stdout.write(`Scopes: ${formatScopeSummary(authenticatedShop.scope)}\n`);
			return 0;
		}

		const authenticatedShop = await authenticateShop(shop, authConfig, env);
		process.stdout.write(`Authenticated ${authenticatedShop.shop}.\n`);
		process.stdout.write(`Scopes: ${formatScopeSummary(authenticatedShop.scope)}\n`);
		return 0;
	}

	if (command.type === 'auth-logout') {
		const authConfig = await readAuthConfig(env);
		const brokerApiBaseUrl = getBrokerApiBaseUrl(env, authConfig);

		for (const shop of Object.keys(authConfig.shops)) {
			const profile = authConfig.shops[shop];
			const storedToken = await getShopAccessToken(shop);

			if (storedToken && brokerApiBaseUrl && isBrokerProfile(profile)) {
				try {
					await revokeBrokerSession({
						apiBaseUrl: brokerApiBaseUrl,
						token: storedToken
					});
				} catch (error) {
					if (!shouldReauthenticate(error)) {
						throw error;
					}
				}
			}

			await deleteShopAccessToken(shop);
			await deleteClientSecret(shop);
		}

		await deleteAppClientSecret();
		await clearBrokerApiBaseUrl(env);
		await clearGlobalCredentials(env);
		await writeAuthConfig(createEmptyAuthConfig(), env);
		process.stdout.write('Removed stored Shopify login data.\n');
		return 0;
	}

	throw new Error(`Unsupported command type: ${command.type}`);
}

export function formatTopLevelError(error) {
	if (
		error instanceof ShopifyAuthError
		|| error instanceof ShopifyOAuthError
		|| error instanceof ShopifyApiError
	) {
		return `${error.message}${formatDetails(error)}`;
	}

	if (error.details?.length) {
		return `${error.message}${formatDetails(error)}`;
	}

	return error.message;
}
