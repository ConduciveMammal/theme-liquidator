import {
	deleteThemesSequentially,
	fetchAllThemes
} from './shopify.js';
import {
	deleteThemesSequentiallyViaBroker,
	fetchAllThemesViaBroker
} from './broker-client.js';

export async function fetchThemesForConfig(config, fetchImpl = globalThis.fetch) {
	if (config.authMode === 'broker') {
		return fetchAllThemesViaBroker({
			apiBaseUrl: config.apiBaseUrl,
			token: config.token
		}, fetchImpl);
	}

	return fetchAllThemes(config, fetchImpl);
}

export async function deleteThemesForConfig(config, themes, onProgress, fetchImpl = globalThis.fetch, options = {}) {
	if (config.authMode === 'broker') {
		return deleteThemesSequentiallyViaBroker(config, themes, onProgress, fetchImpl, options);
	}

	return deleteThemesSequentially(config, themes, onProgress, fetchImpl, options);
}
