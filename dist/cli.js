#!/usr/bin/env node

// src/index.js
import React2 from "react";
import { render } from "ink";

// src/app.js
import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";

// src/exit-codes.js
var EXIT_SUCCESS = 0;
var EXIT_FAILURE = 1;
var EXIT_CANCELLED = 130;

// src/flow.js
var STAGE_LOADING = "loading";
var STAGE_SELECTION = "selection";
var STAGE_EMPTY = "empty";
var STAGE_REVIEW = "review";
var STAGE_CONFIRM = "confirm";
var STAGE_DELETING = "deleting";
var STAGE_RESULT = "result";
var STAGE_ERROR = "error";
function getStageAfterSelection(selectedIds) {
  return selectedIds.length === 0 ? STAGE_EMPTY : STAGE_REVIEW;
}
function isDeleteConfirmationValid(value) {
  return value === "DELETE";
}
function getResultExitCode(results) {
  return results.some((result) => result.status === "failed") ? EXIT_FAILURE : EXIT_SUCCESS;
}

// src/config.js
import { parseArgs } from "node:util";
var DEFAULT_API_VERSION = "2026-01";
var HELP_TEXT = `
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
function normaliseApiBaseUrl(value) {
  if (!value) {
    return "";
  }
  const trimmedValue = value.trim();
  try {
    const url = new URL(trimmedValue);
    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}
function normaliseShopDomain(value) {
  if (!value) {
    return "";
  }
  const trimmedValue = value.trim().toLowerCase();
  const withoutProtocol = trimmedValue.replace(/^https?:\/\//, "");
  const withoutQueryOrHash = withoutProtocol.split(/[?#]/, 1)[0];
  const withoutTrailingSlash = withoutQueryOrHash.replace(/\/$/, "");
  const adminUrlMatch = withoutTrailingSlash.match(/^admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)$/);
  if (adminUrlMatch) {
    return `${adminUrlMatch[1]}.myshopify.com`;
  }
  if (/^[a-z0-9][a-z0-9-]*$/.test(withoutTrailingSlash)) {
    return `${withoutTrailingSlash}.myshopify.com`;
  }
  return withoutTrailingSlash;
}
function isValidShopDomain(value) {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(value);
}
function extractShopHandle(value) {
  const shopDomain = normaliseShopDomain(value);
  if (!shopDomain) {
    return "";
  }
  return shopDomain.replace(/\.myshopify\.com$/, "");
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
          type: "string"
        },
        dry: {
          type: "boolean"
        },
        verbose: {
          type: "boolean"
        },
        help: {
          type: "boolean",
          short: "h"
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
      message: `Invalid auth command.

${HELP_TEXT}`
    };
  }
  if (action === "list") {
    return {
      ok: true,
      command: {
        type: "auth-list"
      }
    };
  }
  if (action === "login") {
    const shop2 = normaliseShopDomain(values.shop ?? env.SHOPIFY_STORE_DOMAIN ?? "");
    if (shop2 && !isValidShopDomain(shop2)) {
      return invalidShopResult(shop2);
    }
    return {
      ok: true,
      command: {
        type: "auth-login",
        shop: shop2
      }
    };
  }
  if (action === "logout") {
    return {
      ok: true,
      command: {
        type: "auth-logout"
      }
    };
  }
  if (!["use", "remove"].includes(action)) {
    return {
      ok: false,
      exitCode: 1,
      message: `Unknown auth command "${action}".

${HELP_TEXT}`
    };
  }
  const shop = normaliseShopDomain(values.shop ?? env.SHOPIFY_STORE_DOMAIN ?? "");
  if (!shop) {
    return {
      ok: false,
      exitCode: 1,
      message: `Missing required shop identifier.

${HELP_TEXT}`
    };
  }
  if (!isValidShopDomain(shop)) {
    return invalidShopResult(shop);
  }
  if (action === "use") {
    return {
      ok: true,
      command: {
        type: "auth-use",
        shop
      }
    };
  }
  if (action === "remove") {
    return {
      ok: true,
      command: {
        type: "auth-remove",
        shop
      }
    };
  }
  return {
    ok: false,
    exitCode: 1,
    message: `Unknown auth command "${action}".

${HELP_TEXT}`
  };
}
function parseCliConfig(argv = process.argv.slice(2), env = process.env) {
  const parsed = getParsedValues(argv);
  if (parsed.error) {
    return {
      ok: false,
      exitCode: 1,
      message: `${parsed.error.message}

${HELP_TEXT}`
    };
  }
  const { values, positionals } = parsed;
  if (values.help) {
    return {
      ok: false,
      exitCode: 0,
      message: HELP_TEXT
    };
  }
  if (positionals[0] === "auth") {
    return parseAuthCommand(positionals, values, env);
  }
  if (positionals.length > 0) {
    return {
      ok: false,
      exitCode: 1,
      message: `Unknown command "${positionals.join(" ")}".

