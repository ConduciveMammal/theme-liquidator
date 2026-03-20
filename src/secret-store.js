import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const SERVICE_NAME = 'shopify-liquidator';
const GLOBAL_ACCOUNT_NAME = 'app::client-secret';

function getLegacyClientSecretAccountName(shop) {
	return `${shop}::client-secret`;
}

function getShopAccessTokenAccountName(shop) {
	return `${shop}::offline-token`;
}

function createSecretBackendUnavailableError(error) {
	const messageLines = [
		'Secure credential storage is unavailable on this machine.',
		'Install and enable a supported OS credential store, then try again.'
	];

	if (process.platform === 'linux') {
		messageLines.push('On Linux, this usually means a Secret Service keyring such as GNOME Keyring or KWallet is not available.');
	}

	return new Error(messageLines.join(' '), {cause: error});
}

function isMacOsSecretNotFoundError(error) {
	return error?.code === 44;
}

async function loadKeytar() {
	try {
		const keytarModule = await import('keytar');
		const keytar = keytarModule.default ?? keytarModule;

		if (
			typeof keytar?.setPassword !== 'function'
			|| typeof keytar?.getPassword !== 'function'
			|| typeof keytar?.deletePassword !== 'function'
		) {
			throw new TypeError('The loaded keytar module does not expose the expected credential methods.');
		}

		return keytar;
	} catch (error) {
		throw createSecretBackendUnavailableError(error);
	}
}

let defaultBackendPromise;

export function createKeytarBackend(keytar) {
	return {
		async setSecret(accountName, secret) {
			await keytar.setPassword(SERVICE_NAME, accountName, secret);
		},
		async getSecret(accountName) {
			return (await keytar.getPassword(SERVICE_NAME, accountName)) ?? '';
		},
		async deleteSecret(accountName) {
			await keytar.deletePassword(SERVICE_NAME, accountName);
		}
	};
}

export function createMacOsKeychainBackend(execImpl = execFileAsync) {
	return {
		async setSecret(accountName, secret) {
			await execImpl('security', [
				'add-generic-password',
				'-U',
				'-a',
				accountName,
				'-s',
				SERVICE_NAME,
				'-w',
				secret
			]);
		},
		async getSecret(accountName) {
			try {
				const {stdout} = await execImpl('security', [
					'find-generic-password',
					'-a',
					accountName,
					'-s',
					SERVICE_NAME,
					'-w'
				]);
				return stdout.trim();
			} catch (error) {
				if (isMacOsSecretNotFoundError(error)) {
					return '';
				}

				throw error;
			}
		},
		async deleteSecret(accountName) {
			try {
				await execImpl('security', [
					'delete-generic-password',
					'-a',
					accountName,
					'-s',
					SERVICE_NAME
				]);
			} catch (error) {
				if (!isMacOsSecretNotFoundError(error)) {
					throw error;
				}
			}
		}
	};
}

async function getDefaultBackend() {
	if (!defaultBackendPromise) {
		defaultBackendPromise = process.platform === 'darwin'
			? Promise.resolve(createMacOsKeychainBackend())
			: loadKeytar().then((keytar) => createKeytarBackend(keytar));
	}

	return defaultBackendPromise;
}

async function setSecret(accountName, secret, backend) {
	const activeBackend = backend ?? await getDefaultBackend();
	await activeBackend.setSecret(accountName, secret);
}

async function getSecret(accountName, backend) {
	const activeBackend = backend ?? await getDefaultBackend();
	return activeBackend.getSecret(accountName);
}

async function deleteSecret(accountName, backend) {
	const activeBackend = backend ?? await getDefaultBackend();
	await activeBackend.deleteSecret(accountName);
}

export async function setClientSecret(shop, secret, backend) {
	return setSecret(getLegacyClientSecretAccountName(shop), secret, backend);
}

export async function getClientSecret(shop, backend) {
	return getSecret(getLegacyClientSecretAccountName(shop), backend);
}

export async function deleteClientSecret(shop, backend) {
	return deleteSecret(getLegacyClientSecretAccountName(shop), backend);
}

export async function setShopAccessToken(shop, token, backend) {
	return setSecret(getShopAccessTokenAccountName(shop), token, backend);
}

export async function getShopAccessToken(shop, backend) {
	return getSecret(getShopAccessTokenAccountName(shop), backend);
}

export async function deleteShopAccessToken(shop, backend) {
	return deleteSecret(getShopAccessTokenAccountName(shop), backend);
}

export async function setAppClientSecret(secret, backend) {
	return setSecret(GLOBAL_ACCOUNT_NAME, secret, backend);
}

export async function getAppClientSecret(backend) {
	return getSecret(GLOBAL_ACCOUNT_NAME, backend);
}

export async function deleteAppClientSecret(backend) {
	return deleteSecret(GLOBAL_ACCOUNT_NAME, backend);
}
