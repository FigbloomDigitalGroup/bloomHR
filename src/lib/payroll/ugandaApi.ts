import { supabase } from '../supabase';
import type { LstCollection } from './countries/uganda';

// The database side of Uganda's payroll (FIG-905 stage 4; migration 20261021100000_uganda_payroll.sql): LST paid so
// far this financial year, how the company collects LST, and LST an employee paid elsewhere.

const notThereYet = (error: { code?: string } | null | undefined) =>
  ['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error?.code ?? '');

/** LST each employee in Uganda has already paid this financial year, not counting the pay period itself. */
export async function loadLstPaidThisYear(payPeriod: string): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc('lst_paid_this_year', { p_period: payPeriod });
  if (error) {
    if (notThereYet(error)) return new Map();
    throw error;
  }
  return new Map(((data ?? []) as { employee_number: string; paid: number | string }[]).map((r) => [r.employee_number, Number(r.paid) || 0]));
}

/** How LST is collected: four instalments in July to October (the default) or all at once. */
export async function loadLstCollection(): Promise<LstCollection> {
  const { data, error } = await supabase.from('company_payroll_settings').select('lst_collection').maybeSingle();
  if (error) {
    if (notThereYet(error)) return 'instalments';
    throw error;
  }
  return data?.lst_collection === 'lump_sum' ? 'lump_sum' : 'instalments';
}

export async function saveLstCollection(collection: LstCollection): Promise<void> {
  const { error } = await supabase
    .from('company_payroll_settings')
    .upsert({ lst_collection: collection, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' });
  if (error) throw error;
}

export interface LstPaidElsewhere {
  employee_number: string;
  fy_start: number;
  paid_elsewhere: number;
  note: string | null;
}

/** LST employees already paid this financial year with another employer or straight to the council. */
export async function loadLstPaidElsewhere(fyStart: number): Promise<LstPaidElsewhere[]> {
  const { data, error } = await supabase.from('lst_years').select('employee_number, fy_start, paid_elsewhere, note').eq('fy_start', fyStart).order('employee_number');
  if (error) {
    if (notThereYet(error)) return [];
    throw error;
  }
  return ((data ?? []) as LstPaidElsewhere[]).map((r) => ({ ...r, paid_elsewhere: Number(r.paid_elsewhere) || 0 }));
}

export async function saveLstPaidElsewhere(row: { employee_number: string; fy_start: number; paid_elsewhere: number; note?: string }): Promise<void> {
  if (!row.employee_number.trim()) throw new Error('Choose the employee.');
  if (!Number.isFinite(row.paid_elsewhere) || row.paid_elsewhere < 0) throw new Error('Enter an amount of 0 or more.');
  const { error } = await supabase.from('lst_years').upsert(
    { employee_number: row.employee_number.trim(), fy_start: row.fy_start, paid_elsewhere: row.paid_elsewhere, note: row.note?.trim() || null, updated_at: new Date().toISOString() },
    { onConflict: 'tenant_id,employee_number,fy_start' }
  );
  if (error) throw error;
}
