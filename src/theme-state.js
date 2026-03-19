export function getThemeAvailability(theme) {
	if (theme.role === 'MAIN') {
		return {
			disabled: true,
			reason: 'Live theme'
		};
	}

	if (theme.processing) {
		return {
			disabled: true,
			reason: 'Still processing'
		};
	}

	return {
		disabled: false,
		reason: ''
	};
}

export function createSelectionState(themes, preservedSelectedIds = []) {
	const selectedIds = preservedSelectedIds.filter((selectedId) => themes.some((theme) => theme.id === selectedId));
	const firstSelectedIndex = themes.findIndex((theme) => selectedIds.includes(theme.id));
	const firstSelectableIndex = themes.findIndex((theme) => !getThemeAvailability(theme).disabled);

	return {
		cursor: firstSelectedIndex >= 0 ? firstSelectedIndex : firstSelectableIndex >= 0 ? firstSelectableIndex : 0,
		selectedIds
	};
}

export function toggleSelected(selectedIds, themeId) {
	if (selectedIds.includes(themeId)) {
		return selectedIds.filter((selectedId) => selectedId !== themeId);
	}

	return [...selectedIds, themeId];
}

export function moveCursor(themes, currentIndex, direction) {
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

export function getSelectedThemes(themes, selectedIds) {
	return themes.filter((theme) => selectedIds.includes(theme.id));
}

export function createDeleteResults(themes) {
	return themes.map((theme) => ({
		id: theme.id,
		name: theme.name,
		role: theme.role,
		theme,
		status: 'pending',
		error: ''
	}));
}

export function updateDeleteResult(results, themeId, status, error = '') {
	return results.map((result) => (
		result.id === themeId
			? {...result, status, error}
			: result
	));
}

export function formatThemeMeta(theme) {
	const parts = [theme.role];

	if (theme.processing) {
		parts.push('Processing');
	}

	return parts.join(' • ');
}
