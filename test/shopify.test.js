import test from 'node:test';
import assert from 'node:assert/strict';
import {deleteTheme, deleteThemesSequentially, fetchAllThemes, requestGraphQL, ShopifyApiError} from '../src/shopify.js';

const clientConfig = {
	shop: 'example-store.myshopify.com',
	token: 'shpat_test',
	apiVersion: '2026-01'
};

function createJsonResponse(status, body) {
	return {
		ok: status >= 200 && status < 300,
		status,
		async json() {
			return body;
		}
	};
}

test('fetchAllThemes loads every page of themes', async () => {
	const calls = [];
	const fetchImpl = async (_url, options) => {
		calls.push(JSON.parse(options.body));

		if (calls.length === 1) {
			return createJsonResponse(200, {
				data: {
					themes: {
						nodes: [
							{id: 'gid://shopify/OnlineStoreTheme/1', name: 'Alpha', role: 'UNPUBLISHED', processing: false, updatedAt: '2026-01-01T00:00:00Z'}
						],
						pageInfo: {
							hasNextPage: true,
							endCursor: 'cursor-1'
						}
					}
				}
			});
		}

		return createJsonResponse(200, {
			data: {
				themes: {
					nodes: [
						{id: 'gid://shopify/OnlineStoreTheme/2', name: 'Beta', role: 'DEVELOPMENT', processing: false, updatedAt: '2026-01-02T00:00:00Z'}
					],
					pageInfo: {
						hasNextPage: false,
						endCursor: null
					}
				}
			}
		});
	};

	const themes = await fetchAllThemes(clientConfig, fetchImpl);

	assert.equal(themes.length, 2);
	assert.equal(calls[1].variables.after, 'cursor-1');
});

test('deleteThemesSequentially continues after a per-theme user error', async () => {
	const fetchImpl = async (_url, options) => {
		const body = JSON.parse(options.body);

		if (body.query.includes('query ThemeList')) {
			return createJsonResponse(500, {});
		}

		if (body.variables.id.endsWith('/1')) {
			return createJsonResponse(200, {
				data: {
					themeDelete: {
						deletedThemeId: 'gid://shopify/OnlineStoreTheme/1',
						userErrors: []
					}
				}
			});
		}

		return createJsonResponse(200, {
			data: {
				themeDelete: {
					deletedThemeId: null,
					userErrors: [
						{
							code: 'ACCESS_DENIED',
							field: ['id'],
							message: 'Theme cannot be deleted.'
						}
					]
				}
			}
		});
	};

	const themes = [
		{id: 'gid://shopify/OnlineStoreTheme/1', name: 'Alpha', role: 'UNPUBLISHED'},
		{id: 'gid://shopify/OnlineStoreTheme/2', name: 'Beta', role: 'UNPUBLISHED'}
	];

	const results = await deleteThemesSequentially(clientConfig, themes, null, fetchImpl);

	assert.deepEqual(
		results.map((result) => ({name: result.name, status: result.status})),
		[
			{name: 'Alpha', status: 'deleted'},
			{name: 'Beta', status: 'failed'}
		]
	);
	assert.match(results[1].error, /Theme cannot be deleted/);
});

test('deleteTheme dry run simulates a delete without calling Shopify', async () => {
	let fetchCallCount = 0;
	const fetchImpl = async () => {
		fetchCallCount += 1;
		return createJsonResponse(500, {});
	};

	const theme = {
		id: 'gid://shopify/OnlineStoreTheme/5',
		name: 'Gamma',
		role: 'UNPUBLISHED',
		processing: false,
		updatedAt: '2026-01-05T00:00:00Z'
	};

	const result = await deleteTheme(clientConfig, theme, fetchImpl, {dryRun: true});

	assert.equal(fetchCallCount, 0);
	assert.equal(result.status, 'simulated');
	assert.equal(result.id, theme.id);
	assert.equal(result.name, 'Gamma');
	assert.deepEqual(result.theme, theme);
});

test('requestGraphQL surfaces auth and scope guidance on HTTP errors', async () => {
	const fetchImpl = async () => createJsonResponse(403, {
		errors: [
			{message: 'Access denied'}
		]
	});

	await assert.rejects(
		() => requestGraphQL(clientConfig, 'query { shop { id } }', {}, 'themes', fetchImpl),
		(error) => {
			assert.equal(error instanceof ShopifyApiError, true);
			assert.match(error.message, /read_themes/);
			return true;
		}
	);
});

test('requestGraphQL handles non-array Shopify error payloads', async () => {
	const fetchImpl = async () => createJsonResponse(401, {
		errors: {
			message: 'Invalid API key or access token.'
		}
	});

	await assert.rejects(
		() => requestGraphQL(clientConfig, 'query { shop { id } }', {}, 'themes', fetchImpl),
		(error) => {
			assert.equal(error instanceof ShopifyApiError, true);
			assert.match(error.message, /read_themes/);
			assert.deepEqual(error.details, ['Invalid API key or access token.']);
			return true;
		}
	);
});

test('requestGraphQL condenses Shopify theme deletion exemption errors', async () => {
	const fetchImpl = async () => createJsonResponse(200, {
		errors: [
			{
				message: 'Access denied for themeDelete field. Required access: The user needs write_themes and an exemption from Shopify to modify themes.'
			}
		]
	});

	await assert.rejects(
		() => requestGraphQL(clientConfig, 'mutation { themeDelete(id: "gid://shopify/OnlineStoreTheme/1") { deletedThemeId } }', {}, 'themeDelete', fetchImpl),
		(error) => {
			assert.equal(error instanceof ShopifyApiError, true);
			assert.equal(error.code, 'theme_delete_permission_denied');
			assert.match(error.message, /Shopify denied theme deletion for this app/);
			assert.match(error.details[0], /Theme modification exemption required/);
			return true;
		}
	);
});

test('deleteThemesSequentially stops after an app-level theme deletion permission denial', async () => {
	let deleteCallCount = 0;
	const fetchImpl = async () => {
		deleteCallCount += 1;
		return createJsonResponse(200, {
			errors: [
				{
					message: 'Access denied for themeDelete field. Required access: The user needs write_themes and an exemption from Shopify to modify themes.'
				}
			]
		});
	};

	const themes = [
		{id: 'gid://shopify/OnlineStoreTheme/1', name: 'Alpha', role: 'UNPUBLISHED'},
		{id: 'gid://shopify/OnlineStoreTheme/2', name: 'Beta', role: 'UNPUBLISHED'}
	];

	const results = await deleteThemesSequentially(clientConfig, themes, null, fetchImpl);

	assert.equal(deleteCallCount, 1);
	assert.equal(results.length, 2);
	assert.equal(results[0].status, 'failed');
	assert.equal(results[0].fatal, true);
	assert.match(results[0].error, /Shopify denied theme deletion for this app/);
	assert.equal(results[1].status, 'failed');
	assert.equal(results[1].fatal, true);
	assert.match(results[1].error, /Skipped\. Theme deletion is blocked for this app/);
});
