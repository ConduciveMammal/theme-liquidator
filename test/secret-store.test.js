import test from 'node:test';
import assert from 'node:assert/strict';
import {
	createMacOsKeychainBackend,
	createKeytarBackend,
	deleteAppClientSecret,
	deleteClientSecret,
	deleteShopAccessToken,
	getAppClientSecret,
	getClientSecret,
	getShopAccessToken,
	setAppClientSecret,
	setClientSecret,
	setShopAccessToken
} from '../src/secret-store.js';

function createMemoryKeytar() {
	const secrets = new Map();

	return {
		async setPassword(service, account, value) {
			secrets.set(`${service}:${account}`, value);
		},
		async getPassword(service, account) {
			return secrets.get(`${service}:${account}`) ?? null;
		},
		async deletePassword(service, account) {
			secrets.delete(`${service}:${account}`);
			return true;
		}
	};
}

test('secret store writes and reads the shared app client secret', async () => {
	const backend = createKeytarBackend(createMemoryKeytar());

	await setAppClientSecret('client-secret', backend);

	assert.equal(await getAppClientSecret(backend), 'client-secret');

	await deleteAppClientSecret(backend);

	assert.equal(await getAppClientSecret(backend), '');
});

test('secret store keeps per-shop secrets isolated', async () => {
	const backend = createKeytarBackend(createMemoryKeytar());

	await setClientSecret('alpha.myshopify.com', 'legacy-secret', backend);
	await setShopAccessToken('alpha.myshopify.com', 'token-alpha', backend);
	await setShopAccessToken('beta.myshopify.com', 'token-beta', backend);

	assert.equal(await getClientSecret('alpha.myshopify.com', backend), 'legacy-secret');
	assert.equal(await getShopAccessToken('alpha.myshopify.com', backend), 'token-alpha');
	assert.equal(await getShopAccessToken('beta.myshopify.com', backend), 'token-beta');

	await deleteClientSecret('alpha.myshopify.com', backend);
	await deleteShopAccessToken('alpha.myshopify.com', backend);

	assert.equal(await getClientSecret('alpha.myshopify.com', backend), '');
	assert.equal(await getShopAccessToken('alpha.myshopify.com', backend), '');
	assert.equal(await getShopAccessToken('beta.myshopify.com', backend), 'token-beta');
});

test('macOS keychain backend maps secrets through the security CLI contract', async () => {
	const calls = [];
	const values = new Map();
	const backend = createMacOsKeychainBackend(async (file, args) => {
		calls.push([file, args]);
		const accountName = args[args.indexOf('-a') + 1];

		if (args[0] === 'add-generic-password') {
			values.set(accountName, args[args.length - 1]);
			return {stdout: ''};
		}

		if (args[0] === 'find-generic-password') {
			if (!values.has(accountName)) {
				const error = new Error('missing secret');
				error.code = 44;
				throw error;
			}

			return {stdout: `${values.get(accountName)}\n`};
		}

		if (args[0] === 'delete-generic-password') {
			if (!values.has(accountName)) {
				const error = new Error('missing secret');
				error.code = 44;
				throw error;
			}

			values.delete(accountName);
			return {stdout: ''};
		}

		throw new Error(`Unexpected command: ${args[0]}`);
	});

	await setAppClientSecret('client-secret', backend);
	assert.equal(await getAppClientSecret(backend), 'client-secret');
	await deleteAppClientSecret(backend);
	assert.equal(await getAppClientSecret(backend), '');

	assert.deepEqual(
		calls.map(([, args]) => args[0]),
		[
			'add-generic-password',
			'find-generic-password',
			'delete-generic-password',
			'find-generic-password'
		]
	);
});
