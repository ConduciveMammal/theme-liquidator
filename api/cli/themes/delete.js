import {deleteTheme} from '../../../src/shopify.js';
import {sendJson, sendMethodNotAllowed, readJsonBody} from '../../_lib/http.js';
import {requireCliSession} from '../../_lib/require-cli-session.js';

export default async function handler(request, response) {
	if (request.method !== 'POST') {
		sendMethodNotAllowed(response, ['POST']);
		return;
	}

	const session = await requireCliSession(request, response);

	if (!session) {
		return;
	}

	try {
		const body = await readJsonBody(request);
		const theme = body.theme;

		if (!theme?.id || !theme?.name) {
			sendJson(response, 400, {
				error: 'Missing theme payload.'
			});
			return;
		}

		const result = await deleteTheme({
			shop: session.shopRecord.shop,
			token: session.shopRecord.accessToken
		}, theme, globalThis.fetch, {
			dryRun: body.dryRun === true
		});

		sendJson(response, 200, {
			result
		});
	} catch (error) {
		sendJson(response, error.status || 500, {
			error: error.message,
			code: error.code ?? '',
			details: error.details ?? []
		});
	}
}
