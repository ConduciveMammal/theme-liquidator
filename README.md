# `shopify-liquidator`

Interactive CLI for listing Shopify store themes, selecting multiple themes with a checklist UI, and deleting the selected themes after an explicit danger confirmation.

This CLI uses Shopify's authorisation code grant for non-embedded apps. On the first run for a shop, it opens the Shopify login window in your browser, stores an offline Admin API token locally, and reuses that token on later runs.

## Requirements

- Node.js `20+`
- macOS, because secure secret storage currently uses macOS Keychain
- Shopify app credentials with `read_themes` and `write_themes`
- Shopify exemption for theme modification access
- A Shopify app redirect URL that matches the CLI callback address. By default the CLI uses `http://127.0.0.1:3457/oauth/callback`.

## Install

Install globally from the package directory while developing:

```bash
npm install
npm run build
npm install -g .
```

If the package is published, install it globally with:

```bash
npm install -g shopify-liquidator
```

## First Run

Start with the normal command:

```bash
theme-liquidate --shop your-store
```

If the selected shop is not authenticated yet, the CLI opens the Shopify login window, waits for the OAuth callback locally, stores the offline token in macOS Keychain, and then continues straight into the theme flow.

Accepted `--shop` formats:

- `your-store`
- `your-store.myshopify.com`
- `https://admin.shopify.com/store/your-store`

Required app credential environment variables on the first setup:

- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`

Optional OAuth environment variables:

- `SHOPIFY_OAUTH_REDIRECT_URI`
- `SHOPIFY_SCOPES`

If `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` are present, the CLI stores them for later runs. After that, you normally only need:

```bash
theme-liquidate --shop your-store
```

## Manage Login And Shops

Open the Shopify login window without immediately opening the theme UI:

```bash
theme-liquidate auth login --shop your-store
```

Inspect and manage stored shops:

```bash
theme-liquidate auth list
theme-liquidate auth use --shop your-store
theme-liquidate auth remove --shop your-store
theme-liquidate auth logout
```

## Run The CLI

Use the default authenticated shop:

```bash
theme-liquidate
```

Or target a specific authenticated shop:

```bash
theme-liquidate --shop your-store --api-version 2026-01
```

Runtime environment variable equivalents:

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_API_VERSION`
- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`
- `SHOPIFY_OAUTH_REDIRECT_URI`

## Behaviour

- Fetches every theme from the store via Shopify Admin GraphQL
- Shows an interactive checklist
- Prevents selection of the live `MAIN` theme and any theme still processing
- Requires a review step and an exact `DELETE` confirmation before mutations begin
- Deletes selected themes sequentially and prints a final summary
- Reopens the Shopify login window automatically if a stored shop token is no longer valid
