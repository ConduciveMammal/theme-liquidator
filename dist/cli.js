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
  const endpoint = `https://${clientConfig.shop}/admin/api/${clientConfig.apiVersion}/graphql.json`;
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
async function deleteTheme(clientConfig, theme, fetchImpl = globalThis.fetch) {
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
    return {
      status: "failed",
      id: theme.id,
      name: theme.name,
      error: userErrors.map((error) => error.message).join("; "),
      fatal: false
    };
  }
  return {
    status: "deleted",
    id: payload.deletedThemeId ?? theme.id,
    name: theme.name,
    error: "",
    fatal: false
  };
}
function formatDeleteFailure(error, themeName) {
  if (error instanceof ShopifyApiError) {
    return [error.message, ...error.details].filter(Boolean).join(" ");
  }
  return `Unexpected error while deleting ${themeName}.`;
}
async function deleteThemesSequentially(clientConfig, themes, onProgress, fetchImpl = globalThis.fetch) {
  const results = [];
  for (const [index, theme] of themes.entries()) {
    onProgress?.(theme.id, "pending", "");
    try {
      const result = await deleteTheme(clientConfig, theme, fetchImpl);
      results.push(result);
      onProgress?.(theme.id, result.status, result.error);
    } catch (error) {
      const message = formatDeleteFailure(error, theme.name);
      const result = {
        status: "failed",
        id: theme.id,
        name: theme.name,
        error: message,
        fatal: error instanceof ShopifyApiError && error.code === "theme_delete_permission_denied"
      };
      results.push(result);
      onProgress?.(theme.id, result.status, result.error);
      if (error instanceof ShopifyApiError && error.code === "theme_delete_permission_denied") {
        for (const remainingTheme of themes.slice(index + 1)) {
          const remainingResult = {
            status: "failed",
            id: remainingTheme.id,
            name: remainingTheme.name,
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
function createSelectionState(themes) {
  const firstSelectableIndex = themes.findIndex((theme) => !getThemeAvailability(theme).disabled);
  return {
    cursor: firstSelectableIndex >= 0 ? firstSelectableIndex : 0,
    selectedIds: []
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
    status: "pending",
    error: ""
  }));
}
function updateDeleteResult(results, themeId, status, error = "") {
  return results.map((result) => result.id === themeId ? { ...result, status, error } : result);
}
function formatThemeMeta(theme) {
  const parts = [theme.role];
  if (theme.processing) {
    parts.push("Processing");
  }
  return parts.join(" \u2022 ");
}

// src/app.js
var h = React.createElement;
function renderShortcut(text) {
  return h(Text, { color: "gray" }, text);
}
function renderHeader(title, subtitle) {
  return h(
    Box,
    { flexDirection: "column", marginBottom: 1 },
    h(Text, { bold: true, color: "cyan" }, title),
    h(Text, { color: "gray" }, subtitle)
  );
}
function renderThemeLine(theme, index, cursor, selectedIds) {
  const isActive = cursor === index;
  const isSelected = selectedIds.includes(theme.id);
  const availability = getThemeAvailability(theme);
  const marker = availability.disabled ? "\xB7" : isSelected ? "\u25CF" : "\u25CB";
  const labelColor = availability.disabled ? "gray" : isActive ? "green" : "white";
  const metaSuffix = availability.disabled ? ` \u2022 ${availability.reason}` : "";
  return h(
    Text,
    {
      color: labelColor,
      inverse: isActive
    },
    `${marker} ${theme.name} (${formatThemeMeta(theme)}${metaSuffix})`
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
function App({ config, onComplete }) {
  const [stage, setStage] = useState(STAGE_LOADING);
  const [themes, setThemes] = useState([]);
  const [cursor, setCursor] = useState(0);
  const [selectedIds, setSelectedIds] = useState([]);
  const [confirmValue, setConfirmValue] = useState("");
  const [deleteResults, setDeleteResults] = useState([]);
  const [error, setError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    async function loadThemes() {
      try {
        const fetchedThemes = await fetchAllThemes(config);
        if (cancelled) {
          return;
        }
        const selectionState = createSelectionState(fetchedThemes);
        setThemes(fetchedThemes);
        setCursor(selectionState.cursor);
        setSelectedIds(selectionState.selectedIds);
        setStage(STAGE_SELECTION);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        process.stderr.write(`${getErrorLines(loadError).join("\n")}
`);
        onComplete(1);
      }
    }
    loadThemes();
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
      const results = await deleteThemesSequentially(config, selectedThemes, (themeId, status, message) => {
        if (cancelled) {
          return;
        }
        setDeleteResults((currentResults) => updateDeleteResult(currentResults, themeId, status, message));
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
  }, [config, selectedThemes, stage]);
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
        const availability = getThemeAvailability(theme);
        if (!availability.disabled) {
          setSelectedIds((currentSelectedIds) => toggleSelected(currentSelectedIds, theme.id));
        }
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
      renderHeader("theme-liquidate", "Fetching themes from Shopify Admin API..."),
      h(Text, null, `Store: ${config.shop}`)
    );
  }
  if (stage === STAGE_ERROR) {
    return h(
      Box,
      { flexDirection: "column" },
      renderHeader("Unable to load themes", "Press Enter, q, or Esc to exit."),
      ...getErrorLines(error).map((line, index) => h(Text, { key: `${line}-${index}`, color: index === 0 ? "red" : "gray" }, line))
    );
  }
  if (stage === STAGE_EMPTY) {
    return h(
      Box,
      { flexDirection: "column" },
      renderHeader("No themes selected", "Nothing will be deleted. Press Enter, q, or Esc to exit."),
      h(Text, { color: "gray" }, "Return to the checklist and select one or more themes if you want to continue in a later run.")
    );
  }
  if (stage === STAGE_REVIEW) {
    return h(
      Box,
      { flexDirection: "column" },
      renderHeader("Review selected themes", `Selected ${selectedThemes.length} theme(s). Press Enter to continue or Backspace to edit.`),
      ...selectedThemes.map((theme) => h(Text, { key: theme.id }, `\u2022 ${theme.name} (${theme.role})`)),
      h(Box, { marginTop: 1, flexDirection: "column" }, renderShortcut("Backspace: return to checklist"), renderShortcut("q / Esc: cancel"))
    );
  }
  if (stage === STAGE_CONFIRM) {
    return h(
      Box,
      { flexDirection: "column" },
      renderHeader("Danger zone", "Type DELETE exactly, then press Enter to start deleting themes."),
      h(Text, { color: "red" }, `You are about to delete ${selectedThemes.length} theme(s) from ${config.shop}.`),
      ...selectedThemes.map((theme) => h(Text, { key: theme.id }, `\u2022 ${theme.name} (${theme.role})`)),
      h(Box, { marginTop: 1 }, h(Text, null, "> "), h(Text, { color: isDeleteConfirmationValid(confirmValue) ? "green" : "yellow" }, confirmValue || "")),
      h(Box, { marginTop: 1, flexDirection: "column" }, renderShortcut("Backspace on empty input: return to review"), renderShortcut("q / Esc: cancel"))
    );
  }
  if (stage === STAGE_DELETING) {
    return h(
      Box,
      { flexDirection: "column" },
      renderHeader("Deleting themes", "Themes are deleted sequentially. Do not close the terminal until this completes."),
      ...renderResults(deleteResults)
    );
  }
  if (stage === STAGE_RESULT) {
    const failedCount = deleteResults.filter((result) => result.status === "failed").length;
    const deletedCount = deleteResults.filter((result) => result.status === "deleted").length;
    const summaryColor = failedCount > 0 ? "yellow" : "green";
    return h(
      Box,
      { flexDirection: "column" },
      renderHeader("Deletion complete", "Press Enter, q, or Esc to exit."),
      h(Text, { color: summaryColor }, `Deleted: ${deletedCount} \u2022 Failed: ${failedCount}`),
      ...renderResults(deleteResults)
    );
  }
  return h(
    Box,
    { flexDirection: "column" },
    renderHeader("Select themes to delete", "Use \u2191/\u2193 to move, Space to toggle, Enter to continue."),
    ...themes.length === 0 ? [h(Text, { key: "no-themes", color: "yellow" }, "No themes were returned by Shopify for this store.")] : themes.map((theme, index) => h(Box, { key: theme.id }, renderThemeLine(theme, index, cursor, selectedIds))),
    h(Box, { marginTop: 1, flexDirection: "column" }, renderShortcut("Space: select theme"), renderShortcut("Enter: review selection"), renderShortcut("q / Esc: cancel"))
  );
}

// src/config.js
import { parseArgs } from "node:util";
var DEFAULT_API_VERSION = "2026-01";
var HELP_TEXT = `
Usage:
  theme-liquidate [--shop <store-handle|store.myshopify.com|https://admin.shopify.com/store/store-handle>] [--api-version 2026-01]
  theme-liquidate auth login [--shop <store>]
  theme-liquidate auth list
  theme-liquidate auth use --shop <store>
  theme-liquidate auth remove --shop <store>
  theme-liquidate auth logout

Run command:
  Fetches themes for the selected shop and opens the interactive deletion UI.
  If the selected shop is not authenticated yet, it opens the Shopify login window,
  stores an offline Admin API token locally, then continues into the theme flow.
  If --shop is omitted, the default authenticated shop is used.
  Shopify app credentials must be available through stored login data or the
  SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET environment variables.

Auth options:
  --shop            Shopify store identifier, for example "example-store", "example-store.myshopify.com", or "https://admin.shopify.com/store/example-store"
  --api-version     Shopify Admin API version to use (default: ${DEFAULT_API_VERSION})
  --help, -h        Show this help message

Environment variables:
  SHOPIFY_STORE_DOMAIN
  SHOPIFY_API_VERSION
  SHOPIFY_CLIENT_ID
  SHOPIFY_CLIENT_SECRET
  SHOPIFY_OAUTH_REDIRECT_URI
  SHOPIFY_SCOPES
`.trim();
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
        "api-version": {
          type: "string"
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
  const apiVersion = (values["api-version"] ?? env.SHOPIFY_API_VERSION ?? DEFAULT_API_VERSION).trim();
  if (shop && !isValidShopDomain(shop)) {
    return invalidShopResult(shop);
  }
  if (!apiVersion) {
    return {
      ok: false,
      exitCode: 1,
      message: "Invalid API version. Provide a non-empty value for `--api-version` or `SHOPIFY_API_VERSION`."
    };
  }
  return {
    ok: true,
    command: {
      type: "run",
      shop,
      apiVersion
    }
  };
}

// src/auth-store.js
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
var APP_NAME = "shopify-liquidator";
var CONFIG_FILENAME = "config.json";
function getBaseConfigDir(env = process.env) {
  if (env.SHOPIFY_LIQUIDATOR_CONFIG_DIR) {
    return env.SHOPIFY_LIQUIDATOR_CONFIG_DIR;
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", APP_NAME);
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
    version: 2,
    credentials: {
      clientId: ""
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
      version: parsed.version ?? 2,
      credentials: {
        clientId: migratedClientId
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

// src/keychain.js
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var SERVICE_NAME = "shopify-liquidator";
var GLOBAL_ACCOUNT_NAME = "app::client-secret";
function getLegacyClientSecretAccountName(shop) {
  return `${shop}::client-secret`;
}
function getShopAccessTokenAccountName(shop) {
  return `${shop}::offline-token`;
}
function ensureDarwinSupport() {
  if (process.platform !== "darwin") {
    throw new Error("Secure credential storage currently supports macOS Keychain only.");
  }
}
async function setSecret(accountName, secret, execImpl = execFileAsync) {
  ensureDarwinSupport();
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
}
async function getSecret(accountName, execImpl = execFileAsync) {
  ensureDarwinSupport();
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
    if (error.code === 44) {
      return "";
    }
    throw error;
  }
}
async function deleteSecret(accountName, execImpl = execFileAsync) {
  ensureDarwinSupport();
  try {
    await execImpl("security", [
      "delete-generic-password",
      "-a",
      accountName,
      "-s",
      SERVICE_NAME
    ]);
  } catch (error) {
    if (error.code !== 44) {
      throw error;
    }
  }
}
async function getClientSecret(shop, execImpl = execFileAsync) {
  return getSecret(getLegacyClientSecretAccountName(shop), execImpl);
}
async function deleteClientSecret(shop, execImpl = execFileAsync) {
  return deleteSecret(getLegacyClientSecretAccountName(shop), execImpl);
}
async function setShopAccessToken(shop, token, execImpl = execFileAsync) {
  return setSecret(getShopAccessTokenAccountName(shop), token, execImpl);
}
async function getShopAccessToken(shop, execImpl = execFileAsync) {
  return getSecret(getShopAccessTokenAccountName(shop), execImpl);
}
async function deleteShopAccessToken(shop, execImpl = execFileAsync) {
  return deleteSecret(getShopAccessTokenAccountName(shop), execImpl);
}
async function setAppClientSecret(secret, execImpl = execFileAsync) {
  return setSecret(GLOBAL_ACCOUNT_NAME, secret, execImpl);
}
async function getAppClientSecret(execImpl = execFileAsync) {
  return getSecret(GLOBAL_ACCOUNT_NAME, execImpl);
}
async function deleteAppClientSecret(execImpl = execFileAsync) {
  return deleteSecret(GLOBAL_ACCOUNT_NAME, execImpl);
}

// src/oauth.js
import crypto from "node:crypto";
import { execFile as execFile2 } from "node:child_process";
import http from "node:http";
import { URL, URLSearchParams } from "node:url";
import { promisify as promisify2 } from "node:util";
var execFileAsync2 = promisify2(execFile2);
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
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
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
async function openBrowser(url, execImpl = execFileAsync2) {
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
  openBrowserImpl = openBrowser
} = {}) {
  if (!isValidShopDomain(shop)) {
    throw new ShopifyOAuthError(`Invalid shop identifier "${shop}".`);
  }
  const redirectUrl = new URL(redirectUri);
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
        const requestUrl = new URL(request.url, `${redirectUrl.protocol}//${redirectUrl.host}`);
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
        await openBrowserImpl(new URL(startPath, `${redirectUrl.protocol}//${redirectUrl.host}`).toString());
      } catch (error) {
        finish(reject, new ShopifyOAuthError(`Could not open the browser automatically. Open this URL manually: ${new URL(startPath, `${redirectUrl.protocol}//${redirectUrl.host}`).toString()}`));
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
async function validateStoredToken(shop, accessToken, apiVersion, env = process.env) {
  await requestGraphQL(
    {
      shop,
      token: accessToken,
      apiVersion
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
async function authenticateShop(shop, authConfig, apiVersion, env = process.env) {
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
  await validateStoredToken(shop, token.accessToken, apiVersion, env);
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
function shouldReauthenticate(error) {
  return error instanceof ShopifyApiError && [401, 403].includes(error.status);
}
async function resolveRunConfig(command, env = process.env) {
  const authConfig = await readAuthConfig(env);
  const shop = command.shop || authConfig.defaultShop;
  if (!shop) {
    throw new Error("No shop was selected. Run `theme-liquidate --shop <store>` to open the Shopify login flow.");
  }
  const storedAccessToken = await getShopAccessToken(shop);
  if (storedAccessToken) {
    try {
      await validateStoredToken(shop, storedAccessToken, command.apiVersion, env);
      return {
        shop,
        token: storedAccessToken,
        apiVersion: command.apiVersion
      };
    } catch (error) {
      if (!shouldReauthenticate(error)) {
        throw error;
      }
      process.stdout.write(`Stored authentication for ${shop} is no longer valid. Opening Shopify login again...
`);
    }
  }
  const authenticatedShop = await authenticateShop(shop, authConfig, command.apiVersion, env);
  return {
    shop: authenticatedShop.shop,
    token: authenticatedShop.accessToken,
    apiVersion: command.apiVersion
  };
}
async function executeAuthCommand(command, env = process.env) {
  if (command.type === "auth-list") {
    const authConfig = await readAuthConfig(env);
    const appSecret = await getAppClientSecret();
    const loginStatus = authConfig.credentials.clientId && appSecret ? "configured" : "missing";
    process.stdout.write(`App login: ${loginStatus}
`);
    process.stdout.write(`OAuth redirect URI: ${getRedirectUri(env)}
`);
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
    const authenticatedShop = await authenticateShop(shop, authConfig, DEFAULT_API_VERSION, env);
    process.stdout.write(`Authenticated ${authenticatedShop.shop}.
`);
    process.stdout.write(`Scopes: ${formatScopeSummary(authenticatedShop.scope)}
`);
    return 0;
  }
  if (command.type === "auth-logout") {
    const authConfig = await readAuthConfig(env);
    for (const shop of Object.keys(authConfig.shops)) {
      await deleteShopAccessToken(shop);
      await deleteClientSecret(shop);
    }
    await deleteAppClientSecret();
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
