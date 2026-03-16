import {EXIT_FAILURE, EXIT_SUCCESS} from './exit-codes.js';

export const STAGE_LOADING = 'loading';
export const STAGE_SELECTION = 'selection';
export const STAGE_EMPTY = 'empty';
export const STAGE_REVIEW = 'review';
export const STAGE_CONFIRM = 'confirm';
export const STAGE_DELETING = 'deleting';
export const STAGE_RESULT = 'result';
export const STAGE_ERROR = 'error';

export function getStageAfterSelection(selectedIds) {
	return selectedIds.length === 0 ? STAGE_EMPTY : STAGE_REVIEW;
}

export function isPreDeleteStage(stage) {
	return [
		STAGE_LOADING,
		STAGE_SELECTION,
		STAGE_EMPTY,
		STAGE_REVIEW,
		STAGE_CONFIRM,
		STAGE_ERROR
	].includes(stage);
}

export function isDeleteConfirmationValid(value) {
	return value === 'DELETE';
}

export function getResultExitCode(results) {
	return results.some((result) => result.status === 'failed') ? EXIT_FAILURE : EXIT_SUCCESS;
}
