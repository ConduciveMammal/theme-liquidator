<img width="1780" height="1186" alt="CleanShot 2026-03-20 at 11  00 28" src="https://github.com/user-attachments/assets/af826a9d-5516-4e88-b596-b6e95a9271f7" />


Interactive terminal UI for reviewing Shopify themes, shortlisting the ones you want to remove, and deleting them with an explicit confirmation step.

`shopify-liquidator` is built for operators who want something safer than ad-hoc API scripts. It opens a browser-based Shopify install flow when needed, stores reusable login details locally, hides protected themes from the selection list, supports dry runs, and then processes deletions sequentially so failures are easy to understand.

For public release, the recommended setup is now a hosted broker on Vercel. In that mode, your Shopify app credentials and exemption stay on your server, merchants authorise your app in the browser, and the CLI only stores a broker session token locally.

> [!IMPORTANT]
> Real theme deletion still depends on Shopify granting your app protected theme modification access. Without that exemption, authentication and theme discovery work, dry runs work, but the live `themeDelete` mutation will be rejected by Shopify.

## Features

- Hosted broker mode for public distribution through your own Shopify app
- Browser-based Shopify install flow for merchant authorisation
- Reusable broker session tokens or offline access tokens stored locally per shop
- Interactive checklist UI built for terminal use
- Shop input normalisation for store handles, `.myshopify.com` domains, and `admin.shopify.com/store/...` URLs
- Automatic protection for live (`MAIN`) and still-processing themes
- Dry-run mode for previewing the shortlist before live deletion
- Sequential deletion with per-theme success and failure reporting
- Multi-shop auth management, including default shop selection
- Verbose completion mode for inspecting returned theme objects

## Requirements

- Node.js `20+`
- A supported desktop credential store:
  - macOS Keychain
  - Windows Credential Manager
  - Linux Secret Service keyring such as GNOME Keyring or KWallet
- A Shopify app with:
  - `read_themes`
  - `write_themes`
- For public release, a hosted broker deployment such as Vercel
- For production broker mode, persistent storage for broker state and shop tokens:
  - Vercel KV is recommended
  - local file storage is only intended for local development

If you use hosted broker mode, set a stable app URL in Vercel and add this callback URL to your Shopify app:

```text
https://your-app.example.com/api/shopify/callback
```

If you use the older direct local OAuth mode, the CLI expects this callback URL:

```text
http://127.0.0.1:3457/oauth/callback
```

The default requested scopes are:

```text
read_themes,write_themes
```

> [!WARNING]
> `write_themes` alone is not enough for live deletion. Shopify currently protects `themeDelete`, so your app also needs the separate theme modification exemption. The CLI links to Shopify's exemption request form when this restriction is hit.

## Install

Install dependencies and build the CLI:

```bash
npm install
npm run build
```

Run it from the built output:

```bash
npm start -- --shop your-store
```

Or install it globally from the project directory:

```bash
npm install -g .
```

After a global install, the command is:

```bash
theme-liquidate
```

## Quick Start

### Recommended: Hosted Broker On Vercel

1. Deploy this repo to Vercel.

2. Set these Vercel environment variables:

```bash
SHOPIFY_APP_URL="https://your-app.example.com"
SHOPIFY_APP_CLIENT_ID="your-client-id"
SHOPIFY_APP_CLIENT_SECRET="your-client-secret"
SHOPIFY_LIQUIDATOR_SESSION_SECRET="generate-a-long-random-string"
SHOPIFY_SCOPES="read_themes,write_themes"
KV_REST_API_URL="..."
KV_REST_API_TOKEN="..."
```

3. Add the hosted callback URL to your Shopify app configuration:

```text
https://your-app.example.com/api/shopify/callback
```

4. Run the CLI against your hosted broker:

```bash
export SHOPIFY_LIQUIDATOR_API_BASE_URL="https://your-app.example.com"
theme-liquidate --shop your-store --dry
```

5. On first use, the CLI:

- opens your hosted Shopify install flow in the browser
- waits for the merchant to authorise your app
- stores a broker session token locally
- uses your Vercel backend for theme listing and deletion

### Legacy: Direct Local OAuth

1. Export your Shopify app credentials:

```bash
export SHOPIFY_CLIENT_ID="your-client-id"
export SHOPIFY_CLIENT_SECRET="your-client-secret"
```

2. Start with a dry run against a shop:

```bash
theme-liquidate --shop your-store --dry
```

3. On first use, the CLI:

- normalises the shop identifier
- opens the Shopify login window in your browser
- completes the OAuth callback on `127.0.0.1`
- validates the returned token against the Admin API
- stores the offline token for later runs

4. Review the deletable themes in the terminal UI.

5. If the dry run looks right, rerun without `--dry` to perform the real deletion.

## Command Reference

### Run The Deletion UI

```bash
theme-liquidate [--shop <store>] [--dry] [--verbose]
```

Examples:

```bash
theme-liquidate --shop your-store
theme-liquidate --shop your-store.myshopify.com --dry
theme-liquidate --shop https://admin.shopify.com/store/your-store
theme-liquidate --verbose
```

