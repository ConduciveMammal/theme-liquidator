import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {
	STAGE_CONFIRM,
	STAGE_DELETING,
	STAGE_EMPTY,
	STAGE_ERROR,
	STAGE_LOADING,
	STAGE_REVIEW,
	STAGE_RESULT,
	STAGE_SELECTION,
	getResultExitCode,
	getStageAfterSelection,
	isDeleteConfirmationValid
} from './flow.js';
import {EXIT_CANCELLED, EXIT_SUCCESS} from './exit-codes.js';
import {deleteThemesSequentially, fetchAllThemes, ShopifyApiError, THEME_DELETE_EXEMPTION_URL} from './shopify.js';
import {
	createDeleteResults,
	createSelectionState,
	formatThemeMeta,
	getSelectedThemes,
	getThemeAvailability,
	moveCursor,
	toggleSelected,
	updateDeleteResult
} from './theme-state.js';

const h = React.createElement;
const DELETE_MODE_DRY_RUN = 'dry-run';
const DELETE_MODE_REAL = 'delete';
const ASCII_ART_TITLE = String.raw` /$$       /$$                     /$$       /$$             /$$
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

function renderShortcut(text) {
	return h(Text, {color: 'gray'}, text);
}

function renderShortcutKey(text) {
	return h(Text, {bold: true, color: 'cyan'}, text);
}

function extractThemeId(value) {
	if (!value) {
		return '';
	}

	const match = String(value).match(/\/(\d+)$/);
	return match ? match[1] : String(value);
}

function formatThemeUpdatedAt(updatedAt) {
	if (!updatedAt) {
		return 'Unknown';
	}

	const parsedDate = new Date(updatedAt);

	if (Number.isNaN(parsedDate.getTime())) {
		return 'Unknown';
	}

	return new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short'
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
		h(Text, {color: 'gray'}, ` ${label}`)
	);
}

function renderCommandBar(commands) {
	return h(
		Box,
		{
			borderStyle: 'round',
			borderColor: 'gray',
			paddingX: 1,
			marginTop: 1,
			flexWrap: 'wrap'
		},
		...commands.map((command, index) => renderCommandChip(command.shortcut, command.label, `${command.shortcut}-${index}`))
	);
}

function renderPanel(title, children, options = {}) {
	return h(
		Box,
		{
			flexDirection: 'column',
			borderStyle: 'round',
			borderColor: options.borderColor ?? 'gray',
			paddingX: 1,
			paddingY: 0,
			marginTop: options.marginTop ?? 1
		},
		h(Text, {bold: true, color: options.titleColor ?? 'white'}, title),
		h(Box, {flexDirection: 'column', marginTop: 1}, ...children)
	);
}

function renderDryRunNotice() {
	return renderPanel('Dry run', [
		h(Text, {bold: true, color: 'cyan'}, 'This is a dry run. No themes will be deleted.'),
		h(Text, {color: 'gray'}, 'You are only previewing the shortlist and its impact before any real deletion is run.')
	], {
		borderColor: 'cyan',
		titleColor: 'cyan'
	});
}

function renderModeBadge(config) {
	const badges = [];

	if (config.dry) {
		badges.push(h(Text, {key: 'dry', bold: true, color: 'cyan'}, 'Dry run'));
	}

	if (config.verbose) {
		badges.push(h(Text, {key: 'verbose', bold: true, color: 'yellow'}, 'Verbose'));
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
      h(Text, { bold: true, color: "#63F44C" }, ASCII_ART_TITLE),
    ),
    h(
      Box,
      { flexWrap: "wrap", marginTop: 2, alignItems: "center" },
      renderShopHandleText(config),
      ...renderModeBadge(config).flatMap((badge, index) => [
        h(Text, { key: `spacer-${index}`, color: "gray" }, "  "),
        badge,
      ]),
    ),
    h(Box, { marginTop: 1 }, h(Text, { bold: true, color: "cyan" }, title)),
    h(Text, { color: "gray" }, subtitle),
  );
}

function renderShopHandleText(config) {
	return h(Text, {bold: true, underline: true, color: 'yellow'}, config.shopHandle ?? config.shop);
}

function renderOpeningSummary(config, themes, selectedIds, deleteMode, hiddenThemeCount) {
	const modeLabel = deleteMode === DELETE_MODE_DRY_RUN ? 'Dry run mode' : 'Live deletion mode';
	const modeDescription = deleteMode === DELETE_MODE_DRY_RUN
		? 'Selections are simulated first, so you can review the impact before running a real deletion.'
		: 'Selected themes can be permanently removed after you confirm with DELETE.';

	return renderPanel('Overview', [
		h(Text, {color: 'white'},
			'Review the deletable themes in ',
			renderShopHandleText(config),
			', choose the ones you no longer need, and build a shortlist of themes to delete.\n'
		),
		h(Text, {color: 'gray'}, hiddenThemeCount > 0
			? 'Live and processing themes are protected and hidden from this list.\n'
			: 'Only deletable themes are shown in this list.'),
		h(Text, {color: deleteMode === DELETE_MODE_DRY_RUN ? 'cyan' : 'yellow'}, `${modeLabel}: ${modeDescription}`),
		h(Box, {marginTop: 1, flexDirection: 'column'}, h(Text, {color: 'cyan'}, `Deletable themes shown: ${themes.length}`), h(Text, {color: selectedIds.length > 0 ? 'cyan' : 'gray'}, `Selected: ${selectedIds.length}`))
	], {
		borderColor: deleteMode === DELETE_MODE_DRY_RUN ? 'cyan' : 'yellow',
		titleColor: deleteMode === DELETE_MODE_DRY_RUN ? 'cyan' : 'yellow'
	});
}

function renderThemeLine(theme, index, cursor, selectedIds) {
	const isActive = cursor === index;
	const isSelected = selectedIds.includes(theme.id);
	const marker = isSelected && isActive ? '◉' : isSelected || isActive ? '●' : '○';
	const markerColor = isSelected ? 'red' : isActive ? 'green' : 'white';
	const labelColor = 'white';
	const updatedLabel = `Last updated: ${formatThemeUpdatedAt(theme.updatedAt)}`;

	return h(
		Box,
		{flexDirection: 'row'},
		h(
			Text,
			{color: markerColor},
			`${marker} `
		),
		h(
			Box,
			{marginLeft: 0},
			h(Text, {color: labelColor}, theme.name),
			h(Text, {color: 'gray'}, ` • ${updatedLabel}`)
		)
	);
}

function renderResults(results) {
	return results.flatMap((result) => {
		const color = result.status === 'deleted'
			? 'green'
			: result.status === 'failed'
				? 'red'
				: 'yellow';
		const entries = [
			h(Text, {key: `${result.id}-status`, color}, `${result.status.toUpperCase()} ${result.name}`)
		];

		if (result.error) {
			entries.push(
				h(Text, {key: `${result.id}-error`, color: 'gray'}, `  ${result.error}`)
			);
		}

		return entries;
	});
}

function renderThemeObject(theme, keyPrefix) {
	return JSON.stringify(theme, null, 2)
		.split('\n')
		.map((line, index) => h(Text, {key: `${keyPrefix}-theme-${index}`, color: 'gray'}, `  ${line}`));
}

function renderResultGroup(title, color, results, verbose = false) {
	if (results.length === 0) {
		return [];
	}

	return [
		h(Text, {key: `${title}-heading`, bold: true, color}, title),
		...results.flatMap((result) => {
			const lines = [
				h(Text, {key: result.id, color}, `  ${result.name} (${extractThemeId(result.id)})`)
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
	const failedCount = results.filter((result) => result.status === 'failed').length;
	const deletedCount = results.filter((result) => result.status === 'deleted').length;
	const lines = [
		'Deletion failed',
		`Deleted: ${deletedCount} • Failed: ${failedCount}`
	];

	for (const result of results) {
		lines.push(`${result.status.toUpperCase()} ${result.name}`);

		if (result.error) {
			lines.push(`  ${result.error}`);
		}
	}

	if (results.some((result) => result.error?.includes('Theme modification exemption required.'))) {
		lines.push(`Apply for exemption: ${THEME_DELETE_EXEMPTION_URL}`);
	}

	return lines.join('\n');
}

function getCompletionCopy(results, shop, deleteMode) {
	const failedCount = results.filter((result) => result.status === 'failed').length;
	const completedCount = results.filter((result) => ['deleted', 'simulated'].includes(result.status)).length;

	if (deleteMode === DELETE_MODE_DRY_RUN) {
		return {
			title: 'Dry run complete',
			subtitle: `${completedCount} theme(s) would be removed from ${shop}.`,
			summary: failedCount === 0
				? `Simulated ${completedCount} theme delete operation(s). No failures reported.`
				: `Simulated ${completedCount} theme delete operation(s); ${failedCount} failed.`,
			summaryColor: failedCount > 0 ? 'yellow' : 'cyan'
		};
	}

	if (failedCount === 0) {
		return {
			title: 'Deletion complete',
			subtitle: `${completedCount} theme(s) removed from ${shop}.`,
			summary: `Deleted ${completedCount} theme(s). No failures reported.`,
			summaryColor: 'green'
		};
	}

	return {
		title: 'Deletion finished with issues',
		subtitle: `Deleted ${completedCount} theme(s); ${failedCount} failed.`,
		summary: 'Review the failed deletions before rerunning the command.',
		summaryColor: 'yellow'
	};
}

export function App({config, onComplete}) {
	const defaultDeleteMode = config.dry ? DELETE_MODE_DRY_RUN : DELETE_MODE_REAL;
	const [stage, setStage] = useState(STAGE_LOADING);
	const [themes, setThemes] = useState([]);
	const [hiddenThemeCount, setHiddenThemeCount] = useState(0);
	const [cursor, setCursor] = useState(0);
	const [selectedIds, setSelectedIds] = useState([]);
	const [confirmValue, setConfirmValue] = useState('');
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
		setConfirmValue('');
		setDeleteResults([]);
		setError(null);
		setDeleteMode(defaultDeleteMode);
		setStage(deletableThemes.length === 0 ? STAGE_EMPTY : STAGE_SELECTION);
	}

	async function loadThemes(preservedSelectedIds = []) {
		const fetchedThemes = await fetchAllThemes(config);
		applyThemeSelectionState(fetchedThemes, preservedSelectedIds);
	}

	useEffect(() => {
		let cancelled = false;

		async function initialiseThemes() {
			try {
				const fetchedThemes = await fetchAllThemes(config);

				if (cancelled) {
					return;
				}

				applyThemeSelectionState(fetchedThemes);
			} catch (loadError) {
				if (cancelled) {
					return;
				}

				process.stderr.write(`${getErrorLines(loadError).join('\n')}\n`);
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
			return undefined;
		}

		let cancelled = false;
		setDeleteResults(createDeleteResults(selectedThemes));

		async function deleteSelectedThemes() {
			const results = await deleteThemesSequentially(config, selectedThemes, (themeId, status, message) => {
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
				process.stderr.write(`${formatFatalDeleteSummary(results)}\n`);
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
		if (key.ctrl && input === 'c') {
			onComplete(stage === STAGE_RESULT ? getResultExitCode(deleteResults) : EXIT_CANCELLED);
			return;
		}

		if (stage === STAGE_LOADING || stage === STAGE_DELETING) {
			return;
		}

		if (stage === STAGE_ERROR) {
			if (key.return || input === 'q' || key.escape) {
				onComplete(1);
			}

			return;
		}

		if (stage === STAGE_EMPTY) {
			if (key.return || input === 'q' || key.escape) {
				onComplete(EXIT_SUCCESS);
			}

			return;
		}

		if (stage === STAGE_RESULT) {
			const completedCount = deleteResults.filter((result) => ['deleted', 'simulated'].includes(result.status)).length;
			const remainingSelectableCount = Math.max(
				themes.length - completedCount,
				0
			);

			if ((input === 'd' || input === 'D') && deleteMode === DELETE_MODE_DRY_RUN && completedCount > 0) {
				setDeleteMode(DELETE_MODE_REAL);
				setConfirmValue('');
				setDeleteResults([]);
				setStage(STAGE_CONFIRM);
				return;
			}

			if ((input === 'm' || input === 'M') && remainingSelectableCount > 0) {
				setStage(STAGE_LOADING);
				setError(null);
				loadThemes(selectedIds).catch((loadError) => {
					process.stderr.write(`${getErrorLines(loadError).join('\n')}\n`);
					onComplete(1);
				});
				return;
			}

			if (key.return || input === 'q' || key.escape) {
				onComplete(getResultExitCode(deleteResults));
			}

			return;
		}

		if (input === 'q' || key.escape) {
			onComplete(EXIT_CANCELLED);
			return;
		}

		if (stage === STAGE_SELECTION) {
			if (key.upArrow || input === 'k') {
				setCursor((currentCursor) => moveCursor(themes, currentCursor, -1));
				return;
			}

			if (key.downArrow || input === 'j') {
				setCursor((currentCursor) => moveCursor(themes, currentCursor, 1));
				return;
			}

			if (input === ' ') {
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
				setConfirmValue('');
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
			{flexDirection: 'column'},
			renderHeader(config, 'Loading themes', 'Fetching themes from Shopify Admin API...'),
			h(Text, null, `Store: ${config.shop}`)
		);
	}

	if (stage === STAGE_ERROR) {
		return h(
			Box,
			{flexDirection: 'column'},
			renderHeader(config, 'Unable to load themes', 'The Shopify response could not be loaded.'),
			renderPanel(
				'Error',
				getErrorLines(error).map((line, index) => h(Text, {key: `${line}-${index}`, color: index === 0 ? 'red' : 'gray'}, line)),
				{borderColor: 'red', titleColor: 'red'}
			),
			renderCommandBar([
				{shortcut: 'Enter', label: 'exit'},
				{shortcut: 'q', label: 'exit'},
				{shortcut: 'Esc', label: 'exit'}
			])
		);
	}

	if (stage === STAGE_EMPTY) {
		return h(
			Box,
			{flexDirection: 'column'},
			renderHeader(config, 'No deletable themes available', 'There are no themes in this store that this tool can safely offer for deletion.'),
			renderPanel('Status', [
				h(Text, {color: 'gray'}, hiddenThemeCount > 0
					? `All ${hiddenThemeCount} theme(s) are protected because they are live or still processing.`
					: 'No deletable themes were returned by Shopify for this store.')
			]),
			renderCommandBar([
				{shortcut: 'Enter', label: 'exit'},
				{shortcut: 'q', label: 'exit'},
				{shortcut: 'Esc', label: 'exit'}
			])
		);
	}

	if (stage === STAGE_REVIEW) {
		return h(
			Box,
			{flexDirection: 'column'},
			renderHeader(config, 'Review selected themes', `Selected ${selectedThemes.length} theme(s). Confirm the shortlist before continuing.`),
			...(deleteMode === DELETE_MODE_DRY_RUN ? [renderDryRunNotice()] : []),
			renderPanel(
				'Selected themes',
				selectedThemes.map((theme) => h(Text, {key: theme.id}, `• ${theme.name}`))
			),
			renderCommandBar([
				{shortcut: 'Enter', label: 'continue'},
				{shortcut: 'Backspace', label: 'edit selection'},
				{shortcut: 'q', label: 'cancel'},
				{shortcut: 'Esc', label: 'cancel'}
			])
		);
	}

	if (stage === STAGE_CONFIRM) {
		const isDryRun = deleteMode === DELETE_MODE_DRY_RUN;

		return h(
			Box,
			{flexDirection: 'column'},
			renderHeader(
				config,
				isDryRun ? 'Dry run' : 'Danger zone',
				isDryRun
					? 'Type DELETE exactly, then press Enter to simulate deleting these themes.'
					: 'Type DELETE exactly, then press Enter to start deleting themes.'
			),
			...(isDryRun ? [renderDryRunNotice()] : []),
			renderPanel(
				isDryRun ? 'Simulation summary' : 'Deletion summary',
					[
						h(Text, {color: isDryRun ? 'cyan' : 'red'}, isDryRun
							? `You are about to simulate deleting ${selectedThemes.length} theme(s) from ${config.shop}.`
							: `You are about to delete ${selectedThemes.length} theme(s) from ${config.shop}.`),
						...selectedThemes.map((theme) => h(Text, {key: theme.id}, `• ${theme.name}`))
					],
				{borderColor: isDryRun ? 'cyan' : 'red', titleColor: isDryRun ? 'cyan' : 'red'}
			),
			renderPanel('Confirmation', [
				h(Box, null, h(Text, {color: 'gray'}, '> '), h(Text, {color: isDeleteConfirmationValid(confirmValue) ? 'green' : 'yellow'}, confirmValue || ''))
			], {borderColor: isDeleteConfirmationValid(confirmValue) ? 'green' : 'yellow', titleColor: isDeleteConfirmationValid(confirmValue) ? 'green' : 'yellow'}),
			renderCommandBar([
				{shortcut: 'Enter', label: 'confirm'},
				{shortcut: 'Backspace', label: 'return to review'},
				{shortcut: 'q', label: 'cancel'},
				{shortcut: 'Esc', label: 'cancel'}
			])
		);
	}

	if (stage === STAGE_DELETING) {
		const isDryRun = deleteMode === DELETE_MODE_DRY_RUN;

		return h(
			Box,
			{flexDirection: 'column'},
			renderHeader(
				config,
				isDryRun ? 'Simulating theme deletion' : 'Deleting themes',
				isDryRun
					? 'This preview does not send the Shopify delete mutation.'
					: 'Themes are deleted sequentially. Do not close the terminal until this completes.'
			),
			renderPanel('Progress', renderResults(deleteResults), {
				borderColor: isDryRun ? 'cyan' : 'yellow',
				titleColor: isDryRun ? 'cyan' : 'yellow'
			})
		);
	}

	if (stage === STAGE_RESULT) {
		const failedCount = deleteResults.filter((result) => result.status === 'failed').length;
		const deletedCount = deleteResults.filter((result) => ['deleted', 'simulated'].includes(result.status)).length;
		const deletedResults = deleteResults.filter((result) => ['deleted', 'simulated'].includes(result.status));
		const failedResults = deleteResults.filter((result) => result.status === 'failed');
		const skippedResults = deleteResults.filter((result) => !['deleted', 'simulated', 'failed'].includes(result.status));
		const completionCopy = getCompletionCopy(deleteResults, config.shop, deleteMode);
		const remainingCount = Math.max(themes.length - deletedCount, 0);
		const remainingSelectableCount = Math.max(
			themes.filter((theme) => !getThemeAvailability(theme).disabled).length - deletedCount,
			0
		);

		return h(
			Box,
			{flexDirection: 'column'},
			renderHeader(config, completionCopy.title, completionCopy.subtitle),
			h(Text, {color: completionCopy.summaryColor}, completionCopy.summary),
			renderPanel('Outcome', [
				h(Text, {bold: true}, 'Outcome'),
				h(Text, {color: deletedCount > 0 ? completionCopy.summaryColor : 'gray'}, `${deleteMode === DELETE_MODE_DRY_RUN ? 'Would delete' : 'Deleted'}: ${deletedCount}`),
				h(Text, {color: failedCount > 0 ? 'red' : 'gray'}, `Failed: ${failedCount}`),
				h(Text, {color: remainingCount > 0 ? 'cyan' : 'gray'}, `Remaining themes: ${remainingCount}`)
			], {borderColor: completionCopy.summaryColor, titleColor: completionCopy.summaryColor}),
			renderPanel('Results', [
				...renderResultGroup(deleteMode === DELETE_MODE_DRY_RUN ? 'Themes ready to delete' : 'Deleted themes', deleteMode === DELETE_MODE_DRY_RUN ? 'cyan' : 'green', deletedResults, config.verbose),
				...renderResultGroup('Failed themes', 'red', failedResults, config.verbose),
				...renderResultGroup('Other results', 'yellow', skippedResults, config.verbose)
			]),
			renderCommandBar([
				...(deleteMode === DELETE_MODE_DRY_RUN && deletedCount > 0 ? [{shortcut: 'D', label: 'run the real deletion'}] : []),
				...(remainingSelectableCount > 0 ? [{shortcut: 'M', label: 'select more themes'}] : []),
				{shortcut: 'Enter', label: 'exit'},
				{shortcut: 'q', label: 'exit'},
				{shortcut: 'Esc', label: 'exit'}
			])
		);
	}

	return h(
		Box,
		{flexDirection: 'column'},
		renderHeader(config, 'Select themes to delete', 'Inspect the store, understand what is protected, then choose the themes you want to review for deletion.'),
		renderOpeningSummary(config, themes, selectedIds, deleteMode, hiddenThemeCount),
		renderPanel(
			`Themes (${themes.length})`,
			themes.length === 0
				? [h(Text, {key: 'no-themes', color: 'yellow'}, 'No themes were returned by Shopify for this store.')]
				: themes.map((theme, index) => h(Box, {key: theme.id}, renderThemeLine(theme, index, cursor, selectedIds))),
			{borderColor: 'green', titleColor: 'green'}
		),
		renderPanel('Selection', [
			h(Text, {color: 'cyan'}, `Selected now: ${selectedIds.length}`),
			h(Text, {color: 'gray'}, `Available to delete: ${themes.length}`),
			h(Text, {color: 'gray'}, 'Press Enter when your shortlist is ready for review.')
		], {titleColor: 'cyan'}),
		renderCommandBar([
			{shortcut: '↑/↓', label: 'move'},
			{shortcut: 'Space', label: 'toggle'},
			{shortcut: 'Enter', label: 'review'},
			{shortcut: 'Esc/q', label: 'cancel'}
		])
	);
}
