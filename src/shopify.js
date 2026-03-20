import {DEFAULT_API_VERSION} from './config.js';

const THEME_LIST_QUERY = `query ThemeList($first: Int!, $after: String) {
  themes(first: $first, after: $after) {
    nodes {
      id
      name
      role
      processing
      updatedAt
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;

const THEME_DELETE_MUTATION = `mutation ThemeDelete($id: ID!) {
  themeDelete(id: $id) {
    deletedThemeId
    userErrors {
      code
      field
      message
    }
  }
}`;

export const THEME_DELETE_EXEMPTION_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfZTB1vxFC5d1-GPdqYunWRGUoDcOheHQzfK2RoEFEHrknt5g/viewform';

function buildThemeResult(theme, status, overrides = {}) {
	return {
		status,
		id: overrides.id ?? theme.id,
		name: theme.name,
		role: theme.role,
		theme,
		error: overrides.error ?? '',
		fatal: overrides.fatal ?? false
	};
}

export class ShopifyApiError extends Error {
	constructor(message, options = {}) {
		super(message);
		this.name = 'ShopifyApiError';
		this.operation = options.operation ?? 'request';
		this.status = options.status;
		this.code = options.code ?? '';
		this.hint = options.hint ?? '';
		this.details = options.details ?? [];
		this.themeName = options.themeName ?? '';
	}
}

function getScopeHint(operationName) {
	if (operationName === 'themes') {
		return 'Listing themes requires the `read_themes` scope.';
	}

	if (operationName === 'themeDelete') {
		return 'Deleting themes requires the `write_themes` scope and a Shopify exemption for theme modification access.';
	}

	return '';
}

function buildErrorMessage(operationName, message) {
	const scopeHint = getScopeHint(operationName);

	return scopeHint ? `${message} ${scopeHint}` : message;
}

function includesThemeDeletePermissionDenial(messages) {
	const combined = messages.join(' ').toLowerCase();

	return combined.includes('access denied for themedelete')
		|| (combined.includes('write_themes') && combined.includes('exemption from shopify to modify themes'))
		|| (combined.includes('modify themes') && combined.includes('submit an exception request'));
}

function createThemeDeletePermissionError(operationName) {
	return new ShopifyApiError('Shopify denied theme deletion for this app.', {
		operation: operationName,
		code: 'theme_delete_permission_denied',
		details: [
			'Theme modification exemption required.'
		]
	});
}

function normaliseErrorMessages(value) {
	if (!value) {
		return [];
	}

	if (Array.isArray(value)) {
		return value.flatMap((entry) => normaliseErrorMessages(entry));
	}

	if (typeof value === 'string') {
		return [value];
	}

	if (typeof value === 'object') {
		if (typeof value.message === 'string') {
			return [value.message];
		}

		return Object.values(value).flatMap((entry) => normaliseErrorMessages(entry));
	}

	return [String(value)];
}

function extractPayloadErrorMessages(payload, includeFallbackFields = false) {
	const errorMessages = normaliseErrorMessages(payload?.errors);

	if (errorMessages.length > 0) {
		return errorMessages;
	}

	if (!includeFallbackFields) {
		return [];
	}

	return [
		...normaliseErrorMessages(payload?.error),
		...normaliseErrorMessages(payload?.message)
	];
}

async function parseResponseJson(response) {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

export async function requestGraphQL(clientConfig, query, variables, operationName, fetchImpl = globalThis.fetch) {
	const apiVersion = clientConfig.apiVersion ?? DEFAULT_API_VERSION;
	const endpoint = `https://${clientConfig.shop}/admin/api/${apiVersion}/graphql.json`;
	let response;

	try {
		response = await fetchImpl(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Shopify-Access-Token': clientConfig.token
			},
			body: JSON.stringify({
				query,
				variables
			})
		});
	} catch (error) {
		throw new ShopifyApiError(
			buildErrorMessage(operationName, `Network error while calling Shopify for ${operationName}.`),
			{
				operation: operationName,
				details: [error.message]
			}
		);
	}

	const payload = await parseResponseJson(response);

	if (!response.ok) {
		const errorMessages = extractPayloadErrorMessages(payload, true);

		if (operationName === 'themeDelete' && includesThemeDeletePermissionDenial(errorMessages)) {
			throw createThemeDeletePermissionError(operationName);
		}

		const statusMessage = `Shopify returned HTTP ${response.status} for ${operationName}.`;
		throw new ShopifyApiError(buildErrorMessage(operationName, statusMessage), {
			operation: operationName,
			status: response.status,
			details: errorMessages
		});
	}

	const graphQLErrorMessages = extractPayloadErrorMessages(payload);

	if (graphQLErrorMessages.length > 0) {
		if (operationName === 'themeDelete' && includesThemeDeletePermissionDenial(graphQLErrorMessages)) {
			throw createThemeDeletePermissionError(operationName);
		}

		throw new ShopifyApiError(
			buildErrorMessage(operationName, `Shopify returned GraphQL errors for ${operationName}.`),
			{
				operation: operationName,
				details: graphQLErrorMessages
			}
		);
	}

	if (!payload?.data) {
		throw new ShopifyApiError(`Shopify returned an empty response for ${operationName}.`, {
			operation: operationName
		});
	}

	return payload.data;
}

