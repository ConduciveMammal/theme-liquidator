import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
	clearGlobalCredentials,
	createEmptyAuthConfig,
	getBaseConfigDir,
	readAuthConfig,
	removeShopProfile,
	saveBrokerApiBaseUrl,
	saveGlobalCredentials,
	saveShopProfile,
	setDefaultShop
} from '../src/auth-store.js';

async function createConfigEnv() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shopify-liquidator-test-'));
	return {
		dir,
		env: {
			SHOPIFY_LIQUIDATOR_CONFIG_DIR: dir
		}
	};
}

test('readAuthConfig returns an empty config when none exists', async () => {
	const {env} = await createConfigEnv();
	assert.deepEqual(await readAuthConfig(env), createEmptyAuthConfig());
});

test('getBaseConfigDir uses AppData on Windows', () => {
	assert.equal(
		getBaseConfigDir(
			{
				APPDATA: 'C:\\Users\\Liam\\AppData\\Roaming'
			},
			'win32'
		),
		path.join('C:\\Users\\Liam\\AppData\\Roaming', 'shopify-liquidator')
	);
});

test('saveGlobalCredentials stores the shared client ID', async () => {
	const {env} = await createConfigEnv();

	await saveGlobalCredentials('client-id', env);

	const config = await readAuthConfig(env);
	assert.equal(config.credentials.clientId, 'client-id');
});

test('clearGlobalCredentials removes the shared client ID', async () => {
	const {env} = await createConfigEnv();

	await saveGlobalCredentials('client-id', env);
	await clearGlobalCredentials(env);

	const config = await readAuthConfig(env);
	assert.equal(config.credentials.clientId, '');
});

test('saveBrokerApiBaseUrl stores the hosted broker URL', async () => {
	const {env} = await createConfigEnv();

	await saveBrokerApiBaseUrl('https://liquidator.example.com', env);

	const config = await readAuthConfig(env);
	assert.equal(config.credentials.apiBaseUrl, 'https://liquidator.example.com');
});

test('saveShopProfile stores profile data and default shop', async () => {
	const {env} = await createConfigEnv();

	await saveShopProfile(
		'alpha.myshopify.com',
		{
			scope: 'read_themes,write_themes'
		},
		env
	);

	const config = await readAuthConfig(env);
	assert.equal(config.defaultShop, 'alpha.myshopify.com');
	assert.equal(config.shops['alpha.myshopify.com'].scope, 'read_themes,write_themes');
});

test('setDefaultShop changes the default authenticated shop', async () => {
	const {env} = await createConfigEnv();

	await saveShopProfile('alpha.myshopify.com', {scope: 'one'}, env);
	await saveShopProfile('beta.myshopify.com', {scope: 'two'}, env);
	await setDefaultShop('beta.myshopify.com', env);

	const config = await readAuthConfig(env);
	assert.equal(config.defaultShop, 'beta.myshopify.com');
});

test('removeShopProfile removes the shop and clears default when needed', async () => {
	const {env} = await createConfigEnv();

	await saveShopProfile('alpha.myshopify.com', {scope: 'one'}, env);
	await saveShopProfile('beta.myshopify.com', {scope: 'two'}, env);
	await setDefaultShop('alpha.myshopify.com', env);
	await removeShopProfile('alpha.myshopify.com', env);

	const config = await readAuthConfig(env);
	assert.equal(Boolean(config.shops['alpha.myshopify.com']), false);
	assert.equal(config.defaultShop, 'beta.myshopify.com');
});
