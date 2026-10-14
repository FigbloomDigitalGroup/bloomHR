import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ existing: [] as unknown[], inserted: [] as unknown[], employees: [] as unknown[], ranges: [] as number[][] }));
vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        ilike: () => ({ limit: () => Promise.resolve({ data: db.existing }) }),
        // like the API: the requested range of rows, at most 1000 per request
        order: () => ({
          range: (from: number, to: number) => {
            db.ranges.push([from, to]);
            return Promise.resolve({ data: db.employees.slice(from, Math.min(to + 1, from + 1000)), error: null });
          },
        }),
      }),
      insert: (row: unknown) => {
        db.inserted.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

import {
  STARTER_DEPARTMENTS,
  employeeFieldValues,
  ensureBranchListed,
  loadEmployeeFieldValues,
  optionsWithStarters,
} from './employeeOptions';

describe('optionsWithStarters', () => {
  it("puts the company's own values first, then starters it doesn't have, without blanks or repeats", () => {
    expect(optionsWithStarters(['Farm Ops', '', null, 'finance', 'Farm Ops'], ['Finance', 'IT'])).toEqual(['Farm Ops', 'finance', 'IT']);
  });
  it('gives a new company the starter departments', () => {
    expect(optionsWithStarters([], STARTER_DEPARTMENTS)).toEqual(STARTER_DEPARTMENTS);
  });
});

describe('employeeFieldValues', () => {
  it('lists each field A-Z without blanks, and supervisors by first name with nameless people last', () => {
    const values = employeeFieldValues([
      { 'First Name': 'Zed', 'Last Name': 'A', Branch: 'Nakuru', Town: null, 'Job Title': '' },
      { 'First Name': null, 'Last Name': 'B', Branch: 'Eldoret', Town: 'Kisumu' },
      { 'First Name': 'Amy', 'Last Name': 'C', Branch: 'Nakuru' },
    ]);
    expect(values.branches).toEqual(['Eldoret', 'Nakuru', 'Nakuru']);
    expect(values.towns).toEqual(['Kisumu']);
    expect(values.jobTitles).toEqual([]);
    expect(values.supervisors).toEqual(['Amy C', 'Zed A', 'null B']);
  });
});

describe('loadEmployeeFieldValues', () => {
  it('reads every employee, past the 1000-row cap of a single request', async () => {
    db.employees = Array.from({ length: 2300 }, (_, i) => ({ 'Employee Number': String(i), 'First Name': `P${i}`, Branch: `B${i}` }));
    db.ranges = [];
    const values = await loadEmployeeFieldValues('employees');
    expect(values.branches).toHaveLength(2300);
    expect(values.supervisors).toHaveLength(2300);
    expect(db.ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });
});

describe('ensureBranchListed', () => {
  it('adds a new branch, with its town, to the branch list', async () => {
    db.existing = [];
    db.inserted = [];
    await ensureBranchListed(' Eldoret ', 'Eldoret Town');
    expect(db.inserted).toEqual([{ 'Branch Office': 'Eldoret', Town: 'Eldoret Town' }]);
  });
  it('leaves a branch that is already listed, and ignores empty ones', async () => {
    db.existing = [{ id: 1 }];
    db.inserted = [];
    await ensureBranchListed('Nairobi', null);
    await ensureBranchListed('', null);
    expect(db.inserted).toEqual([]);
  });
});
