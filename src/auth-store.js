import {mkdir, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const APP_NAME = 'shopify-liquidator';
const CONFIG_FILENAME = 'config.json';

export function getBaseConfigDir(env = process.env, platform = process.platform) {
	if (env.SHOPIFY_LIQUIDATOR_CONFIG_DIR) {
		return env.SHOPIFY_LIQUIDATOR_CONFIG_DIR;
	}

	if (platform === 'darwin') {
		return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
	}

	if (platform === 'win32') {
		const appDataDir = env.APPDATA || env.LOCALAPPDATA;

		if (appDataDir) {
			return path.join(appDataDir, APP_NAME);
		}
	}

	if (env.XDG_CONFIG_HOME) {
		return path.join(env.XDG_CONFIG_HOME, APP_NAME);
	}

	return path.join(os.homedir(), '.config', APP_NAME);
}

export function getAuthConfigPath(env = process.env) {
	return path.join(getBaseConfigDir(env), CONFIG_FILENAME);
}

export function createEmptyAuthConfig() {
	return {
		version: 3,
		credentials: {
			clientId: '',
			apiBaseUrl: ''
		},
		defaultShop: '',
		shops: {}
	};
}

export async function readAuthConfig(env = process.env) {
	const configPath = getAuthConfigPath(env);

	try {
		const rawConfig = await readFile(configPath, 'utf8');
		const parsed = JSON.parse(rawConfig);
		const shops = parsed.shops ?? {};
		const migratedClientId = parsed.credentials?.clientId
			?? Object.values(shops).find((profile) => profile?.clientId)?.clientId
			?? '';

		return {
			version: parsed.version ?? 3,
			credentials: {
				clientId: migratedClientId,
				apiBaseUrl: parsed.credentials?.apiBaseUrl ?? ''
			},
			defaultShop: parsed.defaultShop ?? '',
			shops
		};
	} catch (error) {
		if (error.code === 'ENOENT') {
			return createEmptyAuthConfig();
		}

		throw error;
	}
}

export async function writeAuthConfig(config, env = process.env) {
	const configPath = getAuthConfigPath(env);
	await mkdir(path.dirname(configPath), {recursive: true});
	await writeFile(configPath, JSON.stringify(config, null, 2));
}

export async function saveGlobalCredentials(clientId, env = process.env) {
	const config = await readAuthConfig(env);
	config.credentials.clientId = clientId;
	await writeAuthConfig(config, env);
	return config;
}

export async function clearGlobalCredentials(env = process.env) {
	const config = await readAuthConfig(env);
	config.credentials.clientId = '';
	await writeAuthConfig(config, env);
	return config;
}

export async function saveBrokerApiBaseUrl(apiBaseUrl, env = process.env) {
	const config = await readAuthConfig(env);
	config.credentials.apiBaseUrl = apiBaseUrl;
	await writeAuthConfig(config, env);
	return config;
}

export async function clearBrokerApiBaseUrl(env = process.env) {
	const config = await readAuthConfig(env);
	config.credentials.apiBaseUrl = '';
	await writeAuthConfig(config, env);
	return config;
}

export async function saveShopProfile(shop, profile, env = process.env) {
	const config = await readAuthConfig(env);

	config.shops[shop] = {
		...config.shops[shop],
		...profile
	};

	if (!config.defaultShop) {
		config.defaultShop = shop;
	}

	await writeAuthConfig(config, env);
	return config;
}

export async function removeShopProfile(shop, env = process.env) {
	const config = await readAuthConfig(env);
	delete config.shops[shop];

	if (config.defaultShop === shop) {
		config.defaultShop = Object.keys(config.shops)[0] ?? '';
	}

	await writeAuthConfig(config, env);
	return config;
}

export async function setDefaultShop(shop, env = process.env) {
	const config = await readAuthConfig(env);

	if (!config.shops[shop]) {
		throw new Error(`No stored authentication was found for ${shop}.`);
	}

	config.defaultShop = shop;
	await writeAuthConfig(config, env);
	return config;
}