export async function fetchAllThemes(clientConfig, fetchImpl = globalThis.fetch) {
	const themes = [];
	let cursor = null;
	let hasNextPage = true;

	while (hasNextPage) {
		const data = await requestGraphQL(
			clientConfig,
			THEME_LIST_QUERY,
			{
				first: 50,
				after: cursor
			},
			'themes',
			fetchImpl
		);

		themes.push(...data.themes.nodes);
		hasNextPage = data.themes.pageInfo.hasNextPage;
		cursor = data.themes.pageInfo.endCursor;
	}

	return themes;
}

export async function deleteTheme(clientConfig, theme, fetchImpl = globalThis.fetch, options = {}) {
	if (options.dryRun) {
		return buildThemeResult(theme, 'simulated');
	}

	const data = await requestGraphQL(
		clientConfig,
		THEME_DELETE_MUTATION,
		{
			id: theme.id
		},
		'themeDelete',
		fetchImpl
	);

	const payload = data.themeDelete;
	const userErrors = payload.userErrors ?? [];

	if (userErrors.length > 0) {
		return buildThemeResult(theme, 'failed', {
			error: userErrors.map((error) => error.message).join('; ')
		});
	}

	return buildThemeResult(theme, 'deleted', {
		id: payload.deletedThemeId ?? theme.id
	});
}

function formatDeleteFailure(error, themeName) {
	if (error instanceof ShopifyApiError) {
		return [error.message, ...error.details].filter(Boolean).join(' ');
	}

	return `Unexpected error while deleting ${themeName}.`;
}

export async function deleteThemesSequentially(clientConfig, themes, onProgress, fetchImpl = globalThis.fetch, options = {}) {
	const results = [];

	for (const [index, theme] of themes.entries()) {
		onProgress?.(theme.id, 'pending', '');

		try {
			const result = await deleteTheme(clientConfig, theme, fetchImpl, options);
			results.push(result);
			onProgress?.(theme.id, result.status, result.error);
		} catch (error) {
			const message = formatDeleteFailure(error, theme.name);
			const result = buildThemeResult(theme, 'failed', {
				error: message,
				fatal: error instanceof ShopifyApiError && error.code === 'theme_delete_permission_denied'
			});
			results.push(result);
			onProgress?.(theme.id, result.status, result.error);

			if (error instanceof ShopifyApiError && error.code === 'theme_delete_permission_denied') {
				for (const remainingTheme of themes.slice(index + 1)) {
					const remainingResult = buildThemeResult(remainingTheme, 'failed', {
						error: 'Skipped. Theme deletion is blocked for this app.',
						fatal: true
					});
					results.push(remainingResult);
					onProgress?.(remainingTheme.id, remainingResult.status, remainingResult.error);
				}

				break;
			}
		}
	}

	return results;
}
