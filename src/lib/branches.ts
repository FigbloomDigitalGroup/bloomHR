import { supabase } from './supabase';

/**
 * The company's branches (FIG-905, see 20261020500000_branches.sql): an office in a country. Every employee belongs to
 * one (employees.branch_id; none means the default branch). Holidays and the minimum wage follow the branch's country;
 * payroll per country comes later.
 */
export interface Branch {
  id: string;
  name: string;
  country: string;
  currency: string;
  city: string | null;
  address: string | null;
  active: boolean;
  is_default: boolean;
}

/** The countries offered when setting up a branch ("Other" lets HR type one). */
export const BRANCH_COUNTRIES = ['Kenya', 'Tanzania', 'Uganda', 'Rwanda'] as const;

/** Countries whose payroll is worked out with their own rules. Everyone else is paid with Kenya's rules for now. */
export const PAYROLL_COUNTRIES = ['Kenya'];

/** The usual currency of a country, as the database fills it in (country_currency). */
export function currencyFor(country: string | null | undefined): string {
  switch ((country || '').trim().toLowerCase()) {
    case 'tanzania':
      return 'TZS';
    case 'uganda':
      return 'UGX';
    case 'rwanda':
      return 'RWF';
    default:
      return 'KES';
  }
}

const COLUMNS = 'id, name, country, currency, city, address, active, is_default';

export async function loadBranches(): Promise<Branch[]> {
  const { data, error } = await supabase.from('branches').select(COLUMNS).order('name');
  if (error) throw error;
  return (data || []) as Branch[];
}

/** Turns the database's refusals into something a person can act on. */
export function branchError(err: unknown): string {
  const e = (err || {}) as { code?: string; message?: string };
  if (e.code === '23505') return 'There is already a branch with that name';
  if (e.code === '42501' || /row-level security/i.test(e.message || '')) return 'Only HR can change branches';
  return e.message || 'Could not save the branch';
}

export type BranchFields = Pick<Branch, 'name' | 'country' | 'currency' | 'city' | 'address'>;

export async function addBranch(fields: BranchFields): Promise<Branch> {
  const { data, error } = await supabase.from('branches').insert(fields).select(COLUMNS).single();
  if (error) throw new Error(branchError(error));
  return data as Branch;
}

export async function updateBranch(id: string, changes: Partial<BranchFields & Pick<Branch, 'active' | 'is_default'>>): Promise<Branch> {
  const { data, error } = await supabase.from('branches').update(changes).eq('id', id).select(COLUMNS);
  if (error) throw new Error(branchError(error));
  const row = (data || [])[0];
  if (!row) throw new Error('Only HR can change branches');
  return row as Branch;
}

/** Moves everyone in one branch to another (before deactivating it); returns how many moved. */
export async function moveBranchStaff(fromId: string, toId: string): Promise<number> {
  const { data, error } = await supabase.rpc('move_branch_staff', { p_from: fromId, p_to: toId });
  if (error) throw new Error(branchError(error));
  return Number(data) || 0;
}

/**
 * The branch an employee is in: by its id when known (employees.branch_id), else by the "Branch" name (which the
 * database keeps as the branch's name, so it works from the directory too), else the default branch.
 */
export function branchOf(
  ref: string | null | undefined | { branchId?: string | null; branchName?: string | null },
  branches: Branch[]
): Branch | undefined {
  const { branchId, branchName } = typeof ref === 'object' && ref !== null ? ref : { branchId: ref, branchName: null };
  const name = (branchName || '').trim().toLowerCase();
  return (
    (branchId && branches.find((b) => b.id === branchId)) ||
    (name && branches.find((b) => b.name.toLowerCase() === name)) ||
    branches.find((b) => b.is_default)
  );
}

/** "Nairobi HQ · Kenya" */
export const branchLabel = (b: Pick<Branch, 'name' | 'country'> | undefined | null): string =>
  b ? `${b.name} · ${b.country}` : '';

/** How many people are in each branch (by their "Branch" name; people with none count in the default one). */
export function headcountByBranch(people: { branch: string }[], branches: Branch[]): Map<string, number> {
  const n = new Map<string, number>();
  for (const p of people) {
    const b = branchOf({ branchName: p.branch }, branches);
    if (b) n.set(b.id, (n.get(b.id) || 0) + 1);
  }
  return n;
}

/** True when payslips for this country are worked out with another country's (Kenya's) rules for now. */
export const paidWithKenyaRules = (country: string | null | undefined): boolean =>
  !!country && !PAYROLL_COUNTRIES.some((c) => c.toLowerCase() === country.trim().toLowerCase());

/** An employee record's branch (its branch_id, else its "Branch" name, else the default branch). */
export const employeeBranch = (e: Record<string, unknown>, branches: Branch[]): Branch | undefined =>
  branchOf({ branchId: (e.branch_id as string | null) ?? null, branchName: (e.Branch as string | null) ?? null }, branches);

/** The employees whose payslips are worked out with Kenya's rules for now (their branch is in another country), by country. */
export function paidWithKenyaRulesByCountry(employees: Record<string, unknown>[], branches: Branch[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of employees) {
    const b = employeeBranch(e, branches);
    if (!b || !paidWithKenyaRules(b.country)) continue;
    const number = String(e['Employee Number'] ?? '').trim();
    if (number) out.set(b.country, [...(out.get(b.country) || []), number]);
  }
  return out;
}
