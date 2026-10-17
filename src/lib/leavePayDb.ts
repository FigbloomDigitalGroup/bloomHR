import { supabase } from './supabase';
import { fetchAll } from './fetchAll';
import type { LeavePayoutDue, LeavePayRow, LeaveRateBasis } from './leavePay';

// The database side of leave on the payslip (lib/leavePay): the month's unpaid and half-pay days, and the company's
// choice of a day's pay (company_payroll_settings.leave_daily_rate_basis).

/** A database without migration 20261017800000 yet: no leave deductions rather than no payroll. */
const notThereYet = (err: unknown) => ['PGRST202', '42883', '42703', 'PGRST204'].includes(String((err as { code?: string })?.code));

/** Each employee's unpaid and half-pay days in the pay period ('YYYY-MM'), by employee number. */
export async function loadLeavePay(period: string): Promise<Map<string, LeavePayRow>> {
  try {
    const rows = await fetchAll<LeavePayRow>((from, to) =>
      supabase.rpc('leave_pay_deductions', { p_period: period }).order('employee_number').range(from, to),
    );
    return new Map(rows.map((r) => [r.employee_number, r]));
  } catch (err) {
    if (notThereYet(err)) return new Map();
    throw err;
  }
}

export async function loadLeaveRateBasis(): Promise<LeaveRateBasis> {
  const { data, error } = await supabase.from('company_payroll_settings').select('leave_daily_rate_basis').maybeSingle();
  if (error) {
    if (notThereYet(error)) return 'basic_30';
    throw error;
  }
  return data?.leave_daily_rate_basis === 'working_days' ? 'working_days' : 'basic_30';
}

export async function saveLeaveRateBasis(basis: LeaveRateBasis): Promise<void> {
  const { error } = await supabase
    .from('company_payroll_settings')
    .upsert({ leave_daily_rate_basis: basis, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' });
  if (error) throw error;
}

/** Leave payouts payroll can pay in the pay period ('YYYY-MM'), by employee number (FIG-877). */
export async function loadLeavePayouts(period: string): Promise<Map<string, LeavePayoutDue[]>> {
  try {
    const rows = await fetchAll<LeavePayoutDue>((from, to) =>
      supabase.rpc('leave_payouts_due', { p_period: period }).order('employee_number').range(from, to),
    );
    const byEmployee = new Map<string, LeavePayoutDue[]>();
    for (const r of rows) byEmployee.set(r.employee_number, [...(byEmployee.get(r.employee_number) ?? []), r]);
    return byEmployee;
  } catch (err) {
    // a database without migration 20261018600000 yet: nothing to pay out
    if (notThereYet(err)) return new Map();
    throw err;
  }
}
