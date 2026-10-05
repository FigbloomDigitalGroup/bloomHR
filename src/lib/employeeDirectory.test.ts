import { describe, expect, it, vi } from 'vitest';

// the pure helpers under test never touch the database; keep the real client (which needs env keys) out
vi.mock('./supabase', () => ({ supabase: {} }));

import { employeeDetail, employeeLabel, matchEmployees, toDirectoryEmployee } from './employeeDirectory';

const emp = (no: string, first: string, last: string, extra: Record<string, string> = {}) =>
  toDirectoryEmployee({
    'Employee Number': no,
    'First Name': first,
    'Middle Name': extra.middle || '',
    'Last Name': last,
    'Job Title': extra.title || '',
    Branch: extra.branch || '',
    Town: extra.town || '',
    'Work Email': extra.email || '',
  });

const staff = [
  emp('001', 'Wanjiru', 'Kamau', { title: 'Software Engineer', town: 'Nairobi' }),
  emp('005', 'Mike', 'Otieno', { title: 'Accountant', town: 'Kisumu' }),
  emp('012', 'Michael', 'Mwangi', { title: 'HR Manager', town: 'Nakuru' }),
  emp('105', 'Achieng', 'Auma', { title: 'Accountant', town: 'Kisumu' }),
  emp('1005', 'Otieno', 'Odhiambo', { title: 'DevOps Engineer', town: 'Kisumu' }),
];

describe('toDirectoryEmployee', () => {
  it('builds the full name from the non-empty parts', () => {
    expect(emp('7', 'Ann', 'Lee', { middle: 'Mary' }).fullName).toBe('Ann Mary Lee');
    expect(emp('8', 'Ann', '').fullName).toBe('Ann');
  });

  it('copes with nulls from the database', () => {
    const e = toDirectoryEmployee({ 'Employee Number': '9', 'First Name': null, 'Last Name': null });
    expect(e.fullName).toBe('Unknown employee');
    expect(e.employeeNumber).toBe('9');
  });
});

describe('labels', () => {
  it('formats the stored label and the picker detail line', () => {
    expect(employeeLabel(staff[1])).toBe('Mike Otieno (005)');
    expect(employeeDetail(staff[1])).toBe('005 · Accountant · Kisumu');
  });
});

describe('matchEmployees', () => {
  it('returns everyone for an empty query', () => {
    expect(matchEmployees(staff, '  ')).toHaveLength(5);
  });

  it('finds people by part of their name', () => {
    expect(matchEmployees(staff, 'mike').map((e) => e.employeeNumber)).toEqual(['005']);
    // "mic" is a word-start of Michael only
    expect(matchEmployees(staff, 'mic').map((e) => e.employeeNumber)).toEqual(['012']);
  });

  it('finds people by employee number, ranking an exact number first', () => {
    const r = matchEmployees(staff, '005').map((e) => e.employeeNumber);
    expect(r[0]).toBe('005');
    expect(r).toContain('1005'); // a number that merely contains 005 still matches, just later
  });

  it('matches job title and location, and needs every word to match', () => {
    expect(matchEmployees(staff, 'accountant').map((e) => e.employeeNumber)).toEqual(['105', '005']);
    expect(matchEmployees(staff, 'accountant kisumu mike').map((e) => e.employeeNumber)).toEqual(['005']);
    expect(matchEmployees(staff, 'mike nairobi')).toEqual([]);
  });

  it('ignores case', () => {
    expect(matchEmployees(staff, 'WANJIRU')).toHaveLength(1);
  });
});
