import { supabase } from './supabase';
import { fetchAll } from './fetchAll';
import type { EmployeeReimbursement, ReimbursementType } from './reimbursements';

// The database side of reimbursements (lib/reimbursements): the company's columns, each employee's amounts for a
// month, and the draft run's saved payslip when an amount changes.

const TYPE_COLUMNS = 'id, name, position, active';

const missingTable = (err: { code?: string } | null | undefined) => ['42P01', 'PGRST205'].includes(err?.code ?? '');

/** The company's columns (paused ones too) and every amount entered for the month (none before the migration). */
export const loadReimbursements = async (period: string) => {
  try {
    return await loadMonth(period);
  } catch (err) {
    if (missingTable(err as { code?: string })) return { types: [] as ReimbursementType[], rows: [] as EmployeeReimbursement[] };
    throw err;
  }
};

const loadMonth = async (period: string) => {
  const [types, rows] = await Promise.all([
    supabase.from('reimbursement_types').select(TYPE_COLUMNS).order('position').order('name'),
    fetchAll<EmployeeReimbursement>((from, to) =>
      supabase
        .from('employee_reimbursements')
        .select('id, employee_number, reimbursement_type_id, pay_period, amount')
        .eq('pay_period', period)
        .order('id')
        .range(from, to)
    ),
  ]);
  if (types.error) throw types.error;
  return { types: (types.data ?? []) as ReimbursementType[], rows: rows.map((r) => ({ ...r, amount: Number(r.amount) || 0 })) };
};

/** Adds a column at the end, or brings back a removed one of the same name. */
export const addReimbursementType = async (name: string, types: ReimbursementType[]) => {
  const clean = name.trim().replace(/\s+/g, ' ');
  const existing = types.find((t) => t.name.trim().toLowerCase() === clean.toLowerCase());
  if (existing?.active) throw new Error(`There is already a "${existing.name}" column.`);
  if (existing) {
    const { error } = await supabase.from('reimbursement_types').update({ active: true }).eq('id', existing.id);
    if (error) throw error;
    return;
  }
  const position = Math.max(0, ...types.map((t) => t.position)) + 1;
  const { error } = await supabase.from('reimbursement_types').insert({ name: clean, position });
  if (error) throw error.code === '23505' ? new Error(`There is already a "${clean}" column.`) : error;
};

/** Removes a column from the payroll page (paused: amounts and payslips already saved keep it). */
export const removeReimbursementType = async (id: string) => {
  const { error } = await supabase.from('reimbursement_types').update({ active: false }).eq('id', id);
  if (error) throw error;
};

/** Sets one employee's amount for a column and month; 0 clears it. */
export const setEmployeeReimbursement = async (input: { employeeNumber: string; typeId: string; period: string; amount: number }) => {
  const { error } =
    input.amount > 0
      ? await supabase.from('employee_reimbursements').upsert(
          { employee_number: input.employeeNumber, reimbursement_type_id: input.typeId, pay_period: input.period, amount: input.amount },
          { onConflict: 'tenant_id,employee_number,reimbursement_type_id,pay_period' },
        )
      : await supabase
          .from('employee_reimbursements')
          .delete()
          .eq('employee_number', input.employeeNumber)
          .eq('reimbursement_type_id', input.typeId)
          .eq('pay_period', input.period);
  if (error) throw error;
};

/** Writes a draft run's payslip's reimbursements and net pay (lib/reimbursements withReimbursement). */
export const saveRunPayslipReimbursements = async (
  runId: string,
  employeeId: string,
  payslip: { reimbursement_items: unknown; reimbursements: number; net_pay: number },
) => {
  const { error } = await supabase
    .from('salary_history')
    .update({ reimbursement_items: payslip.reimbursement_items, reimbursements: payslip.reimbursements, net_pay: payslip.net_pay })
    .eq('run_id', runId)
    .eq('employee_id', employeeId);
  if (error) throw error;
};

/** A saved payslip's reimbursements, so a hand edit (which works out net pay again) keeps them. */
export const savedReimbursements = async (runId: string, employeeId: string) => {
  const { data, error } = await supabase
    .from('salary_history')
    .select('reimbursement_items, reimbursements')
    .eq('run_id', runId)
    .eq('employee_id', employeeId)
    .maybeSingle();
  // (a database without the columns yet: none)
  if (error && ['42703', 'PGRST204'].includes(error.code)) return [];
  if (error) throw error;
  return (data?.reimbursement_items ?? []) as unknown[];
};
