# `shopify-liquidator`

Interactive terminal UI for reviewing Shopify themes, shortlisting the ones you want to remove, and deleting them with an explicit confirmation step.

`shopify-liquidator` is built for operators who want something safer than ad-hoc API scripts. It opens a browser-based Shopify OAuth flow when needed, stores reusable login details locally, hides protected themes from the selection list, supports dry runs, and then processes deletions sequentially so failures are easy to understand.

> [!IMPORTANT]
> Real theme deletion still depends on Shopify granting your app protected theme modification access. Without that exemption, authentication and theme discovery work, dry runs work, but the live `themeDelete` mutation will be rejected by Shopify.

## Features

- Browser-based OAuth login for Shopify Admin API access
- Reusable offline access tokens stored locally per shop
- Interactive checklist UI built for terminal use
- Shop input normalisation for store handles, `.myshopify.com` domains, and `admin.shopify.com/store/...` URLs
- Automatic protection for live (`MAIN`) and still-processing themes
- Dry-run mode for previewing the shortlist before live deletion
- Sequential deletion with per-theme success and failure reporting
- Multi-shop auth management, including default shop selection
- Verbose completion mode for inspecting returned theme objects

## Requirements

- Node.js `20+`
- macOS for secure secret storage via Keychain
- A Shopify app with:
  - `read_themes`
  - `write_themes`
- A Shopify app redirect URL that matches the CLI callback address

By default, the CLI expects this OAuth callback URL:

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

Required for first-time authentication unless already stored:

- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`

Optional runtime overrides:

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_OAUTH_REDIRECT_URI`
- `SHOPIFY_SCOPES`
- `SHOPIFY_LIQUIDATOR_CONFIG_DIR`

If both `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` are provided, the CLI stores the client ID in its config and the client secret in Keychain so later runs do not need the credentials exported again.

## Storage Model

`shopify-liquidator` stores data in two places:

- Config file:
  - macOS default: `~/Library/Application Support/shopify-liquidator/config.json`
  - override: `SHOPIFY_LIQUIDATOR_CONFIG_DIR`
- macOS Keychain:
  - shared app client secret
  - per-shop offline access tokens

The config file tracks the default shop and saved shop metadata such as scopes and validation timestamps. Secrets are not written to the JSON config file.

## Shopify-Specific Caveat

The CLI supports live deletion, but Shopify may still block it for your app. When that happens, you will typically see a failure indicating that theme modification access is protected.

Shopify exemption form:

[Theme modification exemption request](https://docs.google.com/forms/d/e/1FAIpQLSfZTB1vxFC5d1-GPdqYunWRGUoDcOheHQzfK2RoEFEHrknt5g/viewform)

This means the current tool is useful in two modes:

- fully operational deletion tool for apps that already have the exemption
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
