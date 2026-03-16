import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_API_VERSION, HELP_TEXT, isValidShopDomain, normaliseShopDomain, parseCliConfig} from '../src/config.js';

test('normaliseShopDomain strips protocol and trailing slash', () => {
	assert.equal(normaliseShopDomain('https://Example-Store.myshopify.com/'), 'example-store.myshopify.com');
});

test('normaliseShopDomain accepts supported shop identifier formats', () => {
	assert.equal(normaliseShopDomain('valid-store'), 'valid-store.myshopify.com');
	assert.equal(normaliseShopDomain('https://admin.shopify.com/store/valid-store'), 'valid-store.myshopify.com');
	assert.equal(isValidShopDomain('valid-store.myshopify.com'), true);
	assert.equal(isValidShopDomain('https://invalid.example.com'), false);
});

test('parseCliConfig defaults to run command', () => {
	const result = parseCliConfig([], {});

	assert.equal(result.ok, true);
	assert.deepEqual(result.command, {
		type: 'run',
		shop: '',
		apiVersion: DEFAULT_API_VERSION
	});
});

test('parseCliConfig normalises a bare store handle for the run command', () => {
	const result = parseCliConfig(['--shop', 'flag-store'], {});

	assert.equal(result.ok, true);
	assert.deepEqual(result.command, {
		type: 'run',
		shop: 'flag-store.myshopify.com',
		apiVersion: DEFAULT_API_VERSION
	});
});

test('parseCliConfig parses auth login command', () => {
	const result = parseCliConfig(
		['auth', 'login', '--shop', 'flag-store'],
		{}
	);

	assert.equal(result.ok, true);
	assert.deepEqual(result.command, {
		type: 'auth-login',
		shop: 'flag-store.myshopify.com'
	});
});

test('parseCliConfig parses auth list command', () => {
	const result = parseCliConfig(['auth', 'list'], {});

	assert.equal(result.ok, true);
	assert.deepEqual(result.command, {
		type: 'auth-list'
	});
});

test('parseCliConfig parses auth logout command', () => {
	const result = parseCliConfig(['auth', 'logout'], {});

	assert.equal(result.ok, true);
	assert.deepEqual(result.command, {
		type: 'auth-logout'
	});
});

test('parseCliConfig fails for invalid auth command', () => {
	const result = parseCliConfig(['auth', 'wat'], {});

	assert.equal(result.ok, false);
	assert.equal(result.exitCode, 1);
	assert.match(result.message, /Unknown auth command/);
});

test('parseCliConfig returns help text', () => {
	const result = parseCliConfig(['--help'], {});

	assert.equal(result.ok, false);
	assert.equal(result.exitCode, 0);
	assert.equal(result.message, HELP_TEXT);
});
