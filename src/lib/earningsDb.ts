import { supabase } from './supabase';
import { fetchAll } from './fetchAll';
import type { EarningType, EmployeeEarning, NewEmployeeEarning, ParsedEarningRow } from './earnings';

// The database side of bonuses and incentives (lib/earnings): earning_types and employee_earnings, managed by payroll.

const TYPE_COLUMNS = 'id, name, taxable, pensionable, description, active';

export const loadEarningSetup = async () => {
  const [types, earnings] = await Promise.all([
    supabase.from('earning_types').select(TYPE_COLUMNS).order('name'),
    // every employee's earnings, a page at a time (one request returns at most 1000)
    fetchAll<EmployeeEarning>((from, to) =>
      supabase
        .from('employee_earnings')
        .select('id, employee_number, earning_type_id, amount, start_period, end_period, notes')
        .order('id')
        .range(from, to)
    ),
  ]);
  if (types.error) throw types.error;
  return { types: (types.data ?? []) as EarningType[], earnings };
};

export type EarningTypeFields = Pick<EarningType, 'name' | 'taxable' | 'pensionable' | 'description'>;

const duplicate = (name: string) => new Error(`There is already an earning called "${name.trim()}".`);

export const addEarningType = async (fields: EarningTypeFields) => {
  const { data, error } = await supabase
    .from('earning_types')
    .insert({ ...fields, name: fields.name.trim(), description: fields.description?.trim() || null })
    .select(TYPE_COLUMNS)
    .single();
  if (error) throw error.code === '23505' ? duplicate(fields.name) : error;
  return data as EarningType;
};

export const updateEarningType = async (id: string, fields: Partial<EarningTypeFields & { active: boolean }>) => {
  const { error } = await supabase.from('earning_types').update(fields).eq('id', id);
  if (error) throw error.code === '23505' && fields.name ? duplicate(fields.name) : error;
};

export const saveEmployeeEarning = async (earning: NewEmployeeEarning & { id?: string }) => {
  const { id, ...fields } = earning;
  const { error } = id
    ? await supabase.from('employee_earnings').update(fields).eq('id', id)
    : await supabase.from('employee_earnings').insert(fields);
  if (error) throw error;
};

export const removeEmployeeEarning = async (id: string) => {
  const { error } = await supabase.from('employee_earnings').delete().eq('id', id);
  if (error) throw error;
};

/** Saves uploaded rows as one-off earnings, adding any earning names the company doesn't have yet (taxable). */
export const importEarningRows = async (rows: ParsedEarningRow[], types: EarningType[]) => {
  const byName = new Map(types.map((t) => [t.name.trim().toLowerCase(), t.id]));
  let added = 0;
  for (const name of new Set(rows.map((r) => r.earning))) {
    if (!byName.has(name.toLowerCase())) {
      byName.set(name.toLowerCase(), (await addEarningType({ name, taxable: true, pensionable: true, description: null })).id);
      added += 1;
    }
  }
  const { error } = await supabase.from('employee_earnings').insert(
    rows.map((r) => ({
      employee_number: r.employee_number,
      earning_type_id: byName.get(r.earning.toLowerCase()),
      amount: r.amount,
      start_period: r.period,
      end_period: r.period,
    }))
  );
  if (error) throw error;
  return added;
};
