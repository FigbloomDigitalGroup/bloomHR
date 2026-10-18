import { describe, expect, it } from 'vitest';
import { payPeriodLabel } from './payPeriod';

describe('payPeriodLabel', () => {
  it('names the pay period month itself', () => {
    expect(payPeriodLabel('2026-10')).toBe('October 2026');
    expect(payPeriodLabel('2026-01')).toBe('January 2026');
    expect(payPeriodLabel('2026-12-01')).toBe('December 2026');
  });
  it('falls back when there is no usable period', () => {
    expect(payPeriodLabel(null)).toBe('N/A');
    expect(payPeriodLabel('')).toBe('N/A');
    expect(payPeriodLabel('2026-13')).toBe('N/A');
    expect(payPeriodLabel('soon', '-')).toBe('-');
  });
});
