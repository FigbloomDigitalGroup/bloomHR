import { supabase } from './supabase';

// The company's job titles (migration 20261019300000). An employee's "Job Title" text follows their title: choosing a
// title sets the text, typing an existing title's name links it, and renaming a title renames its employees' text.
// HR, administrators, the Employees module and Performance managers change the list; everyone reads it.

export interface JobTitle {
  id: string;
  name: string;
  department_id: string | null;
  /** the job group new employees with this title usually get */
  job_group_id: string | null;
  active: boolean;
}

export interface JobTitleOverview extends JobTitle {
  employee_count: number;
  template_count: number;
}

export interface JobGroupChoice {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

export type JobTitleInput = Pick<JobTitle, 'name' | 'department_id' | 'job_group_id'>;

/** A database refusal as something a person can act on. */
export function jobTitleError(err: unknown): string {
  const e = (err ?? {}) as { message?: string; code?: string };
  if (e.code === '23505') return 'There is already a job title with that name';
  if (e.code === '42501' && /row-level security/.test(e.message ?? '')) return 'You are not allowed to change job titles';
  return e.message || 'Something went wrong';
}
const fail = (error: unknown): never => {
  throw new Error(jobTitleError(error));
};

/** A name as it is compared: lower case, single spaces, no spaces at either end (as the database does). */
export const titleKey = (name: string | null | undefined) => (name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** A name as it is kept: single spaces, no spaces at either end. */
export const tidyTitle = (name: string) => name.replace(/\s+/g, ' ').trim();

/**
 * Titles that are probably the same job written differently ("Sales Rep", "Sales Rep.", "Sales reps"): grouped by
 * their letters and digits, without a final "s". Only groups of two or more.
 */
export function likelyDuplicates<T extends { id: string; name: string }>(titles: readonly T[]): T[][] {
  const loose = (n: string) => titleKey(n).replace(/[^a-z0-9]/g, '').replace(/s$/, '');
  const groups = new Map<string, T[]>();
  for (const t of titles) {
    const k = loose(t.name);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** What the name field should say about a name, or null when it is fine. */
export function titleNameProblem(name: string, titles: readonly { id: string; name: string }[], selfId: string | null): string | null {
  const t = tidyTitle(name);
  if (!t) return 'Give the job title a name';
  if (t.length > 120) return 'Keep it to 120 characters';
  if (titles.some((x) => x.id !== selfId && titleKey(x.name) === titleKey(t))) return 'There is already a job title with that name';
  return null;
}

/** The list every form reads (all titles; the forms offer the active ones). */
export async function loadJobTitles(): Promise<JobTitle[]> {
  const { data, error } = await supabase.from('job_titles').select('id, name, department_id, job_group_id, active').order('name');
  if (error) fail(error);
  return (data ?? []) as JobTitle[];
}

/** Settings → Job titles: each title with how many employees and KPI templates use it. */
export async function loadJobTitlesOverview(): Promise<JobTitleOverview[]> {
  const { data, error } = await supabase.rpc('job_titles_overview');
  if (error) fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as JobTitleOverview),
    employee_count: Number(r.employee_count ?? 0),
    template_count: Number(r.template_count ?? 0),
  }));
}

/** Job groups' codes and names (no pay), for pickers; empty when the person may not see them. */
export async function loadJobGroupChoices(): Promise<JobGroupChoice[]> {
  const { data, error } = await supabase.rpc('job_group_choices');
  if (error) return [];
  return (data ?? []) as JobGroupChoice[];
}

/** Adds a title (id null) or changes one; renaming it renames its employees' "Job Title" too. */
export async function saveJobTitle(id: string | null, fields: Partial<JobTitleInput> & { active?: boolean }): Promise<void> {
  const row = { ...fields, ...(fields.name !== undefined ? { name: tidyTitle(fields.name) } : {}) };
  const { error } = id ? await supabase.from('job_titles').update(row).eq('id', id) : await supabase.from('job_titles').insert(row);
  if (error) fail(error);
}

/** Moves one title's employees and KPI templates onto another and removes it; returns how many employees moved. */
export async function mergeJobTitles(fromId: string, intoId: string): Promise<number> {
  const { data, error } = await supabase.rpc('merge_job_titles', { p_from: fromId, p_into: intoId });
  if (error) fail(error);
  return Number(data ?? 0);
}

/**
 * What choosing a title on a new employee fills in: its department and default job group, only where the form has
 * none yet.
 */
export function titleDefaults(
  title: Pick<JobTitle, 'department_id' | 'job_group_id'> | undefined,
  current: { department_id?: string | null; job_group_id?: string | null }
): { department_id?: string; job_group_id?: string } {
  if (!title) return {};
  return {
    ...(title.department_id && !current.department_id ? { department_id: title.department_id } : {}),
    ...(title.job_group_id && !current.job_group_id ? { job_group_id: title.job_group_id } : {}),
  };
}
