import { describe, expect, it } from 'vitest';
import { employeeContext, employeeTable, employeeTotals, parseAnyDay, upcomingDates } from './aiEmployeeContext';

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

describe('upcomingDates with a budget', () => {
  it('lists the soonest that fit and says how many were left out', () => {
    const people = Array.from({ length: 10 }, (_, i) => ({ 'First Name': `P${i}`, 'Date of Birth': `1990-10-${String(8 + i).padStart(2, '0')}` }));
    const lines = upcomingDates(people, today, 30, 200).split('\n');
    expect(lines[0]).toBe('- P0: birthday tomorrow (8 October), turning 36');
    expect(lines.at(-1)).toMatch(/^\(Only the soonest \d of 10 are listed; the totals above count all of them\.\)$/);
  });
});

describe('employeeTotals', () => {
  it('counts every record per grouping, most first, with what is not recorded', () => {
    const people = [
      { 'First Name': 'A', Department: 'Sales', Branch: 'Nairobi', Gender: 'Female', 'Basic Salary': '50,000' },
      { 'First Name': 'B', Department: 'Sales', Branch: 'Mombasa', Gender: 'Male', 'Basic Salary': 70000 },
      { 'First Name': 'C', Department: 'Finance', Branch: 'Nairobi', Gender: '', 'Basic Salary': null },
    ];
    expect(employeeTotals(people, today).split('\n')).toEqual([
      '- Headcount: 3',
      '- By Department (2 values): Sales: 2, Finance: 1',
      '- By Branch (2 values): Nairobi: 2, Mombasa: 1',
      '- By Gender (3 values): Female: 1, Male: 1, not recorded: 1',
      '- Basic salary (2 recorded): lowest KES 50,000, highest KES 70,000, average KES 60,000',
      '- In the next 30 days: 0 birthdays, 0 work anniversaries, 0 contracts ending, 0 probation periods ending',
    ]);
  });

  it('leaves out groupings the person cannot see or nobody has, and sums a long tail', () => {
    const people = Array.from({ length: 100 }, (_, i) => ({ 'Job Title': `Title ${i}`, Status: null }));
    const totals = employeeTotals(people, today);
    expect(totals).not.toContain('By Status');
    expect(totals).not.toContain('By Branch');
    expect(totals).toMatch(/By Job Title \(100 values\): .*, 40 others: 40$/m);
  });

  it('counts what is coming up over everyone, however long the list', () => {
    const people = Array.from({ length: 5000 }, (_, i) => ({ 'First Name': `P${i}`, 'Date of Birth': '1990-10-09', 'Contract End Date': '2026-10-20' }));
    expect(employeeTotals(people, today)).toContain('In the next 30 days: 5000 birthdays, 0 work anniversaries, 5000 contracts ending');
  });
});

describe('employeeContext', () => {
  const company = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      'Employee Number': `E${i}`, 'First Name': `Person${i}`, Department: i % 4 === 0 ? 'Finance' : 'Sales', Notes: 'x'.repeat(40),
    }));

  it('sends every record, and says so, when they fit', () => {
    const ctx = employeeContext(company(10), today, 'across all towns');
    expect(ctx).toContain('SCOPE: 10 employee records across all towns.');
    expect(ctx).toContain('By Department (2 values): Sales: 7, Finance: 3');
    expect(ctx).toContain('EMPLOYEE RECORDS (every record;');
    expect(ctx).not.toContain('PARTIAL');
  });

  it('keeps totals over all 20,000 and marks the table partial, within the budget', () => {
    const ctx = employeeContext(company(20_000), today, 'across all towns');
    expect(ctx.length).toBeLessThanOrEqual(190_000);
    expect(ctx).toContain('- Headcount: 20000');
    expect(ctx).toContain('By Department (2 values): Sales: 15000, Finance: 5000');
    expect(ctx).toContain('EMPLOYEE RECORDS - PARTIAL');
    expect(ctx).toMatch(/\(Only the first \d+ of 20000 records fit/);
  });
});
