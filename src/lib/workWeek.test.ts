import { describe, expect, it } from 'vitest';
import { daysPerWeek, describeWorkWeek, toWorkWeek, workWeekError } from './workWeek';

describe('toWorkWeek', () => {
  it('reads a saved week, numbers or strings, and refuses anything else', () => {
    expect(toWorkWeek([1, 1, 1, 1, 1, 0, 0])).toEqual([1, 1, 1, 1, 1, 0, 0]);
    expect(toWorkWeek(['1', '1', '1', '1', '1', '0.5', '0'])).toEqual([1, 1, 1, 1, 1, 0.5, 0]);
    expect(toWorkWeek([1, 1, 1, 1, 1, 1])).toBeNull();
    expect(toWorkWeek([1, 1, 1, 1, 0.3, 0, 0])).toBeNull();
    expect(toWorkWeek(null)).toBeNull();
  });
});

describe('describing a week', () => {
  it('names the span, the half days and the count', () => {
    expect(describeWorkWeek([1, 1, 1, 1, 1, 0, 0])).toBe('Mon–Fri');
    expect(describeWorkWeek([1, 1, 1, 1, 1, 0.5, 0])).toBe('Mon–Sat (Sat half)');
    expect(describeWorkWeek([1, 1, 0, 1, 0, 0, 0])).toBe('Mon, Tue, Thu');
    expect(daysPerWeek([1, 1, 1, 1, 1, 0.5, 0])).toBe(5.5);
    expect(daysPerWeek([1, 1, 1, 1, 0, 0, 0])).toBe(4);
  });

  it('needs at least one working day', () => {
    expect(workWeekError([0, 0, 0, 0, 0, 0, 0])).toBe('Choose at least one working day');
    expect(workWeekError([0, 0, 0, 0, 0, 0.5, 0])).toBeNull();
  });
});
