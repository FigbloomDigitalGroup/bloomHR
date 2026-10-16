import { supabase } from './supabase';
import type { DirectoryEmployee } from './employeeDirectory';

/**
 * The company's departments and reporting lines (FIG-826, see 20261016200000_org_structure.sql): loading and saving
 * departments, and turning flat lists into the trees the Departments page and the organogram draw.
 */
export interface Department {
  id: string;
  name: string;
  parent_id: string | null;
  head_employee_id: string | null;
  active: boolean;
  /** its own work week (FIG-888), Monday first; null = the department above it, then the company */
  work_week?: number[] | null;
}

/** A node of a tree: the item, its children (sorted) and how deep it sits (0 at the top). */
export interface TreeNode<T> {
  item: T;
  children: TreeNode<T>[];
  depth: number;
}

const DEPARTMENT_COLUMNS = 'id, name, parent_id, head_employee_id, active, work_week';

export async function loadDepartments(): Promise<Department[]> {
  const { data, error } = await supabase.from('departments').select(DEPARTMENT_COLUMNS).order('name');
  if (error) throw error;
  return (data || []) as Department[];
}

/** Turns the database's refusals into something a person can act on. */
export function departmentError(err: unknown): string {
  const e = (err || {}) as { code?: string; message?: string };
  if (e.code === '23505') return 'There is already a department with that name';
  if (e.code === '42501' || /row-level security/i.test(e.message || '')) return 'Only HR can change departments';
  return e.message || 'Could not save the department';
}

export async function addDepartment(name: string, parentId: string | null = null): Promise<Department> {
  const { data, error } = await supabase
    .from('departments')
    .insert({ name: name.trim(), parent_id: parentId })
    .select(DEPARTMENT_COLUMNS)
    .single();
  if (error) throw new Error(departmentError(error));
  return data as Department;
}

export async function updateDepartment(
  id: string,
  changes: Partial<Pick<Department, 'name' | 'parent_id' | 'head_employee_id' | 'active' | 'work_week'>>
): Promise<Department> {
  const { data, error } = await supabase.from('departments').update(changes).eq('id', id).select(DEPARTMENT_COLUMNS);
  if (error) throw new Error(departmentError(error));
  const row = (data || [])[0];
  if (!row) throw new Error('Only HR can change departments');
  return row as Department;
}

/**
 * Builds a forest from items that point at their parent. An item whose parent is missing (or filtered out) becomes a
 * root, and a loop in the data (which the database refuses, but older rows could still have) never recurses forever:
 * each item appears once.
 */
export function buildTree<T>(
  items: T[],
  getId: (item: T) => string,
  getParent: (item: T) => string | null | undefined,
  compare: (a: T, b: T) => number
): TreeNode<T>[] {
  const ids = new Set(items.map(getId));
  const childrenOf = new Map<string, T[]>();
  const roots: T[] = [];
  for (const item of items) {
    const parent = getParent(item);
    if (parent && parent !== getId(item) && ids.has(parent)) {
      const list = childrenOf.get(parent) || [];
      list.push(item);
      childrenOf.set(parent, list);
    } else {
      roots.push(item);
    }
  }

  const placed = new Set<string>();
  const grow = (item: T, depth: number): TreeNode<T> => {
    placed.add(getId(item));
    const kids = (childrenOf.get(getId(item)) || []).filter((k) => !placed.has(getId(k))).sort(compare);
    kids.forEach((k) => placed.add(getId(k)));
    return { item, depth, children: kids.map((k) => grow(k, depth + 1)) };
  };
  const forest = [...roots].sort(compare).map((r) => grow(r, 0));
  // whatever is left sits in a loop with no way in from a root: show the first of each loop at the top
  for (const item of [...items].sort(compare)) {
    if (!placed.has(getId(item))) forest.push(grow(item, 0));
  }
  return forest;
}

export const departmentTree = (departments: Department[]) =>
  buildTree(departments, (d) => d.id, (d) => d.parent_id, (a, b) => a.name.localeCompare(b.name));

export const reportingTree = (employees: DirectoryEmployee[]) =>
  buildTree(employees, (e) => e.id, (e) => e.reportsToId, (a, b) => a.fullName.localeCompare(b.fullName));

/** Every node, parents before their children (the order the trees are listed in). */
export function flatten<T>(forest: TreeNode<T>[]): TreeNode<T>[] {
  const out: TreeNode<T>[] = [];
  const walk = (n: TreeNode<T>) => {
    out.push(n);
    n.children.forEach(walk);
  };
  forest.forEach(walk);
  return out;
}

/** The ids of a department and all of its sub-departments (what it can't be moved into). */
export function descendantIds(departments: Department[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of departments) {
      if (d.parent_id && out.has(d.parent_id) && !out.has(d.id)) {
        out.add(d.id);
        grew = true;
      }
    }
  }
  return out;
}

/** "Head Office › Finance › Payables" */
export function departmentPath(departments: Department[], id: string | null | undefined): string {
  const byId = new Map(departments.map((d) => [d.id, d]));
  const names: string[] = [];
  const seen = new Set<string>();
  let cur = id ? byId.get(id) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    names.unshift(cur.name);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return names.join(' › ');
}

/**
 * Keeps the nodes that match, with the path down to them (so a match is shown where it sits); a matching node keeps
 * all of its children.
 */
export function filterTree<T>(forest: TreeNode<T>[], matches: (item: T) => boolean): TreeNode<T>[] {
  const out: TreeNode<T>[] = [];
  for (const n of forest) {
    if (matches(n.item)) out.push(n);
    else {
      const kids = filterTree(n.children, matches);
      if (kids.length) out.push({ ...n, children: kids });
    }
  }
  return out;
}

/** How many people sit under a node, at any depth. */
export const countBelow = <T,>(node: TreeNode<T>): number =>
  node.children.reduce((sum, c) => sum + 1 + countBelow(c), 0);

/** The names of the active departments, A-Z. */
export const departmentNames = (departments: Department[]): string[] =>
  departments.filter((d) => d.active).map((d) => d.name).sort((a, b) => a.localeCompare(b));

/** Someone who has left is not on the organogram. */
export const isCurrentEmployee = (e: DirectoryEmployee) => !/terminat|resign|exit|left/i.test(e.status);
