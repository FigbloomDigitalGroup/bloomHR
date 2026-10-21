import { supabase } from './supabase';

// How a company's employee numbers are given (migration 20261014700000): by the system, in the company's format
// (prefix, digits, next number), or the company's own numbers, typed in when an employee is added.

export type EmployeeNumberMode = 'system' | 'own';

export interface EmployeeNumbering {
  mode: EmployeeNumberMode;
  /** put before the count, with any separator: 'MCL-', 'EMP/', or '' */
  prefix: string;
  /** the count is padded with zeros to this many digits */
  digits: number;
  next_number: number;
  /** the next number as it will be given (numbers already in use are skipped) */
  preview: string;
}

export const DEFAULT_NUMBERING: EmployeeNumbering = { mode: 'system', prefix: 'MCL-', digits: 6, next_number: 1, preview: 'MCL-000001' };

export const PREFIX_PATTERN = /^[A-Za-z0-9/_.-]{0,12}$/;

/** prefix + n padded to `digits` (a longer n is never cut): ('MCL-', 6, 1501) is MCL-001501. */
export function formatEmployeeNumber(prefix: string, digits: number, n: number): string {
  return `${prefix}${String(Math.trunc(n)).padStart(digits, '0')}`;
}

/** What is wrong with these settings, or null. */
export function numberingError(prefix: string, digits: number, next: number): string | null {
  if (!PREFIX_PATTERN.test(prefix)) return 'The prefix may have up to 12 letters, digits and / _ . -';
  if (!Number.isInteger(digits) || digits < 1 || digits > 10) return 'The number of digits must be 1 to 10';
  if (!Number.isInteger(next) || next < 1 || next > 2147483647) return 'The next number must be a whole number, 1 or more';
  return null;
}

/** The company's settings; null when the signed-in person may not see them. */
export async function loadEmployeeNumbering(): Promise<EmployeeNumbering | null> {
  const { data, error } = await supabase.rpc('employee_numbering');
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as EmployeeNumbering | undefined;
  return row ?? null;
}

/** Saves the settings; `next` moves the count (leave it out to keep it). Throws with the reason when refused. */
export async function saveEmployeeNumbering(mode: EmployeeNumberMode, prefix: string, digits: number, next?: number): Promise<EmployeeNumbering> {
  const { data, error } = await supabase.rpc('set_employee_numbering', {
    p_mode: mode,
    p_prefix: prefix,
    p_digits: digits,
    p_next: next ?? null,
  });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data[0] : data) as EmployeeNumbering;
}

/**
 * Gives everyone whose number starts with `from` the prefix `to` instead (MCL-000123 -> FBL-000123), and new employees
 * too (migration 20261023100000). Administrators and Settings only. Returns how many were renumbered; throws with the
 * reason when refused (nothing is changed then).
 */
export async function renumberEmployees(from: string, to: string): Promise<number> {
  const { data, error } = await supabase.rpc('renumber_employees', { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}
