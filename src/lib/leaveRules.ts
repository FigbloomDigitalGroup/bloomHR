import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { LeaveDocumentNeeded } from './leaveDocuments';

// The leave rules a company sets per leave type (FIG-875). The database checks every new application against them
// and works out its days (supabase/migrations/20261017000000_leave_rules.sql); leave_request_check gives the forms the
// same answer before anyone presses submit.

export type BalanceRule = 'earned' | 'full_year' | 'none';
export type CountDays = 'working' | 'calendar';

export const BALANCE_RULE_LABELS: Record<BalanceRule, string> = {
  full_year: 'Up to the whole year’s allowance (can book ahead)',
  earned: 'Only days earned so far',
  none: 'No limit (balance may go below zero)',
};

export interface LeaveCheck {
  /** days the leave covers, as the database counts them (0 when the dates are incomplete or need no leave) */
  days: number;
  /** days still free to book after other pending applications; null = no limit */
  available: number | null;
  /** what stops it being submitted; empty when it may go ahead */
  problems: string[];
  /** the documents its leave type asks for (FIG-876); null when none */
  document: LeaveDocumentNeeded | null;
  /** how many of its days would be at half pay (FIG-879) */
  halfPayDays: number;
  /** for a leave type with half-pay days: full-pay and half-pay days still free; null otherwise */
  fullPayLeft: number | null;
  halfPayLeft: number | null;
}

/** "5 full-pay + 15 half-pay days free", or "3 days free" */
export function describeFree(c: Pick<LeaveCheck, 'available' | 'fullPayLeft' | 'halfPayLeft'>): string | null {
  if (c.available === null) return null;
  if (c.fullPayLeft !== null && c.halfPayLeft !== null) return `${c.fullPayLeft} full-pay + ${c.halfPayLeft} half-pay days free to book`;
  return `${c.available} day${c.available === 1 ? '' : 's'} free to book`;
}

export async function checkLeaveRequest(employeeNumber: string, leaveType: string, start: string, end: string, half = false): Promise<LeaveCheck> {
  const { data, error } = await supabase.rpc('leave_request_check', {
    p_employee_number: employeeNumber,
    p_leave_type: leaveType,
    p_start: start,
    p_end: end,
    p_half: half,
  });
  if (error) throw new Error(error.message);
  const r = (data || {}) as Partial<LeaveCheck> & { half_pay_days?: number; full_pay_left?: number | null; half_pay_left?: number | null };
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    days: Number(r.days ?? 0),
    available: r.available === null || r.available === undefined ? null : Number(r.available),
    problems: Array.isArray(r.problems) ? r.problems : [],
    document: r.document && (r.document.name || r.document.followup_name) ? r.document : null,
    halfPayDays: Number(r.half_pay_days ?? 0),
    fullPayLeft: num(r.full_pay_left),
    halfPayLeft: num(r.half_pay_left),
  };
}

/**
 * Checks a leave request as its fields change. null until there is enough to check (an employee, a type, both dates).
 * `half`: a half-day application (one day), counted as half of that day.
 */
export function useLeaveCheck(employeeNumber: string, leaveType: string, start: string, end: string, half = false) {
  const [check, setCheck] = useState<LeaveCheck | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!employeeNumber || !leaveType || !start || !end) {
      setCheck(null);
      return;
    }
    let stale = false;
    setChecking(true);
    checkLeaveRequest(employeeNumber, leaveType, start, end, half)
      .then((c) => { if (!stale) setCheck(c); })
      .catch((e) => {
        console.error('Leave check failed:', e);
        if (!stale) setCheck(null);
      })
      .finally(() => { if (!stale) setChecking(false); });
    return () => { stale = true; };
  }, [employeeNumber, leaveType, start, end, half]);

  return { check, checking };
}
