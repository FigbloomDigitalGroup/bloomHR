import { describe, expect, it } from 'vitest';
import { employeeTable, parseAnyDay, upcomingDates } from './aiEmployeeContext';

const today = new Date(2026, 9, 7); // 7 October 2026

describe('parseAnyDay', () => {
  it('reads the app format and day/month/year', () => {
    expect(parseAnyDay('1990-10-09')).toEqual(new Date(1990, 9, 9));
    expect(parseAnyDay('9/10/1990')).toEqual(new Date(1990, 9, 9));
    expect(parseAnyDay('')).toBeNull();
    expect(parseAnyDay('soon')).toBeNull();
  });
});

describe('upcomingDates', () => {
  const people = [
    { 'First Name': 'Jane', 'Last Name': 'Doe', 'Date of Birth': '1990-10-09', 'Start Date': '2020-10-07' },
    { 'First Name': 'Bob', 'Last Name': 'Ali', 'Date of Birth': '1985-12-25', 'Contract End Date': '2026-10-20' },
    { 'First Name': 'Ann', 'Last Name': 'Wu', 'Date of Birth': '1999-10-01', 'Probation End Date': '2026-10-07' },
  ];

  it('lists birthdays, anniversaries and contracts/probation ending soon, soonest first', () => {
    expect(upcomingDates(people, today).split('\n')).toEqual([
      '- Jane Doe: 6-year work anniversary today (7 October)',
      '- Ann Wu: probation ends today (7 October 2026)',
      '- Jane Doe: birthday in 2 days (9 October), turning 36',
      '- Bob Ali: contract ends in 13 days (20 October 2026)',
    ]);
  });

  it('wraps round the year end', () => {
    expect(upcomingDates([{ 'First Name': 'Kim', 'Date of Birth': '2000-01-03' }], new Date(2026, 11, 20))).toBe(
      '- Kim: birthday in 14 days (3 January), turning 27'
    );
  });

  it('says when there is nothing coming up', () => {
    expect(upcomingDates([{ 'First Name': 'Lee', 'Date of Birth': '2000-05-05' }], today)).toBe('None in the next 30 days.');
  });
});

describe('employeeTable', () => {
  it('sends every field that has a value, without internal ids or empty columns', () => {
    const t = employeeTable([
      { id: 1, tenant_id: 'x', 'First Name': 'Jane', Branch: null, Notes: 'line one\nline | two' },
      { id: 2, tenant_id: 'x', 'First Name': 'Bob', Branch: '', Notes: null },
    ]);
    expect(t).toBe('First Name | Notes\nJane | line one line two\nBob | ');
  });

  it('falls back to the core columns, then to fewer rows, when the table is too large', () => {
    const people = Array.from({ length: 50 }, (_, i) => ({ 'First Name': `P${i}`, Notes: 'x'.repeat(100) }));
    expect(employeeTable(people, 1000)).toMatch(/^First Name\nP0\n[\s\S]*left out: Notes\.\)$/);
    const fewer = employeeTable(people, 60);
    expect(fewer).toMatch(/Only the first \d+ of 50 records fit; left out: Notes/);
  });
});
