import { describe, expect, it, vi } from 'vitest';

// the pure helpers under test never touch the database; keep the real client (which needs env keys) out
vi.mock('./supabase', () => ({ supabase: {} }));

import { toDirectoryEmployee } from './employeeDirectory';
import {
  Department,
  buildTree,
  countBelow,
  departmentError,
  departmentNames,
  departmentPath,
  departmentTree,
  descendantIds,
  filterTree,
  flatten,
  isCurrentEmployee,
  reportingTree,
} from './orgStructure';

const dept = (id: string, name: string, parent_id: string | null = null, active = true): Department =>
  ({ id, name, parent_id, head_employee_id: null, active });

const departments = [
  dept('hq', 'Head Office'),
  dept('fin', 'Finance', 'hq'),
  dept('pay', 'Payables', 'fin'),
  dept('ar', 'Receivables', 'fin'),
  dept('ops', 'Operations'),
  dept('old', 'Old Unit', null, false),
];

const person = (id: string, first: string, reportsTo: string | null, extra: Record<string, string> = {}) =>
  toDirectoryEmployee({ id, 'Employee Number': id.toUpperCase(), 'First Name': first, 'Last Name': 'X', reports_to_id: reportsTo, ...extra });

describe('buildTree', () => {
  it('nests children under their parents, sorted, with their depth', () => {
    const tree = departmentTree(departments);
    expect(tree.map((n) => n.item.name)).toEqual(['Head Office', 'Old Unit', 'Operations']);
    const fin = tree[0].children[0];
    expect(fin.item.name).toBe('Finance');
    expect(fin.depth).toBe(1);
    expect(fin.children.map((n) => [n.item.name, n.depth])).toEqual([['Payables', 2], ['Receivables', 2]]);
  });

  it('puts an item whose parent is missing at the top', () => {
    const tree = departmentTree([dept('a', 'A', 'gone'), dept('b', 'B', 'a')]);
    expect(tree.map((n) => n.item.id)).toEqual(['a']);
    expect(tree[0].children.map((n) => n.item.id)).toEqual(['b']);
  });

  it('shows every item once even if old data has a loop', () => {
    const loop = [dept('a', 'A', 'b'), dept('b', 'B', 'a'), dept('c', 'C', 'c')];
    const all = flatten(departmentTree(loop)).map((n) => n.item.id).sort();
    expect(all).toEqual(['a', 'b', 'c']);
  });

  it('works for any shape of item', () => {
    const tree = buildTree([{ k: 1, p: 0 }, { k: 2, p: 1 }], (x) => String(x.k), (x) => (x.p ? String(x.p) : null), (a, b) => a.k - b.k);
    expect(tree[0].children[0].item.k).toBe(2);
  });
});

describe('reportingTree', () => {
  it('builds who reports to whom from reports_to_id', () => {
    const staff = [person('a', 'Ann', null), person('b', 'Ben', 'a'), person('c', 'Cy', 'b'), person('d', 'Dee', 'a')];
    const tree = reportingTree(staff);
    expect(tree).toHaveLength(1);
    expect(tree[0].item.fullName).toBe('Ann X');
    expect(tree[0].children.map((n) => n.item.firstName)).toEqual(['Ben', 'Dee']);
    expect(countBelow(tree[0])).toBe(3);
  });
});

describe('filterTree', () => {
  it('keeps matches with the path down to them', () => {
    const found = filterTree(departmentTree(departments), (d) => d.name === 'Payables');
    expect(flatten(found).map((n) => n.item.name)).toEqual(['Head Office', 'Finance', 'Payables']);
  });

  it('keeps all of a matching node’s children', () => {
    const found = filterTree(departmentTree(departments), (d) => d.name === 'Finance');
    expect(flatten(found).map((n) => n.item.name)).toEqual(['Head Office', 'Finance', 'Payables', 'Receivables']);
  });
});

describe('department helpers', () => {
  it('descendantIds: a department and everything under it', () => {
    expect([...descendantIds(departments, 'hq')].sort()).toEqual(['ar', 'fin', 'hq', 'pay']);
    expect([...descendantIds(departments, 'ops')]).toEqual(['ops']);
  });

  it('departmentPath: from the top down', () => {
    expect(departmentPath(departments, 'pay')).toBe('Head Office › Finance › Payables');
    expect(departmentPath(departments, null)).toBe('');
  });

  it('departmentNames: active ones, A-Z', () => {
    expect(departmentNames(departments)).toEqual(['Finance', 'Head Office', 'Operations', 'Payables', 'Receivables']);
  });

  it('departmentError: readable reasons', () => {
    expect(departmentError({ code: '23505' })).toMatch(/already a department/);
    expect(departmentError({ message: 'new row violates row-level security policy' })).toMatch(/Only HR/);
    expect(departmentError({ message: 'A department can’t be inside itself' })).toMatch(/inside itself/);
  });
});

describe('isCurrentEmployee', () => {
  it('leaves out people who have left', () => {
    expect(isCurrentEmployee(person('a', 'A', null, { Status: 'Active' }))).toBe(true);
    expect(isCurrentEmployee(person('a', 'A', null))).toBe(true);
    expect(isCurrentEmployee(person('a', 'A', null, { Status: 'Terminated' }))).toBe(false);
  });
});
