export function sendJson(response, statusCode, payload) {
	response.statusCode = statusCode;
	response.setHeader('Content-Type', 'application/json; charset=utf-8');
	response.end(JSON.stringify(payload));
}

export function sendHtml(response, statusCode, title, message) {
	response.statusCode = statusCode;
	response.setHeader('Content-Type', 'text/html; charset=utf-8');
	response.end(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${message}</p></body></html>`);
}

export function sendMethodNotAllowed(response, allowedMethods) {
	response.setHeader('Allow', allowedMethods.join(', '));
	sendJson(response, 405, {
		error: 'Method not allowed.'
	});
}

export function getBearerToken(request) {
	const authHeader = request.headers.authorization ?? '';
	const [scheme, token] = authHeader.split(/\s+/, 2);

	if (scheme?.toLowerCase() !== 'bearer' || !token) {
		return '';
	}

	return token;
}

export async function readJsonBody(request) {
	if (request.body && typeof request.body === 'object') {
		return request.body;
	}

	const chunks = [];

	for await (const chunk of request) {
		chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
	}

	if (chunks.length === 0) {
		return {};
	}

	return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
