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

function renderShortcut(text) {
	return h(Text, {color: 'gray'}, text);
}

function renderHeader(title, subtitle) {
	return h(
		Box,
		{flexDirection: 'column', marginBottom: 1},
		h(Text, {bold: true, color: 'cyan'}, title),
		h(Text, {color: 'gray'}, subtitle)
	);
}

function renderThemeLine(theme, index, cursor, selectedIds) {
	const isActive = cursor === index;
	const isSelected = selectedIds.includes(theme.id);
	const availability = getThemeAvailability(theme);
	const marker = availability.disabled ? '·' : isSelected ? '●' : '○';
	const labelColor = availability.disabled ? 'gray' : isActive ? 'green' : 'white';
	const metaSuffix = availability.disabled ? ` • ${availability.reason}` : '';

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

export function App({config, onComplete}) {
	const [stage, setStage] = useState(STAGE_LOADING);
	const [themes, setThemes] = useState([]);
	const [cursor, setCursor] = useState(0);
	const [selectedIds, setSelectedIds] = useState([]);
	const [confirmValue, setConfirmValue] = useState('');
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

				process.stderr.write(`${getErrorLines(loadError).join('\n')}\n`);
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
	}, [config, selectedThemes, stage]);

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
			renderHeader('theme-liquidate', 'Fetching themes from Shopify Admin API...'),
			h(Text, null, `Store: ${config.shop}`)
		);
	}

	if (stage === STAGE_ERROR) {
		return h(
			Box,
			{flexDirection: 'column'},
			renderHeader('Unable to load themes', 'Press Enter, q, or Esc to exit.'),
			...getErrorLines(error).map((line, index) => h(Text, {key: `${line}-${index}`, color: index === 0 ? 'red' : 'gray'}, line))
		);
	}

	if (stage === STAGE_EMPTY) {
		return h(
			Box,
			{flexDirection: 'column'},
			renderHeader('No themes selected', 'Nothing will be deleted. Press Enter, q, or Esc to exit.'),
			h(Text, {color: 'gray'}, 'Return to the checklist and select one or more themes if you want to continue in a later run.')
		);
	}

	if (stage === STAGE_REVIEW) {
		return h(
			Box,
			{flexDirection: 'column'},
			renderHeader('Review selected themes', `Selected ${selectedThemes.length} theme(s). Press Enter to continue or Backspace to edit.`),
			...selectedThemes.map((theme) => h(Text, {key: theme.id}, `• ${theme.name} (${theme.role})`)),
			h(Box, {marginTop: 1, flexDirection: 'column'}, renderShortcut('Backspace: return to checklist'), renderShortcut('q / Esc: cancel'))
		);
	}

	if (stage === STAGE_CONFIRM) {
		return h(
			Box,
			{flexDirection: 'column'},
			renderHeader('Danger zone', 'Type DELETE exactly, then press Enter to start deleting themes.'),
			h(Text, {color: 'red'}, `You are about to delete ${selectedThemes.length} theme(s) from ${config.shop}.`),
			...selectedThemes.map((theme) => h(Text, {key: theme.id}, `• ${theme.name} (${theme.role})`)),
			h(Box, {marginTop: 1}, h(Text, null, '> '), h(Text, {color: isDeleteConfirmationValid(confirmValue) ? 'green' : 'yellow'}, confirmValue || '')),
			h(Box, {marginTop: 1, flexDirection: 'column'}, renderShortcut('Backspace on empty input: return to review'), renderShortcut('q / Esc: cancel'))
		);
	}

	if (stage === STAGE_DELETING) {
		return h(
			Box,
			{flexDirection: 'column'},
			renderHeader('Deleting themes', 'Themes are deleted sequentially. Do not close the terminal until this completes.'),
			...renderResults(deleteResults)
		);
	}

	if (stage === STAGE_RESULT) {
		const failedCount = deleteResults.filter((result) => result.status === 'failed').length;
		const deletedCount = deleteResults.filter((result) => result.status === 'deleted').length;
		const summaryColor = failedCount > 0 ? 'yellow' : 'green';

		return h(
			Box,
			{flexDirection: 'column'},
			renderHeader('Deletion complete', 'Press Enter, q, or Esc to exit.'),
			h(Text, {color: summaryColor}, `Deleted: ${deletedCount} • Failed: ${failedCount}`),
			...renderResults(deleteResults)
		);
	}

	return h(
		Box,
		{flexDirection: 'column'},
		renderHeader('Select themes to delete', 'Use ↑/↓ to move, Space to toggle, Enter to continue.'),
		...(themes.length === 0
			? [h(Text, {key: 'no-themes', color: 'yellow'}, 'No themes were returned by Shopify for this store.')]
			: themes.map((theme, index) => h(Box, {key: theme.id}, renderThemeLine(theme, index, cursor, selectedIds)))),
		h(Box, {marginTop: 1, flexDirection: 'column'}, renderShortcut('Space: select theme'), renderShortcut('Enter: review selection'), renderShortcut('q / Esc: cancel'))
	);
}
