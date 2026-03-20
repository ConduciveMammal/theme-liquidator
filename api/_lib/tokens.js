import crypto from 'node:crypto';

export function createOpaqueToken() {
	return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token, secret) {
	return crypto
		.createHmac('sha256', secret)
		.update(token)
		.digest('hex');
}
