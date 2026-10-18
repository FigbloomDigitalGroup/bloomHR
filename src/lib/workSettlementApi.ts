import { supabase } from './supabase';
import type { WorkSettlementRow } from './workSettlement';

// The database side of the month-end settlement (lib/workSettlement; migration 20261020300000).

const notThereYet = (error: { code?: string } | null | undefined) =>
  ['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error?.code ?? '');

/**
 * Per worker, the month's work and jobs, what payouts paid and held back and arrears brought forward
 * (work_month_settlement). Empty on a database without the settlement yet, so salaried payroll still works.
 */
export async function loadWorkSettlement(payPeriod: string): Promise<Map<string, WorkSettlementRow>> {
  const { data, error } = await supabase.rpc('work_month_settlement', { p_month: `${payPeriod}-01` });
  if (error) {
    if (notThereYet(error)) return new Map();
    throw error;
  }
  return new Map(((data ?? []) as WorkSettlementRow[]).map((r) => [r.employee_number, r]));
}

/** Employment Act s.19(3): keep deductions within two-thirds of wages (company_payroll_settings.deduction_cap, on by default). */
export async function loadDeductionCap(): Promise<boolean> {
  const { data, error } = await supabase.from('company_payroll_settings').select('deduction_cap').maybeSingle();
  if (error) {
    if (notThereYet(error)) return true;
    throw error;
  }
  return data?.deduction_cap !== false;
}

export async function saveDeductionCap(on: boolean): Promise<void> {
  const { error } = await supabase
    .from('company_payroll_settings')
    .upsert({ deduction_cap: on, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' });
  if (error) throw error;
}

export interface MyWorkSettlement {
  pay_period: string;
  settled: boolean;
  net_pay: number;
  paid_out: number;
  arrears_brought_forward: number;
  arrears_carried_forward: number;
}

/** The signed-in worker: is that month's work settled on an approved payslip (my_work_settlement)? */
export async function loadMyWorkSettlement(month: string): Promise<MyWorkSettlement | null> {
  const { data, error } = await supabase.rpc('my_work_settlement', { p_month: month });
  if (error) {
    if (notThereYet(error)) return null;
    throw error;
  }
  return (data ?? null) as MyWorkSettlement | null;
}
