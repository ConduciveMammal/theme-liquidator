import {sendJson, sendMethodNotAllowed} from '../../_lib/http.js';
import {getStorage} from '../../_lib/storage.js';
import {getAuthSession} from '../../_lib/broker-state.js';

export default async function handler(request, response) {
	if (request.method !== 'GET') {
		sendMethodNotAllowed(response, ['GET']);
		return;
	}

	const sessionId = `${request.query.session ?? ''}`.trim();

	if (!sessionId) {
		sendJson(response, 400, {
			error: 'Missing auth session identifier.'
		});
		return;
	}

	const storage = getStorage();
	const session = await getAuthSession(storage, sessionId);

	if (!session) {
		sendJson(response, 404, {
			status: 'failed',
			error: 'The hosted auth session was not found or has expired.'
		});
		return;
	}

	sendJson(response, 200, session);
}
