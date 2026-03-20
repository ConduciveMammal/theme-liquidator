import {parseArgs} from 'node:util';

export const DEFAULT_API_VERSION = '2026-01';

export const HELP_TEXT = `
Usage:
  theme-liquidate [--shop <store-handle|store.myshopify.com|https://admin.shopify.com/store/store-handle>] [--dry] [--verbose]
  theme-liquidate auth login [--shop <store>]
  theme-liquidate auth list
  theme-liquidate auth use --shop <store>
  theme-liquidate auth remove --shop <store>
  theme-liquidate auth logout

Run command:
  Fetches themes for the selected shop and opens the interactive deletion UI.
  If SHOPIFY_LIQUIDATOR_API_BASE_URL is set, the CLI opens your hosted Shopify
  install flow and stores a broker session token locally. Otherwise it falls back
  to the local OAuth flow and stores an offline Admin API token locally.
  If --shop is omitted, the default authenticated shop is used.
  Direct local OAuth requires Shopify app credentials through stored login data
  or the SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET environment variables.

Auth options:
  --shop            Shopify store identifier, for example "example-store", "example-store.myshopify.com", or "https://admin.shopify.com/store/example-store"
  --dry             Simulate theme deletion without sending the Shopify delete mutation
  --verbose         Show the full theme object in the completion view
  --help, -h        Show this help message

Environment variables:
  SHOPIFY_STORE_DOMAIN
  SHOPIFY_LIQUIDATOR_API_BASE_URL
  SHOPIFY_CLIENT_ID
  SHOPIFY_CLIENT_SECRET
  SHOPIFY_OAUTH_REDIRECT_URI
  SHOPIFY_SCOPES
`.trim();

export function normaliseApiBaseUrl(value) {
	if (!value) {
		return '';
	}

	const trimmedValue = value.trim();

	try {
		const url = new URL(trimmedValue);

		if (!['http:', 'https:'].includes(url.protocol)) {
			return '';
		}

		url.hash = '';
		url.search = '';
		url.pathname = url.pathname.replace(/\/$/, '');
		return url.toString().replace(/\/$/, '');
	} catch {
		return '';
	}
}

export function normaliseShopDomain(value) {
	if (!value) {
		return '';
	}

	const trimmedValue = value.trim().toLowerCase();
	const withoutProtocol = trimmedValue.replace(/^https?:\/\//, '');
	const withoutQueryOrHash = withoutProtocol.split(/[?#]/, 1)[0];
	const withoutTrailingSlash = withoutQueryOrHash.replace(/\/$/, '');
	const adminUrlMatch = withoutTrailingSlash.match(/^admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)$/);

	if (adminUrlMatch) {
		return `${adminUrlMatch[1]}.myshopify.com`;
	}

	if (/^[a-z0-9][a-z0-9-]*$/.test(withoutTrailingSlash)) {
		return `${withoutTrailingSlash}.myshopify.com`;
	}

	return withoutTrailingSlash;
}

export function isValidShopDomain(value) {
	return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(value);
}

export function extractShopHandle(value) {
	const shopDomain = normaliseShopDomain(value);

	if (!shopDomain) {
		return '';
	}

	return shopDomain.replace(/\.myshopify\.com$/, '');
}

function invalidShopResult(shop) {
	return {
		ok: false,
		exitCode: 1,
		message: `Invalid shop identifier "${shop}". Use a store handle, a .myshopify.com domain, or an admin.shopify.com/store/... URL.`
	};
}

function getParsedValues(argv) {
	try {
		return parseArgs({
			args: argv,
			options: {
				shop: {
					type: 'string'
				},
				dry: {
					type: 'boolean'
				},
				verbose: {
					type: 'boolean'
				},
				help: {
					type: 'boolean',
					short: 'h'
				}
			},
			allowPositionals: true,
			strict: true
		});
	} catch (error) {
		return {
			error
		};
	}
}

function parseAuthCommand(positionals, values, env) {
	const action = positionals[1];

	if (!action || positionals.length > 2) {
		return {
			ok: false,
			exitCode: 1,
			message: `Invalid auth command.\n\n${HELP_TEXT}`
		};
	}

	if (action === 'list') {
		return {
			ok: true,
			command: {
				type: 'auth-list'
			}
		};
	}

	if (action === 'login') {
		const shop = normaliseShopDomain(values.shop ?? env.SHOPIFY_STORE_DOMAIN ?? '');

		if (shop && !isValidShopDomain(shop)) {
			return invalidShopResult(shop);
		}

		return {
			ok: true,
			command: {
				type: 'auth-login',
				shop
			}
		};
	}

	if (action === 'logout') {
		return {
			ok: true,
			command: {
				type: 'auth-logout'
			}
		};
	}

	if (!['use', 'remove'].includes(action)) {
		return {
			ok: false,
			exitCode: 1,
			message: `Unknown auth command "${action}".\n\n${HELP_TEXT}`
		};
	}

	const shop = normaliseShopDomain(values.shop ?? env.SHOPIFY_STORE_DOMAIN ?? '');

	if (!shop) {
		return {
			ok: false,
			exitCode: 1,
			message: `Missing required shop identifier.\n\n${HELP_TEXT}`
		};
	}

	if (!isValidShopDomain(shop)) {
		return invalidShopResult(shop);
	}

	if (action === 'use') {
		return {
			ok: true,
			command: {
				type: 'auth-use',
				shop
			}
		};
	}

	if (action === 'remove') {
		return {
			ok: true,
			command: {
				type: 'auth-remove',
				shop
			}
		};
	}

	return {
		ok: false,
		exitCode: 1,
		message: `Unknown auth command "${action}".\n\n${HELP_TEXT}`
	};
}

export function parseCliConfig(argv = process.argv.slice(2), env = process.env) {
	const parsed = getParsedValues(argv);

	if (parsed.error) {
		return {
			ok: false,
			exitCode: 1,
			message: `${parsed.error.message}\n\n${HELP_TEXT}`
		};
	}

	const {values, positionals} = parsed;

	if (values.help) {
		return {
			ok: false,
			exitCode: 0,
			message: HELP_TEXT
		};
	}

	if (positionals[0] === 'auth') {
		return parseAuthCommand(positionals, values, env);
	}

	if (positionals.length > 0) {
		return {
			ok: false,
			exitCode: 1,
			message: `Unknown command "${positionals.join(' ')}".\n\n${HELP_TEXT}`
		};
	}

	const shop = normaliseShopDomain(values.shop ?? env.SHOPIFY_STORE_DOMAIN ?? '');

	if (shop && !isValidShopDomain(shop)) {
		return invalidShopResult(shop);
	}

	return {
		ok: true,
		command: {
			type: 'run',
			shop,
			shopHandle: extractShopHandle(shop),
			dry: values.dry ?? false,
			verbose: values.verbose ?? false
		}
	};
}