Options:

- `--shop`: Store handle, `.myshopify.com` domain, or Shopify admin store URL
- `--dry`: Simulate deletions without sending the delete mutation
- `--verbose`: Show full theme objects in the completion view
- `--help`, `-h`: Show usage text

If `--shop` is omitted, the CLI uses the current default authenticated shop.

### Manage Authentication

Open the browser login flow without entering the deletion UI:

```bash
theme-liquidate auth login --shop your-store
```

Inspect stored auth state:

```bash
theme-liquidate auth list
```

Set the default shop:

```bash
theme-liquidate auth use --shop your-store
```

Remove one stored shop:

```bash
theme-liquidate auth remove --shop your-store
```

Clear all stored login data:

```bash
theme-liquidate auth logout
```

## Interactive Workflow

The terminal UI is designed to slow destructive work down just enough to avoid mistakes:

- The opening list only shows themes that are eligible for deletion
- Live themes and still-processing themes are excluded from the list entirely
- `↑` / `↓` or `j` / `k` move through themes
- `Space` toggles selection
- `Enter` advances from selection to review
- `Backspace` returns to the previous step during review and confirmation
- You must type `DELETE` exactly before a dry run or live delete can start
- Dry-run results can immediately transition into a real delete with `D`
- After a run, `M` reloads the list so you can select more themes

Deletion is processed sequentially. If Shopify rejects theme deletion at the app level because the exemption is missing, the CLI stops immediately and marks remaining themes as skipped.

## Environment Variables

Hosted broker mode:

- `SHOPIFY_LIQUIDATOR_API_BASE_URL`

Direct local OAuth mode only:

- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`

Shared CLI overrides:

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_SCOPES`
- `SHOPIFY_LIQUIDATOR_CONFIG_DIR`

Direct local OAuth overrides:

- `SHOPIFY_OAUTH_REDIRECT_URI`

If hosted broker mode is configured, the CLI stores the broker base URL in its config and a per-shop broker session token in the native OS credential store.
If direct local OAuth mode is used, the CLI stores the client ID in its config, the client secret in the native OS credential store, and a per-shop offline token in the native OS credential store.
If secure storage is unavailable, the CLI will ask you to enable an OS credential store instead of writing secrets into the JSON config file.

### Vercel Environment Variables

Recommended for public release:

- `SHOPIFY_APP_URL`
- `SHOPIFY_APP_CLIENT_ID`
- `SHOPIFY_APP_CLIENT_SECRET`
- `SHOPIFY_LIQUIDATOR_SESSION_SECRET`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

Optional:

- `SHOPIFY_SCOPES`
- `SHOPIFY_LIQUIDATOR_AUTH_TTL_SECONDS`
- `SHOPIFY_LIQUIDATOR_CLI_TOKEN_TTL_SECONDS`
- `SHOPIFY_LIQUIDATOR_BROKER_STORE_PATH`

If `KV_REST_API_URL` and `KV_REST_API_TOKEN` are not set, the broker falls back to a local file in `/tmp`, which is useful for local development but not suitable for production on Vercel.

## Storage Model

`shopify-liquidator` stores data in two places:

- Config file:
  - macOS default: `~/Library/Application Support/shopify-liquidator/config.json`
  - Windows default: `%APPDATA%\shopify-liquidator\config.json`
  - Linux default: `${XDG_CONFIG_HOME:-~/.config}/shopify-liquidator/config.json`
  - override: `SHOPIFY_LIQUIDATOR_CONFIG_DIR`
- Native OS credential store:
  - per-shop broker session tokens in hosted mode
  - shared app client secret in direct local OAuth mode
  - per-shop offline access tokens in direct local OAuth mode

The config file tracks the default shop, the hosted broker base URL, and saved shop metadata such as scopes and validation timestamps. Secrets are not written to the JSON config file.

In hosted broker mode, Vercel stores:

- pending browser auth sessions
- per-shop Shopify offline tokens
- issued CLI session tokens

## Shopify-Specific Caveat

The CLI supports live deletion, but Shopify may still block it for your app. When that happens, you will typically see a failure indicating that theme modification access is protected.

In hosted broker mode, that exemption remains tied to your Shopify app, not to each CLI user. Merchants install and authorise your app, and your backend performs the protected `themeDelete` calls on behalf of the CLI.

Shopify exemption form:

[Theme modification exemption request](https://docs.google.com/forms/d/e/1FAIpQLSfZTB1vxFC5d1-GPdqYunWRGUoDcOheHQzfK2RoEFEHrknt5g/viewform)

This means the current tool is useful in two modes:

- fully operational deletion tool for a hosted app that already has the exemption
- safe review and dry-run workflow for teams preparing to use deletion once access is granted

## Development

Useful scripts:

```bash
npm run build
npm test
```

The published CLI entry point is:

```text
dist/cli.js
```

## Credits

Primary packages used in this project:

- [Ink](https://github.com/vadimdemedes/ink) for the interactive terminal UI
- [React](https://react.dev/) for component-driven state and rendering
- [esbuild](https://esbuild.github.io/) for producing the distributable CLI bundle
