import { describe, expect, it } from 'vitest';
import { NOT_SAVED_NOT_LINKED, requireUpdatedRows } from './requireUpdated';

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
