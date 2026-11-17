import { describe, expect, it } from 'vitest';
import { employmentState, inEmployeeView, localToday } from './employeeStatus';

const TODAY = '2026-11-13';

describe('employmentState', () => {
  it('a Terminated or Inactive status means they have left, whatever the date says', () => {
    expect(employmentState({ Status: 'Terminated', 'Termination Date': null }, TODAY)).toBe('former');
    expect(employmentState({ Status: ' inactive ' }, TODAY)).toBe('former');
    // the case that locked a reinstated employee out: the date cleared, the status left behind
    expect(employmentState({ Status: 'Terminated', 'Termination Date': '' }, TODAY)).toBe('former');
  });

  it('a termination date that has passed means they have left; one still to come, that they are leaving', () => {
    expect(employmentState({ Status: 'Active', 'Termination Date': '2026-11-03' }, TODAY)).toBe('former');
    expect(employmentState({ Status: 'Active', 'Termination Date': '2026-11-13' }, TODAY)).toBe('leaving');
    expect(employmentState({ Status: 'Active', 'Termination Date': '2026-12-31T00:00:00' }, TODAY)).toBe('leaving');
  });

  it('no termination and no leaver status: current', () => {
    expect(employmentState({ Status: 'Active', 'Termination Date': null }, TODAY)).toBe('current');
    expect(employmentState({}, TODAY)).toBe('current');
  });
});

describe('inEmployeeView', () => {
  const current = { Status: 'Active' };
  const leaving = { Status: 'Active', 'Termination Date': '2026-12-01' };
  const former = { Status: 'Terminated', 'Termination Date': '2026-11-03' };

  it('current keeps everyone still working (those leaving included); former only those who have left; all everyone', () => {
    const list = [current, leaving, former];
    expect(list.filter((e) => inEmployeeView(e, 'current', TODAY))).toEqual([current, leaving]);
    expect(list.filter((e) => inEmployeeView(e, 'former', TODAY))).toEqual([former]);
    expect(list.filter((e) => inEmployeeView(e, 'all', TODAY))).toEqual(list);
  });
});

it('localToday is the local calendar day', () => {
  expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
});
