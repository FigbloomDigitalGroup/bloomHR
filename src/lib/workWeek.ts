import { supabase } from './supabase';

// Each company's work week, and a department's own (FIG-888): for each day, Monday first, worked in full (1), half
// (0.5) or not at all (0). Leave in working days counts only those days (supabase/migrations/20261017200000_work_week.sql).

export type DayWork = 0 | 0.5 | 1;
export type WorkWeek = DayWork[];

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const MONDAY_TO_FRIDAY: WorkWeek = [1, 1, 1, 1, 1, 0, 0];

export const DAY_WORK_LABELS: Record<DayWork, string> = { 1: 'Full day', 0.5: 'Half day', 0: 'Day off' };

/** A saved week as numbers (the database sends numeric[] as numbers or strings), or null when it isn't one. */
export function toWorkWeek(value: unknown): WorkWeek | null {
  if (!Array.isArray(value) || value.length !== 7) return null;
  const days = value.map(Number);
  return days.every((d) => d === 0 || d === 0.5 || d === 1) ? (days as WorkWeek) : null;
}

/** Why a week can't be saved, or null. */
export const workWeekError = (week: WorkWeek): string | null =>
  week.some((d) => d > 0) ? null : 'Choose at least one working day';

/** Working days in a week: 5, 5.5, 6. */
export const daysPerWeek = (week: WorkWeek) => week.reduce<number>((sum, d) => sum + d, 0);

/** "Mon–Fri", "Mon–Sat (Sat half)", "Mon, Tue, Thu" */
export function describeWorkWeek(week: WorkWeek): string {
  const short = (i: number) => DAY_NAMES[i].slice(0, 3);
  const worked = week.map((d, i) => (d > 0 ? i : -1)).filter((i) => i >= 0);
  if (!worked.length) return 'No working days';
  const consecutive = worked.every((d, i) => i === 0 || d === worked[i - 1] + 1);
  const span = consecutive && worked.length > 2 ? `${short(worked[0])}–${short(worked[worked.length - 1])}` : worked.map(short).join(', ');
  const halves = worked.filter((i) => week[i] === 0.5).map(short);
  return halves.length ? `${span} (${halves.join(', ')} half)` : span;
}

export async function loadCompanyWorkWeek(): Promise<WorkWeek> {
  const { data, error } = await supabase.from('company_work_week').select('days').maybeSingle();
  if (error) throw new Error(error.message);
  return toWorkWeek(data?.days) ?? MONDAY_TO_FRIDAY;
}

export async function saveCompanyWorkWeek(week: WorkWeek): Promise<WorkWeek> {
  const problem = workWeekError(week);
  if (problem) throw new Error(problem);
  const { data, error } = await supabase
    .from('company_work_week')
    .upsert({ days: week, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' })
    .select('days');
  if (error) throw new Error(/row-level security|42501/i.test(`${error.code} ${error.message}`) ? 'Only HR or settings admins can change the work week' : error.message);
  const saved = toWorkWeek(data?.[0]?.days);
  if (!saved) throw new Error('Only HR or settings admins can change the work week');
  return saved;
}
