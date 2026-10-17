import { supabase } from './supabase';
import { fetchAll } from './fetchAll';

// The database side of the company's leave year and the forfeit report (FIG-877, migration 20261018600000).

export interface LeaveYearSettings {
  /** the month the leave year starts in, as used (the fiscal year's when same_as_fiscal_year) */
  start_month: number;
  /** the company's own choice, kept while it follows the fiscal year */
  leave_year_start_month: number;
  same_as_fiscal_year: boolean;
  fiscal_year_start_month: number;
  /** the leave year today is in */
  current_year: number;
}

export const DEFAULT_LEAVE_YEAR: LeaveYearSettings = {
  start_month: 1,
  leave_year_start_month: 1,
  same_as_fiscal_year: false,
  fiscal_year_start_month: 1,
  current_year: new Date().getFullYear(),
};

/** A database without the migration yet: the calendar year, as before. */
const notThereYet = (err: unknown) => ['PGRST202', '42883', '42703', 'PGRST204', '42P01', 'PGRST205'].includes(String((err as { code?: string })?.code));

export async function loadLeaveYearSettings(): Promise<LeaveYearSettings> {
  const { data, error } = await supabase.rpc('leave_year_settings');
  if (error) {
    if (notThereYet(error)) return DEFAULT_LEAVE_YEAR;
    throw error;
  }
  return { ...DEFAULT_LEAVE_YEAR, ...((data as Partial<LeaveYearSettings> | null) ?? {}) };
}

export async function saveLeaveYearStart(month: number, sameAsFiscal: boolean): Promise<LeaveYearSettings> {
  const { data, error } = await supabase.rpc('set_leave_year_start', { p_month: month, p_same_as_fiscal: sameAsFiscal });
  if (error) throw error;
  return { ...DEFAULT_LEAVE_YEAR, ...((data as Partial<LeaveYearSettings> | null) ?? {}) };
}

/** One line of the forfeited & paid out report (leave_forfeit_report) */
export interface ForfeitRow {
  kind: 'forfeit' | 'pay_out';
  /** 'over_cap': over the carry-forward cap at the yearly reset; 'carry_expired': carried days not used in time */
  reason: 'over_cap' | 'carry_expired' | null;
  employee_number: string;
  employee_name: string;
  leave_type: string;
  /** the leave year it happened in */
  year: number;
  days: number;
  on_date: string;
  /** payouts: 'pending' | 'paid' */
  status: 'pending' | 'paid' | null;
  amount: number | null;
  pay_period: string | null;
  note: string | null;
}

export async function loadForfeitReport(year: number | null): Promise<ForfeitRow[]> {
  return fetchAll<ForfeitRow>((from, to) => supabase.rpc('leave_forfeit_report', { p_year: year }).range(from, to));
}
