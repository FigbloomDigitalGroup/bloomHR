import { describe, expect, it } from 'vitest';
import { isHiddenModule } from './hiddenModules';

describe('isHiddenModule', () => {
  it('hides Expenses and nothing else', () => {
    expect(isHiddenModule('expenses')).toBe(true);
    expect(isHiddenModule('payroll')).toBe(false);
    expect(isHiddenModule(undefined)).toBe(false);
  });
});
