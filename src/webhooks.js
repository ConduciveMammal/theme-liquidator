import crypto from 'node:crypto';

function getHeaderValue(headers, name) {
	const lowerCaseName = name.toLowerCase();
	const headerValue = headers?.[lowerCaseName] ?? headers?.[name];

	if (Array.isArray(headerValue)) {
		return headerValue[0] ?? '';
	}

	return typeof headerValue === 'string' ? headerValue : '';
}

export function getWebhookTopic(headers) {
	return getHeaderValue(headers, 'x-shopify-topic');
}

export function getWebhookHmac(headers) {
	return getHeaderValue(headers, 'x-shopify-hmac-sha256');
}

export function computeWebhookHmac(rawBody, clientSecret) {
	return crypto.createHmac('sha256', clientSecret).update(rawBody).digest('base64');
}

export function verifyWebhookHmac(rawBody, headers, clientSecret) {
	const providedHmac = getWebhookHmac(headers);

	if (!providedHmac) {
		return false;
	}

	const computedHmac = computeWebhookHmac(rawBody, clientSecret);
	const providedBuffer = Buffer.from(providedHmac, 'base64');
	const computedBuffer = Buffer.from(computedHmac, 'base64');

	if (providedBuffer.length === 0 || providedBuffer.length !== computedBuffer.length) {
		return false;
	}

	return crypto.timingSafeEqual(computedBuffer, providedBuffer);
}