${HELP_TEXT}`
    };
  }
  const shop = normaliseShopDomain(values.shop ?? env.SHOPIFY_STORE_DOMAIN ?? "");
  if (shop && !isValidShopDomain(shop)) {
    return invalidShopResult(shop);
  }
  return {
    ok: true,
    command: {
      type: "run",
      shop,
      shopHandle: extractShopHandle(shop),
      dry: values.dry ?? false,
      verbose: values.verbose ?? false
    }
  };
}

// src/shopify.js
var THEME_LIST_QUERY = `query ThemeList($first: Int!, $after: String) {
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
var THEME_DELETE_MUTATION = `mutation ThemeDelete($id: ID!) {
  themeDelete(id: $id) {
    deletedThemeId
    userErrors {
      code
      field
      message
    }
  }
}`;
var THEME_DELETE_EXEMPTION_URL = "https://docs.google.com/forms/d/e/1FAIpQLSfZTB1vxFC5d1-GPdqYunWRGUoDcOheHQzfK2RoEFEHrknt5g/viewform";
function buildThemeResult(theme, status, overrides = {}) {
  return {
    status,
    id: overrides.id ?? theme.id,
    name: theme.name,
    role: theme.role,
    theme,
    error: overrides.error ?? "",
    fatal: overrides.fatal ?? false
  };
}
var ShopifyApiError = class extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ShopifyApiError";
    this.operation = options.operation ?? "request";
    this.status = options.status;
    this.code = options.code ?? "";
    this.hint = options.hint ?? "";
    this.details = options.details ?? [];
    this.themeName = options.themeName ?? "";
  }
};
function getScopeHint(operationName) {
  if (operationName === "themes") {
    return "Listing themes requires the `read_themes` scope.";
  }
  if (operationName === "themeDelete") {
    return "Deleting themes requires the `write_themes` scope and a Shopify exemption for theme modification access.";
  }
  return "";
}
function buildErrorMessage(operationName, message) {
  const scopeHint = getScopeHint(operationName);
  return scopeHint ? `${message} ${scopeHint}` : message;
}
function includesThemeDeletePermissionDenial(messages) {
  const combined = messages.join(" ").toLowerCase();
  return combined.includes("access denied for themedelete") || combined.includes("write_themes") && combined.includes("exemption from shopify to modify themes") || combined.includes("modify themes") && combined.includes("submit an exception request");
}
function createThemeDeletePermissionError(operationName) {
  return new ShopifyApiError("Shopify denied theme deletion for this app.", {
    operation: operationName,
    code: "theme_delete_permission_denied",
    details: [
      "Theme modification exemption required."
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
  if (typeof value === "string") {
    return [value];
  }
  if (typeof value === "object") {
    if (typeof value.message === "string") {
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
async function requestGraphQL(clientConfig, query, variables, operationName, fetchImpl = globalThis.fetch) {
  const apiVersion = clientConfig.apiVersion ?? DEFAULT_API_VERSION;
  const endpoint = `https://${clientConfig.shop}/admin/api/${apiVersion}/graphql.json`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": clientConfig.token
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
    if (operationName === "themeDelete" && includesThemeDeletePermissionDenial(errorMessages)) {
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
    if (operationName === "themeDelete" && includesThemeDeletePermissionDenial(graphQLErrorMessages)) {
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
async function fetchAllThemes(clientConfig, fetchImpl = globalThis.fetch) {
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
      "themes",
      fetchImpl
    );
    themes.push(...data.themes.nodes);
    hasNextPage = data.themes.pageInfo.hasNextPage;
    cursor = data.themes.pageInfo.endCursor;
  }
  return themes;
}
async function deleteTheme(clientConfig, theme, fetchImpl = globalThis.fetch, options = {}) {
  if (options.dryRun) {
    return buildThemeResult(theme, "simulated");
  }
  const data = await requestGraphQL(
    clientConfig,
    THEME_DELETE_MUTATION,
    {
      id: theme.id
    },
    "themeDelete",
    fetchImpl
  );
  const payload = data.themeDelete;
  const userErrors = payload.userErrors ?? [];
  if (userErrors.length > 0) {
    return buildThemeResult(theme, "failed", {
      error: userErrors.map((error) => error.message).join("; ")
    });
  }
  return buildThemeResult(theme, "deleted", {
    id: payload.deletedThemeId ?? theme.id
  });
}
function formatDeleteFailure(error, themeName) {
  if (error instanceof ShopifyApiError) {
    return [error.message, ...error.details].filter(Boolean).join(" ");
  }
  return `Unexpected error while deleting ${themeName}.`;
}
async function deleteThemesSequentially(clientConfig, themes, onProgress, fetchImpl = globalThis.fetch, options = {}) {
  const results = [];
  for (const [index, theme] of themes.entries()) {
    onProgress?.(theme.id, "pending", "");
    try {
      const result = await deleteTheme(clientConfig, theme, fetchImpl, options);
      results.push(result);
      onProgress?.(theme.id, result.status, result.error);
    } catch (error) {
      const message = formatDeleteFailure(error, theme.name);
      const result = buildThemeResult(theme, "failed", {
        error: message,
        fatal: error instanceof ShopifyApiError && error.code === "theme_delete_permission_denied"
      });
      results.push(result);
      onProgress?.(theme.id, result.status, result.error);
      if (error instanceof ShopifyApiError && error.code === "theme_delete_permission_denied") {
        for (const remainingTheme of themes.slice(index + 1)) {
          const remainingResult = buildThemeResult(remainingTheme, "failed", {
            error: "Skipped. Theme deletion is blocked for this app.",
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

// src/broker-client.js
import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var DEFAULT_AUTH_TIMEOUT_MS = 5 * 60 * 1e3;
var DEFAULT_POLL_INTERVAL_MS = 1500;
function parseResponseText(payload) {
  if (typeof payload === "string") {
    return payload;
  }
  return "";
}
function normaliseDetails(payload, fallbackText = "") {
  const details = [];
  if (Array.isArray(payload?.details)) {
    for (const detail of payload.details) {
      if (typeof detail === "string" && detail.trim()) {
        details.push(detail.trim());
      }
    }
  }
  for (const field of ["error", "message"]) {
    if (typeof payload?.[field] === "string" && payload[field].trim()) {
      details.push(payload[field].trim());
    }
  }
  if (details.length === 0 && fallbackText) {
    details.push(fallbackText);
  }
  return [...new Set(details)];
}
async function parseResponsePayload(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }
  return response.text().catch(() => "");
}
async function requestBroker(apiBaseUrl, pathname, options = {}, fetchImpl = globalThis.fetch) {
  const baseUrl = normaliseApiBaseUrl(apiBaseUrl);
  if (!baseUrl) {
    throw new Error("Missing hosted API base URL. Set `SHOPIFY_LIQUIDATOR_API_BASE_URL`.");
  }
  const {
    method = "GET",
    body,
    token = "",
    headers = {}
  } = options;
  const url = new URL(pathname, `${baseUrl}/`);
  const requestHeaders = {
    Accept: "application/json",
    ...headers
  };
  if (body !== void 0) {
    requestHeaders["Content-Type"] = "application/json";
  }
  if (token) {
    requestHeaders.Authorization = `Bearer ${token}`;
  }
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: requestHeaders,
      body: body === void 0 ? void 0 : JSON.stringify(body)
    });
  } catch (error) {
    throw new ShopifyApiError("Network error while calling the hosted Shopify broker.", {
      operation: pathname,
      details: [error.message]
    });
  }
  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    const fallbackText = parseResponseText(payload);
    const details = normaliseDetails(payload, fallbackText);
    throw new ShopifyApiError(
      typeof payload?.message === "string" ? payload.message : `Hosted broker request failed with HTTP ${response.status}.`,
      {
        operation: pathname,
        status: response.status,
        code: typeof payload?.code === "string" ? payload.code : "",
        details
      }
    );
  }
  return payload;
}
async function openBrowser(url, execImpl = execFileAsync) {
  if (process.platform === "darwin") {
    await execImpl("open", [url]);
    return;
  }
  if (process.platform === "win32") {
    await execImpl("cmd", ["/c", "start", "", url]);
    return;
  }
  await execImpl("xdg-open", [url]);
}
function formatDeleteFailure2(error, themeName) {
  if (error instanceof ShopifyApiError) {
    return [error.message, ...error.details].filter(Boolean).join(" ");
  }
  return `Unexpected error while deleting ${themeName}.`;
}
function getBrokerApiBaseUrl(env = process.env, authConfig = null, shopProfile = null) {
  const envUrl = normaliseApiBaseUrl(env.SHOPIFY_LIQUIDATOR_API_BASE_URL ?? "");
  if (envUrl) {
    return envUrl;
  }
  const shopUrl = normaliseApiBaseUrl(shopProfile?.apiBaseUrl ?? "");
  if (shopUrl) {
    return shopUrl;
  }
  return normaliseApiBaseUrl(authConfig?.credentials?.apiBaseUrl ?? "");
}
async function startBrokeredAuth({ apiBaseUrl, shop }, fetchImpl = globalThis.fetch) {
  return requestBroker(apiBaseUrl, "/api/cli/auth/start", {
    method: "POST",
    body: { shop }
  }, fetchImpl);
}
async function pollBrokeredAuthSession({ apiBaseUrl, sessionId }, fetchImpl = globalThis.fetch) {
  const url = new URL("/api/cli/auth/poll", `${normaliseApiBaseUrl(apiBaseUrl)}/`);
  url.searchParams.set("session", sessionId);
  return requestBroker(apiBaseUrl, url.pathname + url.search, {}, fetchImpl);
}
async function completeBrokeredAuth({ apiBaseUrl, shop, authTimeoutMs = DEFAULT_AUTH_TIMEOUT_MS }, {
  fetchImpl = globalThis.fetch,
  openBrowserImpl = openBrowser,
  onPoll = null
} = {}) {
  const started = await startBrokeredAuth({ apiBaseUrl, shop }, fetchImpl);
  await openBrowserImpl(started.authorizeUrl);
  const pollIntervalMs = Number.isFinite(started.pollIntervalMs) ? started.pollIntervalMs : DEFAULT_POLL_INTERVAL_MS;
  const startedAt = Date.now();
  while (Date.now() - startedAt < authTimeoutMs) {
    await delay(pollIntervalMs);
    const polled = await pollBrokeredAuthSession({ apiBaseUrl, sessionId: started.sessionId }, fetchImpl);
    onPoll?.(polled);
    if (polled.status === "complete") {
      return polled;
    }
    if (polled.status === "failed") {
      throw new ShopifyApiError(polled.error || "Hosted Shopify login failed.", {
        operation: "broker_auth_poll",
        code: polled.code ?? "",
        details: polled.details ?? []
      });
    }
  }
  throw new ShopifyApiError("Timed out while waiting for the hosted Shopify login to complete.", {
    operation: "broker_auth_poll"
  });
}
async function validateBrokerSession({ apiBaseUrl, token }, fetchImpl = globalThis.fetch) {
  return requestBroker(apiBaseUrl, "/api/cli/session", {
    token
  }, fetchImpl);
}
async function revokeBrokerSession({ apiBaseUrl, token }, fetchImpl = globalThis.fetch) {
  return requestBroker(apiBaseUrl, "/api/cli/session", {
    method: "POST",
    token
  }, fetchImpl);
}
async function fetchAllThemesViaBroker({ apiBaseUrl, token }, fetchImpl = globalThis.fetch) {
  const payload = await requestBroker(apiBaseUrl, "/api/cli/themes", {
    token
  }, fetchImpl);
  return payload.themes ?? [];
}
async function deleteThemeViaBroker({ apiBaseUrl, token, theme, dryRun = false }, fetchImpl = globalThis.fetch) {
  const payload = await requestBroker(apiBaseUrl, "/api/cli/themes/delete", {
    method: "POST",
    token,
    body: {
      theme,
      dryRun
    }
  }, fetchImpl);
  return payload.result;
}
async function deleteThemesSequentiallyViaBroker(config, themes, onProgress, fetchImpl = globalThis.fetch, options = {}) {
  const results = [];
  for (const [index, theme] of themes.entries()) {
    onProgress?.(theme.id, "pending", "");
    try {
      const result = await deleteThemeViaBroker({
        apiBaseUrl: config.apiBaseUrl,
        token: config.token,
        theme,
        dryRun: options.dryRun
      }, fetchImpl);
      results.push(result);
      onProgress?.(theme.id, result.status, result.error);
    } catch (error) {
      const message = formatDeleteFailure2(error, theme.name);
      const isFatal = error instanceof ShopifyApiError && error.code === "theme_delete_permission_denied";
      const result = {
        status: "failed",
        id: theme.id,
        name: theme.name,
        role: theme.role,
        theme,
        error: message,
        fatal: isFatal
      };
      results.push(result);
      onProgress?.(theme.id, result.status, result.error);
      if (isFatal) {
        for (const remainingTheme of themes.slice(index + 1)) {
          const remainingResult = {
            status: "failed",
            id: remainingTheme.id,
            name: remainingTheme.name,
            role: remainingTheme.role,
            theme: remainingTheme,
            error: "Skipped. Theme deletion is blocked for this app.",
            fatal: true
          };
          results.push(remainingResult);
          onProgress?.(remainingTheme.id, remainingResult.status, remainingResult.error);
        }
        break;
      }
    }
  }
  return results;
}

// src/runtime-client.js
async function fetchThemesForConfig(config, fetchImpl = globalThis.fetch) {
  if (config.authMode === "broker") {
    return fetchAllThemesViaBroker({
      apiBaseUrl: config.apiBaseUrl,
      token: config.token
    }, fetchImpl);
  }
  return fetchAllThemes(config, fetchImpl);
}
async function deleteThemesForConfig(config, themes, onProgress, fetchImpl = globalThis.fetch, options = {}) {
  if (config.authMode === "broker") {
    return deleteThemesSequentiallyViaBroker(config, themes, onProgress, fetchImpl, options);
  }
  return deleteThemesSequentially(config, themes, onProgress, fetchImpl, options);
}

// src/theme-state.js
function getThemeAvailability(theme) {
  if (theme.role === "MAIN") {
    return {
      disabled: true,
      reason: "Live theme"
    };
  }
  if (theme.processing) {
    return {
      disabled: true,
      reason: "Still processing"
    };
  }
  return {
    disabled: false,
    reason: ""
  };
}
function createSelectionState(themes, preservedSelectedIds = []) {
  const selectedIds = preservedSelectedIds.filter((selectedId) => themes.some((theme) => theme.id === selectedId));
  const firstSelectedIndex = themes.findIndex((theme) => selectedIds.includes(theme.id));
  const firstSelectableIndex = themes.findIndex((theme) => !getThemeAvailability(theme).disabled);
  return {
    cursor: firstSelectedIndex >= 0 ? firstSelectedIndex : firstSelectableIndex >= 0 ? firstSelectableIndex : 0,
    selectedIds
  };
}
function toggleSelected(selectedIds, themeId) {
  if (selectedIds.includes(themeId)) {
    return selectedIds.filter((selectedId) => selectedId !== themeId);
  }
  return [...selectedIds, themeId];
}
function moveCursor(themes, currentIndex, direction) {
  if (themes.length === 0) {
    return 0;
  }
  let nextIndex = currentIndex;
  for (let offset = 0; offset < themes.length; offset += 1) {
    nextIndex = (nextIndex + direction + themes.length) % themes.length;
    return nextIndex;
  }
  return currentIndex;
}
function getSelectedThemes(themes, selectedIds) {
  return themes.filter((theme) => selectedIds.includes(theme.id));
}
function createDeleteResults(themes) {
  return themes.map((theme) => ({
    id: theme.id,
    name: theme.name,
    role: theme.role,
    theme,
    status: "pending",
    error: ""
  }));
}
function updateDeleteResult(results, themeId, status, error = "") {
  return results.map((result) => result.id === themeId ? { ...result, status, error } : result);
}

// src/app.js
var h = React.createElement;
var DELETE_MODE_DRY_RUN = "dry-run";
var DELETE_MODE_REAL = "delete";
var ASCII_ART_TITLE = String.raw` /$$       /$$                     /$$       /$$             /$$
| $$      |__/                    |__/      | $$            | $$
| $$       /$$  /$$$$$$  /$$   /$$ /$$  /$$$$$$$  /$$$$$$  /$$$$$$    /$$$$$$
| $$      | $$ /$$__  $$| $$  | $$| $$ /$$__  $$ |____  $$|_  $$_/   /$$__  $$
| $$      | $$| $$  \ $$| $$  | $$| $$| $$  | $$  /$$$$$$$  | $$    | $$$$$$$$
| $$      | $$| $$  | $$| $$  | $$| $$| $$  | $$ /$$__  $$  | $$ /$$| $$_____/
| $$$$$$$$| $$|  $$$$$$$|  $$$$$$/| $$|  $$$$$$$|  $$$$$$$  |  $$$$/|  $$$$$$$
|________/|__/ \____  $$ \______/ |__/ \_______/ \_______/   \___/   \_______/
                    | $$
                    | $$
                    |__/                                                      `;
function renderShortcutKey(text) {
  return h(Text, { bold: true, color: "cyan" }, text);
}
function extractThemeId(value) {
  if (!value) {
    return "";
  }
  const match = String(value).match(/\/(\d+)$/);
  return match ? match[1] : String(value);
}
function formatThemeUpdatedAt(updatedAt) {
  if (!updatedAt) {
    return "Unknown";
  }
  const parsedDate = new Date(updatedAt);
  if (Number.isNaN(parsedDate.getTime())) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat(void 0, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsedDate);
}
function sortThemesByUpdatedAt(themes) {
  return [...themes].sort((leftTheme, rightTheme) => {
    const leftUpdatedAt = new Date(leftTheme.updatedAt ?? 0).getTime();
    const rightUpdatedAt = new Date(rightTheme.updatedAt ?? 0).getTime();
    return rightUpdatedAt - leftUpdatedAt;
  });
}
function renderCommandChip(shortcut, label, key) {
  return h(
    Box,
    {
      key,
      marginRight: 2
    },
    renderShortcutKey(shortcut),
    h(Text, { color: "gray" }, ` ${label}`)
  );
}
function renderCommandBar(commands) {
  return h(
    Box,
    {
      borderStyle: "round",
      borderColor: "gray",
      paddingX: 1,
      marginTop: 1,
      flexWrap: "wrap"
    },
    ...commands.map((command, index) => renderCommandChip(command.shortcut, command.label, `${command.shortcut}-${index}`))
  );
}
function renderPanel(title, children, options = {}) {
  return h(
    Box,
    {
      flexDirection: "column",
      borderStyle: "round",
      borderColor: options.borderColor ?? "gray",
      paddingX: 1,
      paddingY: 0,
      marginTop: options.marginTop ?? 1
    },
    h(Text, { bold: true, color: options.titleColor ?? "white" }, title),
    h(Box, { flexDirection: "column", marginTop: 1 }, ...children)
  );
}
function renderDryRunNotice() {
  return renderPanel("Dry run", [
    h(Text, { bold: true, color: "cyan" }, "This is a dry run. No themes will be deleted."),
    h(Text, { color: "gray" }, "You are only previewing the shortlist and its impact before any real deletion is run.")
  ], {
    borderColor: "cyan",
    titleColor: "cyan"
  });
}
function renderModeBadge(config) {
  const badges = [];
  if (config.dry) {
    badges.push(h(Text, { key: "dry", bold: true, color: "cyan" }, "Dry run"));
  }
  if (config.verbose) {
    badges.push(h(Text, { key: "verbose", bold: true, color: "yellow" }, "Verbose"));
  }
  return badges;
}
function renderHeader(config, title, subtitle) {
  return h(
    Box,
    { flexDirection: "column", marginBottom: 1 },
    h(Box, { marginTop: 1 }, h(Text, { color: "white" }, "It's time to...")),
    h(
      Box,
      { marginTop: 1 },
      h(Text, { bold: true, color: "#63F44C" }, ASCII_ART_TITLE)
    ),
    h(
      Box,
      { flexWrap: "wrap", marginTop: 2, alignItems: "center" },
      renderShopHandleText(config),
      ...renderModeBadge(config).flatMap((badge, index) => [
        h(Text, { key: `spacer-${index}`, color: "gray" }, "  "),
        badge
      ])
    ),
    h(Box, { marginTop: 1 }, h(Text, { bold: true, color: "cyan" }, title)),
    h(Text, { color: "gray" }, subtitle)
  );
}
function renderShopHandleText(config) {
  return h(Text, { bold: true, underline: true, color: "yellow" }, config.shopHandle ?? config.shop);
}
function renderOpeningSummary(config, themes, selectedIds, deleteMode, hiddenThemeCount) {
  const modeLabel = deleteMode === DELETE_MODE_DRY_RUN ? "Dry run mode" : "Live deletion mode";
  const modeDescription = deleteMode === DELETE_MODE_DRY_RUN ? "Selections are simulated first, so you can review the impact before running a real deletion." : "Selected themes can be permanently removed after you confirm with DELETE.";
  return renderPanel("Overview", [
    h(
      Text,
      { color: "white" },
      "Review the deletable themes in ",
      renderShopHandleText(config),
      ", choose the ones you no longer need, and build a shortlist of themes to delete.\n"
    ),
    h(Text, { color: "gray" }, hiddenThemeCount > 0 ? "Live and processing themes are protected and hidden from this list.\n" : "Only deletable themes are shown in this list."),
    h(Text, { color: deleteMode === DELETE_MODE_DRY_RUN ? "cyan" : "yellow" }, `${modeLabel}: ${modeDescription}`),
    h(Box, { marginTop: 1, flexDirection: "column" }, h(Text, { color: "cyan" }, `Deletable themes shown: ${themes.length}`), h(Text, { color: selectedIds.length > 0 ? "cyan" : "gray" }, `Selected: ${selectedIds.length}`))
  ], {
    borderColor: deleteMode === DELETE_MODE_DRY_RUN ? "cyan" : "yellow",
    titleColor: deleteMode === DELETE_MODE_DRY_RUN ? "cyan" : "yellow"
  });
}
function renderThemeLine(theme, index, cursor, selectedIds) {
  const isActive = cursor === index;
  const isSelected = selectedIds.includes(theme.id);
  const marker = isSelected && isActive ? "\u25C9" : isSelected || isActive ? "\u25CF" : "\u25CB";
  const markerColor = isSelected ? "red" : isActive ? "green" : "white";
  const labelColor = "white";
  const updatedLabel = `Last updated: ${formatThemeUpdatedAt(theme.updatedAt)}`;
  return h(
    Box,
    { flexDirection: "row" },
    h(
      Text,
      { color: markerColor },
      `${marker} `
    ),
    h(
      Box,
      { marginLeft: 0 },
      h(Text, { color: labelColor }, theme.name),
      h(Text, { color: "gray" }, ` \u2022 ${updatedLabel}`)
    )
  );
}
function renderResults(results) {
  return results.flatMap((result) => {
    const color = result.status === "deleted" ? "green" : result.status === "failed" ? "red" : "yellow";
    const entries = [
      h(Text, { key: `${result.id}-status`, color }, `${result.status.toUpperCase()} ${result.name}`)
    ];
    if (result.error) {
      entries.push(
        h(Text, { key: `${result.id}-error`, color: "gray" }, `  ${result.error}`)
      );
    }
    return entries;
  });
}
function renderThemeObject(theme, keyPrefix) {
  return JSON.stringify(theme, null, 2).split("\n").map((line, index) => h(Text, { key: `${keyPrefix}-theme-${index}`, color: "gray" }, `  ${line}`));
}
function renderResultGroup(title, color, results, verbose = false) {
  if (results.length === 0) {
    return [];
  }
  return [
    h(Text, { key: `${title}-heading`, bold: true, color }, title),
    ...results.flatMap((result) => {
      const lines = [
        h(Text, { key: result.id, color }, `  ${result.name} (${extractThemeId(result.id)})`)
      ];
      if (verbose && result.theme) {
        lines.push(...renderThemeObject(result.theme, result.id));
      }
      return lines;
    })
  ];
}
function getErrorLines(error) {
  if (error instanceof ShopifyApiError) {
    return [error.message, ...error.details];
  }
  return [error.message];
}
function hasFatalThemeDeleteFailure(results) {
  return results.some((result) => result.fatal);
}
function formatFatalDeleteSummary(results) {
  const failedCount = results.filter((result) => result.status === "failed").length;
  const deletedCount = results.filter((result) => result.status === "deleted").length;
  const lines = [
    "Deletion failed",
    `Deleted: ${deletedCount} \u2022 Failed: ${failedCount}`
  ];
  for (const result of results) {
    lines.push(`${result.status.toUpperCase()} ${result.name}`);
    if (result.error) {
      lines.push(`  ${result.error}`);
    }
  }
  if (results.some((result) => result.error?.includes("Theme modification exemption required."))) {
    lines.push(`Apply for exemption: ${THEME_DELETE_EXEMPTION_URL}`);
  }
  return lines.join("\n");
}
function getCompletionCopy(results, shop, deleteMode) {
  const failedCount = results.filter((result) => result.status === "failed").length;
  const completedCount = results.filter((result) => ["deleted", "simulated"].includes(result.status)).length;
  if (deleteMode === DELETE_MODE_DRY_RUN) {
    return {
      title: "Dry run complete",
      subtitle: `${completedCount} theme(s) would be removed from ${shop}.`,
      summary: failedCount === 0 ? `Simulated ${completedCount} theme delete operation(s). No failures reported.` : `Simulated ${completedCount} theme delete operation(s); ${failedCount} failed.`,
      summaryColor: failedCount > 0 ? "yellow" : "cyan"
    };
  }
  if (failedCount === 0) {
    return {
      title: "Deletion complete",
      subtitle: `${completedCount} theme(s) removed from ${shop}.`,
      summary: `Deleted ${completedCount} theme(s). No failures reported.`,
      summaryColor: "green"
    };
  }
  return {
    title: "Deletion finished with issues",
    subtitle: `Deleted ${completedCount} theme(s); ${failedCount} failed.`,
    summary: "Review the failed deletions before rerunning the command.",
    summaryColor: "yellow"
  };
}
function App({ config, onComplete }) {
  const defaultDeleteMode = config.dry ? DELETE_MODE_DRY_RUN : DELETE_MODE_REAL;
  const [stage, setStage] = useState(STAGE_LOADING);
  const [themes, setThemes] = useState([]);
  const [hiddenThemeCount, setHiddenThemeCount] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [selectedIds, setSelectedIds] = useState([]);
  const [confirmValue, setConfirmValue] = useState("");
  const [deleteResults, setDeleteResults] = useState([]);
  const [error, setError] = useState(null);
  const [deleteMode, setDeleteMode] = useState(defaultDeleteMode);
  function applyThemeSelectionState(fetchedThemes, preservedSelectedIds = []) {
    const deletableThemes = sortThemesByUpdatedAt(
      fetchedThemes.filter((theme) => !getThemeAvailability(theme).disabled)
    );
    const selectionState = createSelectionState(deletableThemes, preservedSelectedIds);
    setThemes(deletableThemes);
    setHiddenThemeCount(Math.max(fetchedThemes.length - deletableThemes.length, 0));
    setCursor(selectionState.cursor);
    setSelectedIds(selectionState.selectedIds);
    setConfirmValue("");
    setDeleteResults([]);
    setError(null);
    setDeleteMode(defaultDeleteMode);
    setStage(deletableThemes.length === 0 ? STAGE_EMPTY : STAGE_SELECTION);
  }
  async function loadThemes(preservedSelectedIds = []) {
    const fetchedThemes = await fetchThemesForConfig(config);
    applyThemeSelectionState(fetchedThemes, preservedSelectedIds);
  }
  useEffect(() => {
    let cancelled = false;
    async function initialiseThemes() {
      try {
        const fetchedThemes = await fetchThemesForConfig(config);
        if (cancelled) {
          return;
        }
        applyThemeSelectionState(fetchedThemes);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        process.stderr.write(`${getErrorLines(loadError).join("\n")}
`);
        onComplete(1);
      }
    }
    initialiseThemes();
    return () => {
      cancelled = true;
    };
  }, [config]);
  const selectedThemes = useMemo(
    () => getSelectedThemes(themes, selectedIds),
    [themes, selectedIds]
  );
  useEffect(() => {
    if (stage !== STAGE_DELETING) {
      return void 0;
    }
    let cancelled = false;
    setDeleteResults(createDeleteResults(selectedThemes));
    async function deleteSelectedThemes() {
      const results = await deleteThemesForConfig(config, selectedThemes, (themeId, status, message) => {
        if (cancelled) {
          return;
        }
        setDeleteResults((currentResults) => updateDeleteResult(currentResults, themeId, status, message));
      }, globalThis.fetch, {
        dryRun: deleteMode === DELETE_MODE_DRY_RUN
      });
      if (cancelled) {
        return;
      }
      if (hasFatalThemeDeleteFailure(results)) {
        process.stderr.write(`${formatFatalDeleteSummary(results)}
`);
        onComplete(getResultExitCode(results));
        return;
      }
      setDeleteResults(results);
      setStage(STAGE_RESULT);
    }
    deleteSelectedThemes();
    return () => {
      cancelled = true;
    };
  }, [config, deleteMode, selectedThemes, stage]);
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      onComplete(stage === STAGE_RESULT ? getResultExitCode(deleteResults) : EXIT_CANCELLED);
      return;
    }
    if (stage === STAGE_LOADING || stage === STAGE_DELETING) {
      return;
    }
    if (stage === STAGE_ERROR) {
      if (key.return || input === "q" || key.escape) {
        onComplete(1);
      }
      return;
    }
    if (stage === STAGE_EMPTY) {
      if (key.return || input === "q" || key.escape) {
        onComplete(EXIT_SUCCESS);
      }
      return;
    }
    if (stage === STAGE_RESULT) {
      const completedCount = deleteResults.filter((result) => ["deleted", "simulated"].includes(result.status)).length;
      const remainingSelectableCount = Math.max(
        themes.length - completedCount,
        0
      );
      if ((input === "d" || input === "D") && deleteMode === DELETE_MODE_DRY_RUN && completedCount > 0) {
        setDeleteMode(DELETE_MODE_REAL);
        setConfirmValue("");
        setDeleteResults([]);
        setStage(STAGE_CONFIRM);
        return;
      }
      if ((input === "m" || input === "M") && remainingSelectableCount > 0) {
        setStage(STAGE_LOADING);
        setError(null);
        loadThemes(selectedIds).catch((loadError) => {
          process.stderr.write(`${getErrorLines(loadError).join("\n")}
`);
          onComplete(1);
        });
        return;
      }
      if (key.return || input === "q" || key.escape) {
        onComplete(getResultExitCode(deleteResults));
      }
      return;
    }
    if (input === "q" || key.escape) {
      onComplete(EXIT_CANCELLED);
      return;
    }
    if (stage === STAGE_SELECTION) {
      if (key.upArrow || input === "k") {
        setCursor((currentCursor) => moveCursor(themes, currentCursor, -1));
        return;
      }
      if (key.downArrow || input === "j") {
        setCursor((currentCursor) => moveCursor(themes, currentCursor, 1));
        return;
      }
      if (input === " ") {
        const theme = themes[cursor];
        if (!theme) {
          return;
        }
        setSelectedIds((currentSelectedIds) => toggleSelected(currentSelectedIds, theme.id));
        return;
      }
      if (key.return) {
        setStage(getStageAfterSelection(selectedIds));
      }
      return;
    }
    if (stage === STAGE_REVIEW) {
      if (key.backspace || key.delete || key.leftArrow) {
        setStage(STAGE_SELECTION);
        return;
      }
      if (key.return) {
        setConfirmValue("");
        setStage(STAGE_CONFIRM);
      }
      return;
    }
    if (stage === STAGE_CONFIRM) {
      if (key.return && isDeleteConfirmationValid(confirmValue)) {
        setStage(STAGE_DELETING);
        return;
      }
      if (key.backspace || key.delete) {
        if (confirmValue.length === 0) {
          setStage(STAGE_REVIEW);
          return;
        }
        setConfirmValue((currentValue) => currentValue.slice(0, -1));
        return;
      }
      if (input && !key.return) {
        setConfirmValue((currentValue) => `${currentValue}${input}`);
      }
    }
  });
  if (stage === STAGE_LOADING) {
    return h(
      Box,
      { flexDirection: "column" },
      renderHeader(config, "Loading themes", "Fetching themes from Shopify Admin API..."),
      h(Text, null, `Store: ${config.shop}`)
    );
  }
  if (stage === STAGE_ERROR) {
    return h(
      Box,
      { flexDirection: "column" },
      renderHeader(config, "Unable to load themes", "The Shopify response could not be loaded."),
      renderPanel(
        "Error",
        getErrorLines(error).map((line, index) => h(Text, { key: `${line}-${index}`, color: index === 0 ? "red" : "gray" }, line)),
        { borderColor: "red", titleColor: "red" }
      ),
      renderCommandBar([
        { shortcut: "Enter", label: "exit" },
        { shortcut: "q", label: "exit" },
        { shortcut: "Esc", label: "exit" }
      ])
    );
  }
  if (stage === STAGE_EMPTY) {
    return h(
      Box,
      { flexDirection: "column" },
      renderHeader(config, "No deletable themes available", "There are no themes in this store that this tool can safely offer for deletion."),
      renderPanel("Status", [
        h(Text, { color: "gray" }, hiddenThemeCount > 0 ? `All ${hiddenThemeCount} theme(s) are protected because they are live or still processing.` : "No deletable themes were returned by Shopify for this store.")
      ]),
      renderCommandBar([
        { shortcut: "Enter", label: "exit" },
        { shortcut: "q", label: "exit" },
        { shortcut: "Esc", label: "exit" }
      ])
    );
  }
  if (stage === STAGE_REVIEW) {
    return h(
      Box,
      { flexDirection: "column" },
      renderHeader(config, "Review selected themes", `Selected ${selectedThemes.length} theme(s). Confirm the shortlist before continuing.`),
      ...deleteMode === DELETE_MODE_DRY_RUN ? [renderDryRunNotice()] : [],
      renderPanel(
        "Selected themes",
        selectedThemes.map((theme) => h(Text, { key: theme.id }, `\u2022 ${theme.name}`))
      ),
      renderCommandBar([
        { shortcut: "Enter", label: "continue" },
        { shortcut: "Backspace", label: "edit selection" },
        { shortcut: "q", label: "cancel" },
        { shortcut: "Esc", label: "cancel" }
      ])
    );
  }
  if (stage === STAGE_CONFIRM) {
    const isDryRun = deleteMode === DELETE_MODE_DRY_RUN;
    return h(
      Box,
      { flexDirection: "column" },
      renderHeader(
        config,
        isDryRun ? "Dry run" : "Danger zone",
        isDryRun ? "Type DELETE exactly, then press Enter to simulate deleting these themes." : "Type DELETE exactly, then press Enter to start deleting themes."
      ),
      ...isDryRun ? [renderDryRunNotice()] : [],
      renderPanel(
        isDryRun ? "Simulation summary" : "Deletion summary",
        [
          h(Text, { color: isDryRun ? "cyan" : "red" }, isDryRun ? `You are about to simulate deleting ${selectedThemes.length} theme(s) from ${config.shop}.` : `You are about to delete ${selectedThemes.length} theme(s) from ${config.shop}.`),
          ...selectedThemes.map((theme) => h(Text, { key: theme.id }, `\u2022 ${theme.name}`))
        ],
        { borderColor: isDryRun ? "cyan" : "red", titleColor: isDryRun ? "cyan" : "red" }
      ),
      renderPanel("Confirmation", [
        h(Box, null, h(Text, { color: "gray" }, "> "), h(Text, { color: isDeleteConfirmationValid(confirmValue) ? "green" : "yellow" }, confirmValue || ""))
      ], { borderColor: isDeleteConfirmationValid(confirmValue) ? "green" : "yellow", titleColor: isDeleteConfirmationValid(confirmValue) ? "green" : "yellow" }),
      renderCommandBar([
        { shortcut: "Enter", label: "confirm" },
        { shortcut: "Backspace", label: "return to review" },
        { shortcut: "q", label: "cancel" },
        { shortcut: "Esc", label: "cancel" }
      ])
    );
  }
  if (stage === STAGE_DELETING) {
    const isDryRun = deleteMode === DELETE_MODE_DRY_RUN;
    return h(
      Box,
      { flexDirection: "column" },
      renderHeader(
        config,
        isDryRun ? "Simulating theme deletion" : "Deleting themes",
        isDryRun ? "This preview does not send the Shopify delete mutation." : "Themes are deleted sequentially. Do not close the terminal until this completes."
      ),
      renderPanel("Progress", renderResults(deleteResults), {
        borderColor: isDryRun ? "cyan" : "yellow",
        titleColor: isDryRun ? "cyan" : "yellow"
      })
    );
  }
  if (stage === STAGE_RESULT) {
    const failedCount = deleteResults.filter((result) => result.status === "failed").length;
    const deletedCount = deleteResults.filter((result) => ["deleted", "simulated"].includes(result.status)).length;
    const deletedResults = deleteResults.filter((result) => ["deleted", "simulated"].includes(result.status));
    const failedResults = deleteResults.filter((result) => result.status === "failed");
    const skippedResults = deleteResults.filter((result) => !["deleted", "simulated", "failed"].includes(result.status));
    const completionCopy = getCompletionCopy(deleteResults, config.shop, deleteMode);
    const remainingCount = Math.max(themes.length - deletedCount, 0);
    const remainingSelectableCount = Math.max(
      themes.filter((theme) => !getThemeAvailability(theme).disabled).length - deletedCount,
      0
    );
    return h(
      Box,
      { flexDirection: "column" },
      renderHeader(config, completionCopy.title, completionCopy.subtitle),
      h(Text, { color: completionCopy.summaryColor }, completionCopy.summary),
      renderPanel("Outcome", [
        h(Text, { bold: true }, "Outcome"),
        h(Text, { color: deletedCount > 0 ? completionCopy.summaryColor : "gray" }, `${deleteMode === DELETE_MODE_DRY_RUN ? "Would delete" : "Deleted"}: ${deletedCount}`),
        h(Text, { color: failedCount > 0 ? "red" : "gray" }, `Failed: ${failedCount}`),
        h(Text, { color: remainingCount > 0 ? "cyan" : "gray" }, `Remaining themes: ${remainingCount}`)
      ], { borderColor: completionCopy.summaryColor, titleColor: completionCopy.summaryColor }),
      renderPanel("Results", [
        ...renderResultGroup(deleteMode === DELETE_MODE_DRY_RUN ? "Themes ready to delete" : "Deleted themes", deleteMode === DELETE_MODE_DRY_RUN ? "cyan" : "green", deletedResults, config.verbose),
        ...renderResultGroup("Failed themes", "red", failedResults, config.verbose),
        ...renderResultGroup("Other results", "yellow", skippedResults, config.verbose)
      ]),
      renderCommandBar([
        ...deleteMode === DELETE_MODE_DRY_RUN && deletedCount > 0 ? [{ shortcut: "D", label: "run the real deletion" }] : [],
        ...remainingSelectableCount > 0 ? [{ shortcut: "M", label: "select more themes" }] : [],
        { shortcut: "Enter", label: "exit" },
        { shortcut: "q", label: "exit" },
        { shortcut: "Esc", label: "exit" }
      ])
    );
  }
  return h(
    Box,
    { flexDirection: "column" },
    renderHeader(config, "Select themes to delete", "Inspect the store, understand what is protected, then choose the themes you want to review for deletion."),
    renderOpeningSummary(config, themes, selectedIds, deleteMode, hiddenThemeCount),
    renderPanel(
      `Themes (${themes.length})`,
      themes.length === 0 ? [h(Text, { key: "no-themes", color: "yellow" }, "No themes were returned by Shopify for this store.")] : themes.map((theme, index) => h(Box, { key: theme.id }, renderThemeLine(theme, index, cursor, selectedIds))),
      { borderColor: "green", titleColor: "green" }
    ),
    renderPanel("Selection", [
      h(Text, { color: "cyan" }, `Selected now: ${selectedIds.length}`),
      h(Text, { color: "gray" }, `Available to delete: ${themes.length}`),
      h(Text, { color: "gray" }, "Press Enter when your shortlist is ready for review.")
    ], { titleColor: "cyan" }),
    renderCommandBar([
      { shortcut: "\u2191/\u2193", label: "move" },
      { shortcut: "Space", label: "toggle" },
      { shortcut: "Enter", label: "review" },
      { shortcut: "Esc/q", label: "cancel" }
    ])
  );
}

// src/auth-store.js
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
var APP_NAME = "shopify-liquidator";
var CONFIG_FILENAME = "config.json";
function getBaseConfigDir(env = process.env, platform = process.platform) {
  if (env.SHOPIFY_LIQUIDATOR_CONFIG_DIR) {
    return env.SHOPIFY_LIQUIDATOR_CONFIG_DIR;
  }
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", APP_NAME);
  }
  if (platform === "win32") {
    const appDataDir = env.APPDATA || env.LOCALAPPDATA;
    if (appDataDir) {
      return path.join(appDataDir, APP_NAME);
    }
  }
  if (env.XDG_CONFIG_HOME) {
    return path.join(env.XDG_CONFIG_HOME, APP_NAME);
  }
  return path.join(os.homedir(), ".config", APP_NAME);
}
function getAuthConfigPath(env = process.env) {
  return path.join(getBaseConfigDir(env), CONFIG_FILENAME);
}
function createEmptyAuthConfig() {
  return {
    version: 3,
    credentials: {
      clientId: "",
      apiBaseUrl: ""
    },
    defaultShop: "",
    shops: {}
  };
}
async function readAuthConfig(env = process.env) {
  const configPath = getAuthConfigPath(env);
  try {
    const rawConfig = await readFile(configPath, "utf8");
    const parsed = JSON.parse(rawConfig);
    const shops = parsed.shops ?? {};
    const migratedClientId = parsed.credentials?.clientId ?? Object.values(shops).find((profile) => profile?.clientId)?.clientId ?? "";
    return {
      version: parsed.version ?? 3,
      credentials: {
        clientId: migratedClientId,
        apiBaseUrl: parsed.credentials?.apiBaseUrl ?? ""
      },
      defaultShop: parsed.defaultShop ?? "",
      shops
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return createEmptyAuthConfig();
    }
    throw error;
  }
}
async function writeAuthConfig(config, env = process.env) {
  const configPath = getAuthConfigPath(env);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2));
}
async function saveGlobalCredentials(clientId, env = process.env) {
  const config = await readAuthConfig(env);
  config.credentials.clientId = clientId;
  await writeAuthConfig(config, env);
  return config;
}
async function clearGlobalCredentials(env = process.env) {
  const config = await readAuthConfig(env);
  config.credentials.clientId = "";
  await writeAuthConfig(config, env);
  return config;
}
async function saveBrokerApiBaseUrl(apiBaseUrl, env = process.env) {
  const config = await readAuthConfig(env);
  config.credentials.apiBaseUrl = apiBaseUrl;
  await writeAuthConfig(config, env);
  return config;
}
async function clearBrokerApiBaseUrl(env = process.env) {
  const config = await readAuthConfig(env);
  config.credentials.apiBaseUrl = "";
  await writeAuthConfig(config, env);
  return config;
}
async function saveShopProfile(shop, profile, env = process.env) {
  const config = await readAuthConfig(env);
  config.shops[shop] = {
    ...config.shops[shop],
    ...profile
  };
  if (!config.defaultShop) {
    config.defaultShop = shop;
  }
  await writeAuthConfig(config, env);
  return config;
}
async function removeShopProfile(shop, env = process.env) {
  const config = await readAuthConfig(env);
  delete config.shops[shop];
  if (config.defaultShop === shop) {
    config.defaultShop = Object.keys(config.shops)[0] ?? "";
  }
  await writeAuthConfig(config, env);
  return config;
}
async function setDefaultShop(shop, env = process.env) {
  const config = await readAuthConfig(env);
  if (!config.shops[shop]) {
    throw new Error(`No stored authentication was found for ${shop}.`);
  }
  config.defaultShop = shop;
  await writeAuthConfig(config, env);
  return config;
}

// src/client-credentials.js
var REQUIRED_SCOPES = ["read_themes", "write_themes"];
var ShopifyAuthError = class extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ShopifyAuthError";
    this.status = options.status;
    this.details = options.details ?? [];
  }
};
function getMissingRequiredScopes(scopeValue) {
  const scopes = scopeValue.split(",").map((scope) => scope.trim()).filter(Boolean);
  return REQUIRED_SCOPES.filter((scope) => {
    if (scopes.includes(scope)) {
      return false;
    }
    if (scope.startsWith("read_")) {
      const writeScope = `write_${scope.slice("read_".length)}`;
      return !scopes.includes(writeScope);
    }
    return true;
  });
}

// src/secret-store.js
import { execFile as execFile2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";
var execFileAsync2 = promisify2(execFile2);
var SERVICE_NAME = "shopify-liquidator";
var GLOBAL_ACCOUNT_NAME = "app::client-secret";
function getLegacyClientSecretAccountName(shop) {
  return `${shop}::client-secret`;
}
function getShopAccessTokenAccountName(shop) {
  return `${shop}::offline-token`;
}
function createSecretBackendUnavailableError(error) {
  const messageLines = [
    "Secure credential storage is unavailable on this machine.",
    "Install and enable a supported OS credential store, then try again."
  ];
  if (process.platform === "linux") {
    messageLines.push("On Linux, this usually means a Secret Service keyring such as GNOME Keyring or KWallet is not available.");
  }
  return new Error(messageLines.join(" "), { cause: error });
}
function isMacOsSecretNotFoundError(error) {
  return error?.code === 44;
}
async function loadKeytar() {
  try {
    const keytarModule = await import("keytar");
    const keytar = keytarModule.default ?? keytarModule;
    if (typeof keytar?.setPassword !== "function" || typeof keytar?.getPassword !== "function" || typeof keytar?.deletePassword !== "function") {
      throw new TypeError("The loaded keytar module does not expose the expected credential methods.");
    }
    return keytar;
  } catch (error) {
    throw createSecretBackendUnavailableError(error);
  }
}
var defaultBackendPromise;
function createKeytarBackend(keytar) {
  return {
    async setSecret(accountName, secret) {
      await keytar.setPassword(SERVICE_NAME, accountName, secret);
    },
    async getSecret(accountName) {
      return await keytar.getPassword(SERVICE_NAME, accountName) ?? "";
    },
    async deleteSecret(accountName) {
      await keytar.deletePassword(SERVICE_NAME, accountName);
    }
  };
}
function createMacOsKeychainBackend(execImpl = execFileAsync2) {
  return {
    async setSecret(accountName, secret) {
      await execImpl("security", [
        "add-generic-password",
        "-U",
        "-a",
        accountName,
        "-s",
        SERVICE_NAME,
        "-w",
        secret
      ]);
    },
    async getSecret(accountName) {
      try {
        const { stdout } = await execImpl("security", [
          "find-generic-password",
          "-a",
          accountName,
          "-s",
          SERVICE_NAME,
          "-w"
        ]);
        return stdout.trim();
      } catch (error) {
        if (isMacOsSecretNotFoundError(error)) {
          return "";
        }
        throw error;
      }
    },
    async deleteSecret(accountName) {
      try {
        await execImpl("security", [
          "delete-generic-password",
          "-a",
          accountName,
          "-s",
          SERVICE_NAME
        ]);
      } catch (error) {
        if (!isMacOsSecretNotFoundError(error)) {
          throw error;
        }
      }
    }
  };
}
async function getDefaultBackend() {
  if (!defaultBackendPromise) {
    defaultBackendPromise = process.platform === "darwin" ? Promise.resolve(createMacOsKeychainBackend()) : loadKeytar().then((keytar) => createKeytarBackend(keytar));
  }
  return defaultBackendPromise;
}
async function setSecret(accountName, secret, backend) {
  const activeBackend = backend ?? await getDefaultBackend();
  await activeBackend.setSecret(accountName, secret);
}
async function getSecret(accountName, backend) {
  const activeBackend = backend ?? await getDefaultBackend();
  return activeBackend.getSecret(accountName);
}
async function deleteSecret(accountName, backend) {
  const activeBackend = backend ?? await getDefaultBackend();
  await activeBackend.deleteSecret(accountName);
}
async function getClientSecret(shop, backend) {
  return getSecret(getLegacyClientSecretAccountName(shop), backend);
}
async function deleteClientSecret(shop, backend) {
  return deleteSecret(getLegacyClientSecretAccountName(shop), backend);
}
async function setShopAccessToken(shop, token, backend) {
  return setSecret(getShopAccessTokenAccountName(shop), token, backend);
}
async function getShopAccessToken(shop, backend) {
  return getSecret(getShopAccessTokenAccountName(shop), backend);
}
async function deleteShopAccessToken(shop, backend) {
  return deleteSecret(getShopAccessTokenAccountName(shop), backend);
}
async function setAppClientSecret(secret, backend) {
  return setSecret(GLOBAL_ACCOUNT_NAME, secret, backend);
}
async function getAppClientSecret(backend) {
  return getSecret(GLOBAL_ACCOUNT_NAME, backend);
}
async function deleteAppClientSecret(backend) {
  return deleteSecret(GLOBAL_ACCOUNT_NAME, backend);
}

// src/oauth.js
import crypto from "node:crypto";
import { execFile as execFile3 } from "node:child_process";
import http from "node:http";
import { URL as URL2, URLSearchParams } from "node:url";
import { promisify as promisify3 } from "node:util";
var execFileAsync3 = promisify3(execFile3);
var DEFAULT_REDIRECT_URI = "http://127.0.0.1:3457/oauth/callback";
var DEFAULT_SCOPES = "read_themes,write_themes";
var STATE_COOKIE = "shopify_liquidator_oauth_state";
var ShopifyOAuthError = class extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ShopifyOAuthError";
    this.status = options.status;
    this.details = options.details ?? [];
  }
};
function normaliseErrorMessages2(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normaliseErrorMessages2(entry));
  }
  if (typeof value === "string") {
    return [value];
  }
  if (typeof value === "object") {
    if (typeof value.message === "string") {
      return [value.message];
    }
    return Object.values(value).flatMap((entry) => normaliseErrorMessages2(entry));
  }
  return [String(value)];
}
function getRedirectUri(env = process.env) {
  return env.SHOPIFY_OAUTH_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;
}
function getRequestedScopes(env = process.env) {
  return env.SHOPIFY_SCOPES?.trim() || DEFAULT_SCOPES;
}
function createNonce() {
  return crypto.randomBytes(16).toString("hex");
}
function buildShopifyHmacMessage(searchParams) {
  const entries = [];
  for (const [key, value] of searchParams.entries()) {
    if (key === "hmac" || key === "signature") {
      continue;
    }
    entries.push(`${key}=${value}`);
  }
  return entries.sort().join("&");
}
function verifyShopifyHmac(searchParams, clientSecret) {
  const providedHmac = searchParams.get("hmac");
  if (!providedHmac) {
    return false;
  }
  const message = buildShopifyHmacMessage(searchParams);
  const computedHmac = crypto.createHmac("sha256", clientSecret).update(message).digest("hex");
  if (computedHmac.length !== providedHmac.length) {
    return false;
  }
  return crypto.timingSafeEqual(
    Buffer.from(computedHmac, "utf8"),
    Buffer.from(providedHmac, "utf8")
  );
}
function buildAuthorizeUrl({ shop, clientId, redirectUri, state, scopes }) {
  const url = new URL2(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  if (scopes) {
    url.searchParams.set("scope", scopes);
  }
  return url.toString();
}
function parseCookies(cookieHeader) {
  const cookies = {};
  for (const part of (cookieHeader ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (!name) {
      continue;
    }
    cookies[name] = rest.join("=");
  }
  return cookies;
}
async function openBrowser2(url, execImpl = execFileAsync3) {
  if (process.platform === "darwin") {
    await execImpl("open", [url]);
    return;
  }
  if (process.platform === "win32") {
    await execImpl("cmd", ["/c", "start", "", url]);
    return;
  }
  await execImpl("xdg-open", [url]);
}
async function exchangeAuthorizationCode({ shop, clientId, clientSecret, code }, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ShopifyOAuthError(`OAuth token exchange failed with HTTP ${response.status}.`, {
      status: response.status,
      details: [
        ...normaliseErrorMessages2(payload?.errors),
        ...normaliseErrorMessages2(payload?.error),
        ...normaliseErrorMessages2(payload?.error_description),
        ...normaliseErrorMessages2(payload?.message)
      ]
    });
  }
  if (!payload?.access_token) {
    throw new ShopifyOAuthError("Shopify did not return an offline access token.");
  }
  return {
    accessToken: payload.access_token,
    scope: payload.scope ?? ""
  };
}
function sendHtml(response, statusCode, title, message) {
  response.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>${message}</p></body></html>`);
}
async function runOAuthBrowserFlow({ shop, clientId, clientSecret, redirectUri = getRedirectUri(), scopes = getRequestedScopes() }, {
  fetchImpl = globalThis.fetch,
  openBrowserImpl = openBrowser2
} = {}) {
  if (!isValidShopDomain(shop)) {
    throw new ShopifyOAuthError(`Invalid shop identifier "${shop}".`);
  }
  const redirectUrl = new URL2(redirectUri);
  const callbackState = createNonce();
  const startPath = "/oauth/start";
  const result = await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler, value) => {
      if (settled) {
        return;
      }
      settled = true;
      server.close(() => handler(value));
    };
    const server = http.createServer(async (request, response) => {
      try {
        const requestUrl = new URL2(request.url, `${redirectUrl.protocol}//${redirectUrl.host}`);
        if (requestUrl.pathname === startPath) {
          response.writeHead(302, {
            Location: buildAuthorizeUrl({
              shop,
              clientId,
              redirectUri,
              state: callbackState,
              scopes
            }),
            "Set-Cookie": `${STATE_COOKIE}=${callbackState}; HttpOnly; Path=/; SameSite=Lax; Max-Age=600`
          });
          response.end();
          return;
        }
        if (requestUrl.pathname !== redirectUrl.pathname) {
          sendHtml(response, 404, "Not found", "This OAuth endpoint only handles Shopify login callbacks.");
          return;
        }
        const cookies = parseCookies(request.headers.cookie);
        const state = requestUrl.searchParams.get("state");
        const shopParam = requestUrl.searchParams.get("shop");
        const code = requestUrl.searchParams.get("code");
        if (!code || !state || !shopParam) {
          sendHtml(response, 400, "Authentication failed", "Shopify did not return the expected OAuth parameters.");
          finish(reject, new ShopifyOAuthError("Shopify did not return the expected OAuth parameters."));
          return;
        }
        if (cookies[STATE_COOKIE] !== callbackState || state !== callbackState) {
          sendHtml(response, 400, "Authentication failed", "The OAuth state check failed.");
          finish(reject, new ShopifyOAuthError("The OAuth state check failed."));
          return;
        }
        if (!isValidShopDomain(shopParam)) {
          sendHtml(response, 400, "Authentication failed", "Shopify returned an invalid shop hostname.");
          finish(reject, new ShopifyOAuthError("Shopify returned an invalid shop hostname."));
          return;
        }
        if (shopParam !== shop) {
          sendHtml(response, 400, "Authentication failed", "Shopify returned a different shop than the one you selected.");
          finish(reject, new ShopifyOAuthError("Shopify returned a different shop than the one you selected."));
          return;
        }
        if (!verifyShopifyHmac(requestUrl.searchParams, clientSecret)) {
          sendHtml(response, 400, "Authentication failed", "The Shopify callback HMAC was invalid.");
          finish(reject, new ShopifyOAuthError("The Shopify callback HMAC was invalid."));
          return;
        }
        const token = await exchangeAuthorizationCode(
          {
            shop: shopParam,
            clientId,
            clientSecret,
            code
          },
          fetchImpl
        );
        sendHtml(response, 200, "Authentication complete", "You can return to the terminal now.");
        finish(resolve, {
          shop: shopParam,
          accessToken: token.accessToken,
          scope: token.scope
        });
      } catch (error) {
        sendHtml(response, 500, "Authentication failed", "An unexpected error occurred while completing OAuth.");
        finish(reject, error);
      }
    });
    server.once("error", (error) => {
      finish(reject, new ShopifyOAuthError(`Could not start the local OAuth callback server: ${error.message}`));
    });
    server.listen(Number(redirectUrl.port), redirectUrl.hostname, async () => {
      try {
        await openBrowserImpl(new URL2(startPath, `${redirectUrl.protocol}//${redirectUrl.host}`).toString());
      } catch (error) {
        finish(reject, new ShopifyOAuthError(`Could not open the browser automatically. Open this URL manually: ${new URL2(startPath, `${redirectUrl.protocol}//${redirectUrl.host}`).toString()}`));
      }
    });
  });
  return result;
}

