import { describe, expect, it } from 'vitest';
import { leaveDays } from './leaveDays';

describe('leaveDays', () => {
  it('counts both the first and the last day', () => {
    expect(leaveDays('2026-10-05', '2026-10-05')).toBe(1);
    expect(leaveDays('2026-10-05', '2026-10-07')).toBe(3);
  });

  it('is not thrown by a daylight-saving change or month end', () => {
    expect(leaveDays('2026-03-28', '2026-04-02')).toBe(6);
    expect(leaveDays('2026-12-30', '2027-01-02')).toBe(4);
  });

  it('is 0 when the end is before the start, instead of counting backwards', () => {
    expect(leaveDays('2026-10-07', '2026-10-05')).toBe(0);
  });

  it('is 0 while either date is missing or unreadable', () => {
    expect(leaveDays('', '2026-10-05')).toBe(0);
    expect(leaveDays('2026-10-05', '')).toBe(0);
    expect(leaveDays(null, undefined)).toBe(0);
    expect(leaveDays('soon', 'later')).toBe(0);
  });
});
