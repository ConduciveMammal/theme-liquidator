<img width="1780" height="1186" alt="CleanShot 2026-03-20 at 11 00 28" src="https://github.com/user-attachments/assets/af826a9d-5516-4e88-b596-b6e95a9271f7" />

# Theme Liquidator

Interactive terminal UI for reviewing Shopify themes, shortlisting the ones you want to remove, and deleting them with an explicit confirmation step.

Theme Liquidator is built for users to delete Shopify themes en masse from a store. It opens a browser-based Shopify install flow when needed, stores reusable login details locally, hides protected themes from the selection list, supports dry runs, and processes deletions sequentially so failures are easier to understand.

To use the CLI, the store needs the companion Shopify app installed so the authentication flow can complete and the CLI can access the Theme API on that shop.

## Install with npm

### Requirements

- Node.js `24.x`
- A supported desktop credential store:
  - macOS Keychain
  - Windows Credential Manager
  - Linux Secret Service keyring such as GNOME Keyring or KWallet

Install the published CLI globally:

```bash
npm install -g @conducivemammal/theme-liquidator
```

After installation, use:

```bash
theme-liquidate
```

Check the available commands:

```bash
theme-liquidate --help
```

## Use it

### Quick start

For most users, the quickest path is:

```bash
theme-liquidate --shop <store> --dry
```

On first run, the CLI:

- normalises the shop identifier
- opens the browser-based Shopify install flow
- asks the merchant to install or authorise the companion app on the store
- stores the resulting login details locally for later runs

Start with a dry run so you can review the shortlist without deleting anything. If the result looks right, rerun without `--dry`:

```bash
theme-liquidate --shop <store>
```

### Common commands

Run the deletion UI:

```bash
theme-liquidate [--shop <store>] [--dry] [--verbose]
```

Examples:

```bash
theme-liquidate --shop <store>
theme-liquidate --shop <store>.myshopify.com --dry
theme-liquidate --shop https://admin.shopify.com/store/<store>
theme-liquidate --verbose
```

Options:

- `--shop`: Store handle, `.myshopify.com` domain, or Shopify admin store URL
- `--dry`: Simulate deletions without sending the delete mutation
- `--verbose`: Show full theme objects in the completion view
- `--help`, `-h`: Show usage text

If `--shop` is omitted, the CLI uses the current default authenticated shop.

### Manage authentication

Open the browser login flow without entering the deletion UI:

```bash
theme-liquidate auth login --shop <store>
```

Inspect stored auth state:

```bash
theme-liquidate auth list
```

Set the default shop:

```bash
theme-liquidate auth use --shop <store>
```

Remove one stored shop:

```bash
theme-liquidate auth remove --shop <store>
```

Clear all stored login data:

```bash
theme-liquidate auth logout
```

### Interactive workflow

The UI is designed to slow destructive work down just enough to avoid mistakes:

- The opening list only shows themes that are eligible for deletion
- Live themes and still-processing themes are excluded from the list entirely
- `↑` / `↓` or `j` / `k` move through themes
- `Space` toggles selection
- `Enter` advances from selection to review
- `Backspace` returns to the previous step during review and confirmation
- You must type `DELETE` exactly before a dry run or live delete can start
- Dry-run results can immediately transition into a real delete with `D`
- After a run, `M` reloads the list so you can select more themes

Deletion is processed sequentially. If Shopify rejects theme deletion because the exemption is missing, the CLI stops immediately and marks remaining themes as skipped.

### Environment variables

Direct local OAuth mode only:

- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`

Shared CLI overrides:

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_SCOPES`
- `SHOPIFY_LIQUIDATOR_CONFIG_DIR`

Direct local OAuth overrides:

- `SHOPIFY_OAUTH_REDIRECT_URI`

The CLI stores saved shop metadata in its config and keeps sensitive login details in the native OS credential store.

If secure storage is unavailable, the CLI asks you to enable an OS credential store instead of writing secrets into the JSON config file.

### Storage model

Theme Liquidator stores data in two places:

- Config file:
  - macOS default: `~/Library/Application Support/shopify-liquidator/config.json`
  - Windows default: `%APPDATA%\\shopify-liquidator\\config.json`
  - Linux default: `${XDG_CONFIG_HOME:-~/.config}/shopify-liquidator/config.json`
  - override: `SHOPIFY_LIQUIDATOR_CONFIG_DIR`
- Native OS credential store:
  - shared app client secret in direct local OAuth mode
  - per-shop login details in direct local OAuth mode

The config file tracks the default shop and saved shop metadata such as scopes and validation timestamps. Secrets are not written to the JSON config file.

The storage directory and credential service still use the legacy `shopify-liquidator` identifier so existing saved authentication continues to work after the package rename.

## Develop locally

> [!WARNING]
> Shopify currently protects live theme deletion behind separate Theme API access. `write_themes` on its own is not enough. Without Shopify granting the app the theme modification exemption, authentication, theme discovery, and dry runs still work, but the live `themeDelete` mutation will be blocked.

### Install dependencies

```bash
npm install
```

### Build and run

Build the CLI:

```bash
npm run build
```

Run the built CLI:

```bash
npm start -- --shop <store>
```

Run tests:

```bash
npm test
```

If you want the local checkout installed as a global command while developing:

```bash
npm install -g .
theme-liquidate --help
```

The published CLI entry point is:

```text
dist/cli.js
```

### Shopify app setup

For local development, create or use a Shopify app with:

- `read_themes`
- `write_themes`
- mandatory compliance webhooks for `customers/data_request`, `customers/redact`, and `shop/redact`

Export your Shopify app credentials:

```bash
export SHOPIFY_CLIENT_ID="your-client-id"
export SHOPIFY_CLIENT_SECRET="your-client-secret"
```

The local OAuth callback URL is:

```text
http://127.0.0.1:3457/oauth/callback
```

Default requested scopes:

```text
read_themes,write_themes
```

For App Store review, Shopify requires the compliance webhooks even if the app does not keep customer data. This repo now includes a root `shopify.app.toml` that subscribes those topics to `/api/webhooks`. After updating the app configuration, deploy that version through Shopify CLI so the subscriptions are attached to the released app version used for review.

### Publishing

Publish from the repo root:

```bash
npm login
npm pack --dry-run
npm publish
```

Because this package is scoped, `package.json` already sets public access through `publishConfig.access`.

For later releases:

```bash
npm version patch
npm publish
```

## Shopify caveat

The CLI supports live deletion, but Shopify may still block it for your app. When that happens, you will typically see a failure indicating that theme modification access is protected.

That access is tied to the Shopify app used for authentication. Installing the companion app lets the CLI authenticate against the store, but live deletion still depends on Shopify granting that app the separate theme modification exemption.

Shopify exemption form:

[Theme modification exemption request](https://docs.google.com/forms/d/e/1FAIpQLSfZTB1vxFC5d1-GPdqYunWRGUoDcOheHQzfK2RoEFEHrknt5g/viewform)

This means the tool is currently useful in two modes:

- fully operational deletion tool for a hosted app that already has the exemption
- safe review and dry-run workflow for teams preparing to use deletion once access is granted

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

## Credits

Primary packages used in this project:

- [Ink](https://github.com/vadimdemedes/ink) for the interactive terminal UI
- [React](https://react.dev/) for component-driven state and rendering
- [esbuild](https://esbuild.github.io/) for producing the distributable CLI bundle
