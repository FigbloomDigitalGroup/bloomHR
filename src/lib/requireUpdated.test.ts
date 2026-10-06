import { describe, expect, it } from 'vitest';
import { NOT_SAVED_NOT_LINKED, requireUpdatedRows, saveFailureMessage } from './requireUpdated';

describe('requireUpdatedRows', () => {
  it('returns the updated rows when something was saved', () => {
    const rows = [{ 'Employee Number': 'E1' }];
    expect(requireUpdatedRows(rows, 'x')).toBe(rows);
  });

  it('turns "no row matched" into an error with the given message, instead of looking like a save', () => {
    expect(() => requireUpdatedRows([], NOT_SAVED_NOT_LINKED)).toThrow(/not linked/);
    expect(() => requireUpdatedRows(null, 'nothing saved')).toThrow('nothing saved');
    expect(() => requireUpdatedRows(undefined, 'nothing saved')).toThrow('nothing saved');
  });
});

describe('saveFailureMessage', () => {
  it('shows the explanation when nothing was saved, and the general message for any other failure', () => {
    let thrown: unknown;
    try {
      requireUpdatedRows([], NOT_SAVED_NOT_LINKED);
    } catch (e) {
      thrown = e;
    }
    expect(saveFailureMessage(thrown, 'Failed to save')).toBe(NOT_SAVED_NOT_LINKED);
    expect(saveFailureMessage(new Error('network down'), 'Failed to save')).toBe('Failed to save');
    expect(saveFailureMessage({ message: 'x' }, 'Failed to save')).toBe('Failed to save');
  });
});
