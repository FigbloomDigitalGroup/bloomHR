import { useEffect, useState } from 'react';
import { supabase } from './supabase';

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
  const r = (data || {}) as Partial<LeaveCheck>;
  return {
    days: Number(r.days ?? 0),
    available: r.available === null || r.available === undefined ? null : Number(r.available),
    problems: Array.isArray(r.problems) ? r.problems : [],
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
