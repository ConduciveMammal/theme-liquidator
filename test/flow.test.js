import test from 'node:test';
import assert from 'node:assert/strict';
import {
	STAGE_CONFIRM,
	STAGE_DELETING,
	STAGE_REVIEW,
	STAGE_SELECTION,
	getResultExitCode,
	getStageAfterSelection,
	isDeleteConfirmationValid,
	isPreDeleteStage
} from '../src/flow.js';

test('getStageAfterSelection returns empty when nothing is selected', () => {
	assert.equal(getStageAfterSelection([]), 'empty');
	assert.equal(getStageAfterSelection(['theme-1']), STAGE_REVIEW);
});

test('isDeleteConfirmationValid requires exact DELETE text', () => {
	assert.equal(isDeleteConfirmationValid('DELETE'), true);
	assert.equal(isDeleteConfirmationValid('delete'), false);
	assert.equal(isDeleteConfirmationValid('DELETE '), false);
});

test('isPreDeleteStage only allows cancellation before deletion begins', () => {
	assert.equal(isPreDeleteStage(STAGE_SELECTION), true);
	assert.equal(isPreDeleteStage(STAGE_REVIEW), true);
	assert.equal(isPreDeleteStage(STAGE_CONFIRM), true);
	assert.equal(isPreDeleteStage(STAGE_DELETING), false);
});

test('getResultExitCode returns failure when any delete failed', () => {
	assert.equal(getResultExitCode([{status: 'deleted'}]), 0);
	assert.equal(getResultExitCode([{status: 'failed'}]), 1);
});
