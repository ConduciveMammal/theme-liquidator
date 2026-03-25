import {readFile} from 'node:fs/promises';

export function sendJson(response, statusCode, payload) {
	response.statusCode = statusCode;
	response.setHeader('Content-Type', 'application/json; charset=utf-8');
	response.end(JSON.stringify(payload));
}

export async function readRawBody(request) {
	if (Buffer.isBuffer(request.body)) {
		return request.body;
	}

	if (typeof request.body === 'string') {
		return Buffer.from(request.body, 'utf8');
	}

	const chunks = [];

	for await (const chunk of request) {
		chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
	}

	return Buffer.concat(chunks);
}

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

const statusPageTemplatePromise = readFile(
	new URL('../_templates/status-page.html', import.meta.url),
	'utf8'
);

function getStatusTone(statusCode, title) {
	const normalisedTitle = String(title).toLowerCase();

	if (statusCode >= 200 && statusCode < 300) {
		return 'success';
	}

	if (statusCode >= 500) {
		return 'critical';
	}

	if (normalisedTitle.includes('hmac')) {
		return 'critical';
	}

	return 'warning';
}

export async function sendHtml(response, statusCode, title, message) {
	const safeTitle = escapeHtml(title);
	const safeMessage = escapeHtml(message);
	const tone = getStatusTone(statusCode, title);
	const template = await statusPageTemplatePromise;
	const html = template
		.replaceAll('{{TITLE}}', safeTitle)
		.replace('{{TONE}}', tone)
		.replace('{{MESSAGE}}', safeMessage);

	response.statusCode = statusCode;
	response.setHeader('Content-Type', 'text/html; charset=utf-8');
	response.end(html);
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
	if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
		return request.body;
	}

	const rawBody = await readRawBody(request);

	if (rawBody.length === 0) {
		return {};
	}

	return JSON.parse(rawBody.toString('utf8'));
}
