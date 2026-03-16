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

function ensureDarwinSupport() {
	if (process.platform !== 'darwin') {
		throw new Error('Secure credential storage currently supports macOS Keychain only.');
	}
}

async function setSecret(accountName, secret, execImpl = execFileAsync) {
	ensureDarwinSupport();
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
}

async function getSecret(accountName, execImpl = execFileAsync) {
	ensureDarwinSupport();

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
		if (error.code === 44) {
			return '';
		}

		throw error;
	}
}

async function deleteSecret(accountName, execImpl = execFileAsync) {
	ensureDarwinSupport();

	try {
		await execImpl('security', [
			'delete-generic-password',
			'-a',
			accountName,
			'-s',
			SERVICE_NAME
		]);
	} catch (error) {
		if (error.code !== 44) {
			throw error;
		}
	}
}

export async function setClientSecret(shop, secret, execImpl = execFileAsync) {
	return setSecret(getLegacyClientSecretAccountName(shop), secret, execImpl);
}

export async function getClientSecret(shop, execImpl = execFileAsync) {
	return getSecret(getLegacyClientSecretAccountName(shop), execImpl);
}

export async function deleteClientSecret(shop, execImpl = execFileAsync) {
	return deleteSecret(getLegacyClientSecretAccountName(shop), execImpl);
}

export async function setShopAccessToken(shop, token, execImpl = execFileAsync) {
	return setSecret(getShopAccessTokenAccountName(shop), token, execImpl);
}

export async function getShopAccessToken(shop, execImpl = execFileAsync) {
	return getSecret(getShopAccessTokenAccountName(shop), execImpl);
}

export async function deleteShopAccessToken(shop, execImpl = execFileAsync) {
	return deleteSecret(getShopAccessTokenAccountName(shop), execImpl);
}

export async function setAppClientSecret(secret, execImpl = execFileAsync) {
	return setSecret(GLOBAL_ACCOUNT_NAME, secret, execImpl);
}

export async function getAppClientSecret(execImpl = execFileAsync) {
	return getSecret(GLOBAL_ACCOUNT_NAME, execImpl);
}

export async function deleteAppClientSecret(execImpl = execFileAsync) {
	return deleteSecret(GLOBAL_ACCOUNT_NAME, execImpl);
}
