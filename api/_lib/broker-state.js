import crypto from 'node:crypto';
import {createOpaqueToken, hashToken} from './tokens.js';

function authSessionKey(sessionId) {
	return `auth-session:${sessionId}`;
}

function shopTokenKey(shop) {
	return `shop:${shop}`;
}

function cliTokenKey(tokenHash) {
	return `cli-token:${tokenHash}`;
}

export function createSessionId() {
	return crypto.randomBytes(18).toString('base64url');
}

export function createStateToken() {
	return crypto.randomBytes(18).toString('base64url');
}

export async function createPendingAuthSession(storage, {sessionId, shop, state}, ttlSeconds) {
	await storage.setJson(authSessionKey(sessionId), {
		sessionId,
		shop,
		state,
		status: 'pending',
		createdAt: new Date().toISOString()
	}, ttlSeconds);
}

export async function getAuthSession(storage, sessionId) {
	return storage.getJson(authSessionKey(sessionId));
}

export async function failAuthSession(storage, sessionId, error, details = []) {
	const currentSession = await getAuthSession(storage, sessionId);

	if (!currentSession) {
		return;
	}

	await storage.setJson(authSessionKey(sessionId), {
		...currentSession,
		status: 'failed',
		error,
		details,
		completedAt: new Date().toISOString()
	}, 10 * 60);
}

export async function completeAuthSession(storage, sessionId, payload) {
	const currentSession = await getAuthSession(storage, sessionId);

	if (!currentSession) {
		return;
	}

	await storage.setJson(authSessionKey(sessionId), {
		...currentSession,
		status: 'complete',
		...payload,
		completedAt: new Date().toISOString()
	}, 10 * 60);
}

export async function saveShopToken(storage, shop, payload) {
	await storage.setJson(shopTokenKey(shop), {
		shop,
		...payload,
		updatedAt: new Date().toISOString()
	});
}

export async function getShopToken(storage, shop) {
	return storage.getJson(shopTokenKey(shop));
}

export async function issueCliToken(storage, {shop, tokenTtlSeconds, sessionSecret}) {
	const cliToken = createOpaqueToken();
	const tokenHash = hashToken(cliToken, sessionSecret);

	await storage.setJson(cliTokenKey(tokenHash), {
		shop,
		createdAt: new Date().toISOString()
	}, tokenTtlSeconds);

	return cliToken;
}

export async function getCliTokenRecord(storage, {token, sessionSecret}) {
	return storage.getJson(cliTokenKey(hashToken(token, sessionSecret)));
}

export async function revokeCliToken(storage, {token, sessionSecret}) {
	await storage.deleteKey(cliTokenKey(hashToken(token, sessionSecret)));
}
