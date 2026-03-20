import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

const LOCAL_STORE_PATH = '/tmp/shopify-liquidator-broker-store.json';

async function readLocalStore(env = process.env) {
	const storePath = env.SHOPIFY_LIQUIDATOR_BROKER_STORE_PATH || LOCAL_STORE_PATH;

	try {
		const rawStore = await readFile(storePath, 'utf8');
		return JSON.parse(rawStore);
	} catch (error) {
		if (error.code === 'ENOENT') {
			return {};
		}

		throw error;
	}
}

async function writeLocalStore(store, env = process.env) {
	const storePath = env.SHOPIFY_LIQUIDATOR_BROKER_STORE_PATH || LOCAL_STORE_PATH;
	await mkdir(path.dirname(storePath), {recursive: true});
	await writeFile(storePath, JSON.stringify(store, null, 2));
}

function createLocalStorage(env = process.env) {
	return {
		async getJson(key) {
			const store = await readLocalStore(env);
			const entry = store[key];

			if (!entry) {
				return null;
			}

			if (entry.expiresAt && Date.now() > entry.expiresAt) {
				delete store[key];
				await writeLocalStore(store, env);
				return null;
			}

			return entry.value;
		},
		async setJson(key, value, ttlSeconds = 0) {
			const store = await readLocalStore(env);
			store[key] = {
				value,
				expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0
			};
			await writeLocalStore(store, env);
		},
		async deleteKey(key) {
			const store = await readLocalStore(env);
			delete store[key];
			await writeLocalStore(store, env);
		}
	};
}

function createKvStorage(env = process.env) {
	const apiUrl = env.KV_REST_API_URL?.trim();
	const apiToken = env.KV_REST_API_TOKEN?.trim();

	if (!apiUrl || !apiToken) {
		return null;
	}

	async function command(args) {
		const response = await fetch(apiUrl, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(args)
		});
		const payload = await response.json().catch(() => null);

		if (!response.ok) {
			throw new Error(payload?.error || `KV request failed with HTTP ${response.status}.`);
		}

		return payload?.result ?? null;
	}

	return {
		async getJson(key) {
			const result = await command(['GET', key]);

			if (typeof result !== 'string') {
				return result;
			}

			return JSON.parse(result);
		},
		async setJson(key, value, ttlSeconds = 0) {
			const args = ['SET', key, JSON.stringify(value)];

			if (ttlSeconds > 0) {
				args.push('EX', String(ttlSeconds));
			}

			await command(args);
		},
		async deleteKey(key) {
			await command(['DEL', key]);
		}
	};
}

let storageInstance;

export function getStorage(env = process.env) {
	if (!storageInstance) {
		storageInstance = createKvStorage(env) ?? createLocalStorage(env);
	}

	return storageInstance;
}
