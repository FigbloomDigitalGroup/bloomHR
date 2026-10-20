import { supabase } from './supabase';
import type { CompanyPayItem, NewCompanyPayItem } from './payItems';

// The company's standard pay items (company_pay_items, migration 20261022700000). The database decides who may
// change them (payroll) and records who confirmed each item's tax treatment.

const COLUMNS =
  'id, name, kind, amount_type, amount, applies_to, scope_id, employee_numbers, tax_treatment, tax_rule_id, tax_source, tax_confirmed_at, active, notes';

/** A database without the table yet (the migration not applied): no items. */
const missingTable = (err: { code?: string } | null) => Boolean(err && ['42P01', 'PGRST205'].includes(String(err.code)));

const tidy = (row: Record<string, unknown>): CompanyPayItem => ({
  ...(row as unknown as CompanyPayItem),
  amount: Number(row.amount) || 0,
  employee_numbers: Array.isArray(row.employee_numbers) ? (row.employee_numbers as string[]) : [],
});

export async function loadPayItems(): Promise<CompanyPayItem[]> {
  const { data, error } = await supabase.from('company_pay_items').select(COLUMNS).order('name');
  if (missingTable(error)) return [];
  if (error) throw error;
  return (data ?? []).map((r) => tidy(r as Record<string, unknown>));
}

const friendly = (error: { code?: string; message?: string }, name: string) =>
  error.code === '23505' ? new Error(`There is already a pay item called "${name.trim()}".`) : new Error(error.message || 'Could not save the pay item.');

export async function savePayItem(item: NewCompanyPayItem & { id?: string }): Promise<CompanyPayItem> {
  const { id, ...fields } = item;
  const row = { ...fields, name: fields.name.trim(), scope_id: fields.scope_id || null, notes: fields.notes?.trim() || null };
  const { data, error } = id
    ? await supabase.from('company_pay_items').update(row).eq('id', id).select(COLUMNS).single()
    : await supabase.from('company_pay_items').insert(row).select(COLUMNS).single();
  if (error) throw friendly(error, item.name);
  return tidy(data as Record<string, unknown>);
}

export async function setPayItemActive(id: string, active: boolean) {
  const { error } = await supabase.from('company_pay_items').update({ active }).eq('id', id);
  if (error) throw error;
}

export async function removePayItem(id: string) {
  const { error } = await supabase.from('company_pay_items').delete().eq('id', id);
  if (error) throw error;
}