// src/commands.js
var AUTH_PROBE_QUERY = `query AuthProbe {
  themes(first: 1) {
    nodes {
      id
    }
  }
}`;
function formatDetails(error) {
  return error.details?.length ? `
${error.details.join("\n")}` : "";
}
function formatScopeSummary(scopeValue) {
  return scopeValue || "No scopes returned";
}
function getMissingAppCredentialsMessage() {
  return "Missing Shopify app credentials. Set `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` so `theme-liquidate` can open the Shopify login window.";
}
function getMissingBrokerConfigurationMessage() {
  return "Missing hosted broker configuration. Set `SHOPIFY_LIQUIDATOR_API_BASE_URL` to use your Vercel-hosted Shopify app.";
}
function isBrokerProfile(profile) {
  return profile?.tokenType === "broker_session" || profile?.authMethod === "brokered";
}
async function migrateLegacyAppSecret(authConfig, env = process.env, shop = "") {
  const candidateShops = [
    shop,
    authConfig.defaultShop,
    ...Object.keys(authConfig.shops)
  ].filter(Boolean);
  const storedClientId = authConfig.credentials.clientId;
  for (const candidateShop of new Set(candidateShops)) {
    const legacySecret = await getClientSecret(candidateShop);
    if (!legacySecret) {
      continue;
    }
    const clientId = storedClientId || authConfig.shops[candidateShop]?.clientId || "";
    if (!clientId) {
      continue;
    }
    await saveGlobalCredentials(clientId, env);
    await setAppClientSecret(legacySecret);
    return {
      clientId,
      clientSecret: legacySecret
    };
  }
  return null;
}
async function ensureAppCredentials(authConfig, env = process.env, shop = "") {
  const envClientId = (env.SHOPIFY_CLIENT_ID ?? "").trim();
  const envClientSecret = (env.SHOPIFY_CLIENT_SECRET ?? "").trim();
  if (envClientId && !envClientSecret || !envClientId && envClientSecret) {
    throw new Error("Set both `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET`, or neither.");
  }
  if (envClientId && envClientSecret) {
    if (authConfig.credentials.clientId !== envClientId) {
      await saveGlobalCredentials(envClientId, env);
    }
    await setAppClientSecret(envClientSecret);
    return {
      clientId: envClientId,
      clientSecret: envClientSecret
    };
  }
  const storedClientId = authConfig.credentials.clientId;
  const storedClientSecret = await getAppClientSecret();
  if (storedClientId && storedClientSecret) {
    return {
      clientId: storedClientId,
      clientSecret: storedClientSecret
    };
  }
  const migrated = await migrateLegacyAppSecret(authConfig, env, shop);
  if (migrated) {
    return migrated;
  }
  throw new Error(getMissingAppCredentialsMessage());
}
async function validateStoredToken(shop, accessToken, env = process.env) {
  await requestGraphQL(
    {
      shop,
      token: accessToken
    },
    AUTH_PROBE_QUERY,
    {},
    "themes"
  );
  await saveShopProfile(
    shop,
    {
      lastValidatedAt: (/* @__PURE__ */ new Date()).toISOString()
    },
    env
  );
}
async function validateStoredBrokerToken(shop, apiBaseUrl, sessionToken, env = process.env) {
  const response = await validateBrokerSession({
    apiBaseUrl,
    token: sessionToken
  });
  if (response.shop && response.shop !== shop) {
    throw new ShopifyApiError("The hosted broker returned a session for a different shop.", {
      operation: "broker_session",
      details: [`Expected ${shop}, received ${response.shop}.`]
    });
  }
  await saveShopProfile(
    shop,
    {
      lastValidatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      scope: response.scope ?? ""
    },
    env
  );
  return response;
}
async function authenticateShop(shop, authConfig, env = process.env) {
  const { clientId, clientSecret } = await ensureAppCredentials(authConfig, env, shop);
  process.stdout.write(`Opening Shopify login for ${shop}...
`);
  const token = await runOAuthBrowserFlow({
    shop,
    clientId,
    clientSecret
  });
  const missingScopes = getMissingRequiredScopes(token.scope);
  if (missingScopes.length > 0) {
    throw new Error(`The approved app is missing required scopes for this CLI: ${missingScopes.join(", ")}.`);
  }
  await validateStoredToken(shop, token.accessToken, env);
  await setShopAccessToken(shop, token.accessToken);
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const configAfterSave = await saveShopProfile(
    shop,
    {
      scope: token.scope,
      authMethod: "authorization_code",
      authenticatedAt: timestamp,
      lastValidatedAt: timestamp
    },
    env
  );
  if (!configAfterSave.defaultShop) {
    await setDefaultShop(shop, env);
  }
  return {
    shop,
    accessToken: token.accessToken,
    scope: token.scope
  };
}
async function authenticateShopViaBroker(shop, authConfig, env = process.env) {
  const apiBaseUrl = getBrokerApiBaseUrl(env, authConfig, authConfig.shops[shop]);
  if (!apiBaseUrl) {
    throw new Error(getMissingBrokerConfigurationMessage());
  }
  if (authConfig.credentials.apiBaseUrl !== apiBaseUrl) {
    await saveBrokerApiBaseUrl(apiBaseUrl, env);
  }
  process.stdout.write(`Opening hosted Shopify login for ${shop}...
`);
  const completedAuth = await completeBrokeredAuth({
    apiBaseUrl,
    shop
  });
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const configAfterSave = await saveShopProfile(
    completedAuth.shop ?? shop,
    {
      scope: completedAuth.scope ?? "",
      authMethod: "brokered",
      tokenType: "broker_session",
      authenticatedAt: timestamp,
      lastValidatedAt: timestamp,
      apiBaseUrl
    },
    env
  );
  await setShopAccessToken(completedAuth.shop ?? shop, completedAuth.cliToken);
  if (!configAfterSave.defaultShop) {
    await setDefaultShop(completedAuth.shop ?? shop, env);
  }
  return {
    shop: completedAuth.shop ?? shop,
    sessionToken: completedAuth.cliToken,
    scope: completedAuth.scope ?? "",
    apiBaseUrl
  };
}
function shouldReauthenticate(error) {
  return error instanceof ShopifyApiError && [401, 403].includes(error.status);
}
async function resolveRunConfig(command, env = process.env) {
  const authConfig = await readAuthConfig(env);
  const shop = command.shop || authConfig.defaultShop;
  if (!shop) {
    throw new Error("No shop was selected. Run `theme-liquidate --shop <store>` to open the Shopify login flow.");
  }
  const shopProfile = authConfig.shops[shop];
  const brokerApiBaseUrl = getBrokerApiBaseUrl(env, authConfig, shopProfile);
  const brokerMode = Boolean(brokerApiBaseUrl);
  const storedAccessToken = await getShopAccessToken(shop);
  if (storedAccessToken) {
    try {
      if (brokerMode) {
        const validatedSession = await validateStoredBrokerToken(shop, brokerApiBaseUrl, storedAccessToken, env);
        return {
          shop,
          shopHandle: command.shopHandle || extractShopHandle(shop),
          token: storedAccessToken,
          dry: command.dry,
          verbose: command.verbose,
          authMode: "broker",
          apiBaseUrl: brokerApiBaseUrl,
          scope: validatedSession.scope ?? shopProfile?.scope ?? ""
        };
      }
      await validateStoredToken(shop, storedAccessToken, env);
      return {
        shop,
        shopHandle: command.shopHandle || extractShopHandle(shop),
        token: storedAccessToken,
        dry: command.dry,
        verbose: command.verbose,
        authMode: "direct"
      };
    } catch (error) {
      if (!shouldReauthenticate(error)) {
        throw error;
      }
      process.stdout.write(`Stored authentication for ${shop} is no longer valid. Opening Shopify login again...
`);
    }
  }
  if (brokerMode) {
    const authenticatedShop2 = await authenticateShopViaBroker(shop, authConfig, env);
    return {
      shop: authenticatedShop2.shop,
      shopHandle: command.shopHandle || extractShopHandle(authenticatedShop2.shop),
      token: authenticatedShop2.sessionToken,
      dry: command.dry,
      verbose: command.verbose,
      authMode: "broker",
      apiBaseUrl: authenticatedShop2.apiBaseUrl,
      scope: authenticatedShop2.scope
    };
  }
  const authenticatedShop = await authenticateShop(shop, authConfig, env);
  return {
    shop: authenticatedShop.shop,
    shopHandle: command.shopHandle || extractShopHandle(authenticatedShop.shop),
    token: authenticatedShop.accessToken,
    dry: command.dry,
    verbose: command.verbose,
    authMode: "direct",
    scope: authenticatedShop.scope
  };
}
async function executeAuthCommand(command, env = process.env) {
  if (command.type === "auth-list") {
    const authConfig = await readAuthConfig(env);
    const brokerApiBaseUrl = getBrokerApiBaseUrl(env, authConfig);
    if (brokerApiBaseUrl) {
      process.stdout.write(`Hosted broker: ${brokerApiBaseUrl}
`);
    } else {
      const appSecret = await getAppClientSecret();
      const loginStatus = authConfig.credentials.clientId && appSecret ? "configured" : "missing";
      process.stdout.write(`App login: ${loginStatus}
`);
      process.stdout.write(`OAuth redirect URI: ${getRedirectUri(env)}
`);
    }
    const shops = Object.entries(authConfig.shops);
    if (shops.length === 0) {
      process.stdout.write("No authenticated shops have been stored yet.\n");
      return 0;
    }
    for (const [shop, profile] of shops) {
      const defaultMarker = authConfig.defaultShop === shop ? "* " : "  ";
      const method = profile.authMethod ? `  auth=${profile.authMethod}` : "";
      process.stdout.write(`${defaultMarker}${shop}  scopes=${formatScopeSummary(profile.scope)}${method}
`);
    }
    return 0;
  }
  if (command.type === "auth-use") {
    await setDefaultShop(command.shop, env);
    process.stdout.write(`Default shop set to ${command.shop}.
`);
    return 0;
  }
  if (command.type === "auth-remove") {
    const authConfig = await readAuthConfig(env);
    const profile = authConfig.shops[command.shop];
    const brokerApiBaseUrl = getBrokerApiBaseUrl(env, authConfig, profile);
    const storedToken = await getShopAccessToken(command.shop);
    if (storedToken && brokerApiBaseUrl && isBrokerProfile(profile)) {
      try {
        await revokeBrokerSession({
          apiBaseUrl: brokerApiBaseUrl,
          token: storedToken
        });
      } catch (error) {
        if (!shouldReauthenticate(error)) {
          throw error;
        }
      }
    }
    const updatedConfig = await removeShopProfile(command.shop, env);
    await deleteShopAccessToken(command.shop);
    await deleteClientSecret(command.shop);
    process.stdout.write(`Removed stored authentication for ${command.shop}.
`);
    if (updatedConfig.defaultShop) {
      process.stdout.write(`Current default shop: ${updatedConfig.defaultShop}
`);
    }
    return 0;
  }
  if (command.type === "auth-login") {
    const authConfig = await readAuthConfig(env);
    const shop = command.shop || authConfig.defaultShop;
    if (!shop) {
      throw new Error("No shop was selected. Run `theme-liquidate auth login --shop <store>` to open the Shopify login flow.");
    }
    const brokerApiBaseUrl = getBrokerApiBaseUrl(env, authConfig, authConfig.shops[shop]);
    if (brokerApiBaseUrl) {
      const authenticatedShop2 = await authenticateShopViaBroker(shop, authConfig, env);
      process.stdout.write(`Authenticated ${authenticatedShop2.shop} via hosted broker.
`);
      process.stdout.write(`Scopes: ${formatScopeSummary(authenticatedShop2.scope)}
`);
      return 0;
    }
    const authenticatedShop = await authenticateShop(shop, authConfig, env);
    process.stdout.write(`Authenticated ${authenticatedShop.shop}.
`);
    process.stdout.write(`Scopes: ${formatScopeSummary(authenticatedShop.scope)}
`);
    return 0;
  }
  if (command.type === "auth-logout") {
    const authConfig = await readAuthConfig(env);
    const brokerApiBaseUrl = getBrokerApiBaseUrl(env, authConfig);
    for (const shop of Object.keys(authConfig.shops)) {
      const profile = authConfig.shops[shop];
      const storedToken = await getShopAccessToken(shop);
      if (storedToken && brokerApiBaseUrl && isBrokerProfile(profile)) {
        try {
          await revokeBrokerSession({
            apiBaseUrl: brokerApiBaseUrl,
            token: storedToken
          });
        } catch (error) {
          if (!shouldReauthenticate(error)) {
            throw error;
          }
        }
      }
      await deleteShopAccessToken(shop);
      await deleteClientSecret(shop);
    }
    await deleteAppClientSecret();
    await clearBrokerApiBaseUrl(env);
    await clearGlobalCredentials(env);
    await writeAuthConfig(createEmptyAuthConfig(), env);
    process.stdout.write("Removed stored Shopify login data.\n");
    return 0;
  }
  throw new Error(`Unsupported command type: ${command.type}`);
}
function formatTopLevelError(error) {
  if (error instanceof ShopifyAuthError || error instanceof ShopifyOAuthError || error instanceof ShopifyApiError) {
    return `${error.message}${formatDetails(error)}`;
  }
  if (error.details?.length) {
    return `${error.message}${formatDetails(error)}`;
  }
  return error.message;
}

// src/index.js
async function main() {
  const parsedConfig = parseCliConfig();
  if (!parsedConfig.ok) {
    const output = parsedConfig.exitCode === 0 ? process.stdout : process.stderr;
    output.write(`${parsedConfig.message}
`);
    process.exit(parsedConfig.exitCode);
  }
  if (parsedConfig.command.type !== "run") {
    const exitCode2 = await executeAuthCommand(parsedConfig.command);
    process.exit(exitCode2);
  }
  const runtimeConfig = await resolveRunConfig(parsedConfig.command);
  const exitCode = await new Promise((resolve) => {
    let renderer;
    renderer = render(React2.createElement(App, {
      config: runtimeConfig,
      onComplete(code) {
        resolve(code);
        renderer.unmount();
      }
    }));
  });
  process.exit(exitCode);
}
main().catch((error) => {
  process.stderr.write(`${formatTopLevelError(error)}
`);
  process.exit(EXIT_FAILURE);
});
