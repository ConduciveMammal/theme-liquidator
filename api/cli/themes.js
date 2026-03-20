import {fetchAllThemes} from '../../src/shopify.js';
import {sendJson, sendMethodNotAllowed} from '../_lib/http.js';
import {requireCliSession} from '../_lib/require-cli-session.js';

export default async function handler(request, response) {
	if (request.method !== 'GET') {
		sendMethodNotAllowed(response, ['GET']);
		return;
	}

	const session = await requireCliSession(request, response);

	if (!session) {
		return;
	}

	try {
		const themes = await fetchAllThemes({
			shop: session.shopRecord.shop,
			token: session.shopRecord.accessToken
		});

		sendJson(response, 200, {
			shop: session.shopRecord.shop,
			themes
		});
	} catch (error) {
		sendJson(response, error.status || 500, {
			error: error.message,
			code: error.code ?? '',
			details: error.details ?? []
		});
	}
}
