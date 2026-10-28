import { supabase } from './supabase';

// The company's job groups and what they pay (migration 20261015700000). An employee on a group whose pay is not
// overridden is paid the group's current rate; the database fills the pay when the employee is saved, and the forms
// fill it as soon as a group is chosen so HR sees it.

export interface JobGroup {
  id: string;
  code: string;
  name: string;
  active: boolean;
  employee_count: number;
  /** the rate in force today (all null when the group has none yet) */
  effective_from: string | null;
  /** a fixed basic salary, or (null) a band */
  basic_salary: number | null;
  basic_min: number | null;
  basic_max: number | null;
  house_allowance: number | null;
  travel_allowance: number | null;
  other_allowances: number | null;
  /** the monthly per diem the group gets (a reimbursement on the payroll page, not taxed) */
  per_diem: number | null;
  /** when the next rate starts, if one is set for later */
  next_effective_from: string | null;
}

export interface JobGroupRateInput {
  effective_from: string;
  basic_salary: number | null;
  basic_min: number | null;
  basic_max: number | null;
  house_allowance: number;
  travel_allowance: number;
  other_allowances: number;
  per_diem: number;
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

/** The company's groups with their current rate; null when the signed-in person may not see them. */
export async function loadJobGroups(): Promise<JobGroup[] | null> {
  const { data, error } = await supabase.rpc('job_groups_overview');
  if (error) return null;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as JobGroup),
    employee_count: Number(r.employee_count ?? 0),
    basic_salary: num(r.basic_salary),
    basic_min: num(r.basic_min),
    basic_max: num(r.basic_max),
    house_allowance: num(r.house_allowance),
    travel_allowance: num(r.travel_allowance),
    other_allowances: num(r.other_allowances),
    per_diem: num(r.per_diem),
  }));
}

/** Adds a group (id null) or changes its code, name or whether it is active. Returns the group's id. */
export async function saveJobGroup(id: string | null, fields: { code: string; name: string; active?: boolean }): Promise<string> {
  const row = { code: fields.code.trim(), name: fields.name.trim(), ...(fields.active === undefined ? {} : { active: fields.active }) };
  const { data, error } = id
    ? await supabase.from('job_groups').update(row).eq('id', id).select('id').single()
    : await supabase.from('job_groups').insert(row).select('id').single();
  if (error) {
    if (error.code === '23505') throw new Error(`Another job group already has the code ${row.code}`);
    throw new Error(error.message);
  }
  return (data as { id: string }).id;
}

/**
 * Sets what the group pays from a date (replacing a rate from the same date). The database brings the group's
 * employees whose pay is not overridden to it at once when it is already in force, otherwise on the day it starts.
 */
export async function saveJobGroupRate(groupId: string, rate: JobGroupRateInput): Promise<void> {
  const { error } = await supabase
    .from('job_group_rates')
    .upsert({ job_group_id: groupId, ...rate }, { onConflict: 'job_group_id,effective_from' });
  if (error) throw new Error(error.message);
}

/** What is wrong with a rate, or null. */
export function rateError(rate: JobGroupRateInput, band: boolean): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rate.effective_from)) return 'Choose the date the amounts start';
  const amounts = [rate.basic_salary, rate.basic_min, rate.basic_max, rate.house_allowance, rate.travel_allowance, rate.other_allowances, rate.per_diem];
  if (amounts.some((a) => a !== null && (!Number.isFinite(a) || a < 0))) return 'Amounts must be 0 or more';
  if (band) {
    if (rate.basic_min === null || rate.basic_max === null) return 'Give the lowest and highest basic salary';
    if (rate.basic_min > rate.basic_max) return 'The lowest basic salary is more than the highest';
  } else if (rate.basic_salary === null) {
    return 'Give the basic salary';
  }
  return null;
}

/** The employee fields a group's current rate sets; a band keeps `currentBasic`, moved into the band. */
export function payFromGroup(group: JobGroup, currentBasic: unknown): Record<string, number> | null {
  if (!group.effective_from) return null;
  const typed = num(currentBasic);
  const basic = group.basic_salary ?? Math.min(Math.max(typed ?? group.basic_min ?? 0, group.basic_min ?? 0), group.basic_max ?? Infinity);
  return {
    'Basic Salary': basic,
    house_allowance: group.house_allowance ?? 0,
    travel_allowance: group.travel_allowance ?? 0,
    other_cash_allowances: group.other_allowances ?? 0,
  };
}

/** The employee fields a group decides (locked on the forms unless the pay is overridden). */
export const GROUP_PAY_FIELDS = ['Basic Salary', 'house_allowance', 'travel_allowance', 'other_cash_allowances'];

/** The pay fields the employee's group decides: none when there is no group, it has no amounts or pay is overridden. */
export function lockedPayFields(groups: JobGroup[] | null, values: Record<string, unknown>): string[] {
  const group = groups?.find((g) => g.id === values.job_group_id);
  return group?.effective_from && !values.pay_overridden ? GROUP_PAY_FIELDS : [];
}

export const formatKsh = (n: number | null) => (n === null ? '—' : `KSh ${n.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`);

/** "KSh 55,000" for a fixed basic salary, "KSh 30,000 – 40,000" for a band, "No amounts yet" without a rate. */
export function basicLabel(group: Pick<JobGroup, 'effective_from' | 'basic_salary' | 'basic_min' | 'basic_max'>): string {
  if (!group.effective_from) return 'No amounts yet';
  if (group.basic_salary !== null) return formatKsh(group.basic_salary);
  return `${formatKsh(group.basic_min)} – ${(group.basic_max ?? 0).toLocaleString('en-KE')}`;
}
