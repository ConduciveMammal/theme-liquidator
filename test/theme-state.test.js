import test from 'node:test';
import assert from 'node:assert/strict';
import {
	createDeleteResults,
	createSelectionState,
	formatThemeMeta,
	getSelectedThemes,
	getThemeAvailability,
	toggleSelected,
	updateDeleteResult
} from '../src/theme-state.js';

test('getThemeAvailability disables live and processing themes', () => {
	assert.deepEqual(getThemeAvailability({role: 'MAIN', processing: false}), {
		disabled: true,
		reason: 'Live theme'
	});
	assert.deepEqual(getThemeAvailability({role: 'UNPUBLISHED', processing: true}), {
		disabled: true,
		reason: 'Still processing'
	});
	assert.deepEqual(getThemeAvailability({role: 'UNPUBLISHED', processing: false}), {
		disabled: false,
		reason: ''
	});
});

test('createSelectionState starts on the first selectable theme', () => {
	const result = createSelectionState([
		{id: '1', role: 'MAIN', processing: false},
		{id: '2', role: 'UNPUBLISHED', processing: false}
	]);

	assert.equal(result.cursor, 1);
	assert.deepEqual(result.selectedIds, []);
});

test('createSelectionState preserves still-valid selections and moves cursor to the first selected theme', () => {
	const result = createSelectionState([
		{id: '1', role: 'UNPUBLISHED', processing: false},
		{id: '2', role: 'UNPUBLISHED', processing: false},
		{id: '3', role: 'UNPUBLISHED', processing: false}
	], ['2', 'missing']);

	assert.equal(result.cursor, 1);
	assert.deepEqual(result.selectedIds, ['2']);
});

test('toggleSelected adds and removes ids', () => {
	assert.deepEqual(toggleSelected([], '1'), ['1']);
	assert.deepEqual(toggleSelected(['1'], '1'), []);
});

test('getSelectedThemes preserves the matching theme objects', () => {
	const themes = [
		{id: '1', name: 'Alpha'},
		{id: '2', name: 'Beta'}
	];

	assert.deepEqual(getSelectedThemes(themes, ['2']), [{id: '2', name: 'Beta'}]);
});

test('delete result helpers track progress and errors', () => {
	const theme = {id: '1', name: 'Alpha', role: 'UNPUBLISHED'};
	const results = createDeleteResults([theme]);
	const updatedResults = updateDeleteResult(results, '1', 'failed', 'Oops');

	assert.equal(formatThemeMeta({role: 'UNPUBLISHED', processing: true}), 'UNPUBLISHED • Processing');
	assert.deepEqual(updatedResults, [
		{id: '1', name: 'Alpha', role: 'UNPUBLISHED', theme, status: 'failed', error: 'Oops'}
	]);
});
