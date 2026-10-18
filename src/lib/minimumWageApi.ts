import { supabase } from './supabase';
import {
  DEFAULT_SETTINGS, type EmployeeMinimum, type MinimumWage, type MinimumWageSettings, type WorkMonthDays, currencyFor, employeeCountry,
} from './minimumWage';

// The database side of the minimum wage check (lib/minimumWage; migration 20261020400000). Every read returns
// "nothing set" on a database without the migration yet, so nothing warns there.

const notThereYet = (error: { code?: string } | null | undefined) =>
  ['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error?.code ?? '');

export async function loadMinimumWages(): Promise<MinimumWage[]> {
  const { data, error } = await supabase
    .from('minimum_wages')
    .select('id, country, monthly_amount, currency, effective_from, notes, created_at')
    .order('effective_from', { ascending: false });
  if (error) {
    if (notThereYet(error)) return [];
    throw error;
  }
  return (data ?? []) as MinimumWage[];
}

export interface MinimumWageInput {
  country: string;
  monthly_amount: number;
  currency?: string;
  effective_from: string;
  notes?: string;
}

export async function addMinimumWage(input: MinimumWageInput): Promise<void> {
  const { error } = await supabase.from('minimum_wages').insert({
    country: input.country.trim(),
    monthly_amount: input.monthly_amount,
    currency: (input.currency || currencyFor(input.country)).toUpperCase(),
    effective_from: input.effective_from,
    notes: input.notes?.trim() || null,
  });
  if (error) {
    if (error.code === '23505') throw new Error(`There is already an amount for ${input.country.trim()} from ${input.effective_from}.`);
    throw error;
  }
}

export async function deleteMinimumWage(id: string): Promise<void> {
  const { error } = await supabase.from('minimum_wages').delete().eq('id', id);
  if (error) throw error;
}

/** The company's settings, its country and the amount in force there on a day (minimum_wage_settings). */
export interface CompanyMinimum extends MinimumWageSettings {
  minimum: EmployeeMinimum;
}

export async function loadCompanyMinimum(day?: string): Promise<CompanyMinimum> {
  const { data, error } = await supabase.rpc('minimum_wage_settings', { p_day: day ?? null });
  if (error) {
    if (notThereYet(error)) return { ...DEFAULT_SETTINGS, minimum: { country: 'Kenya', monthly: null, currency: 'KES' } };
    throw error;
  }
  const d = (data ?? {}) as Record<string, unknown>;
  const country = employeeCountry(d.country as string | null);
  return {
    enabled: d.enabled !== false,
    daysPerMonth: Number(d.days_per_month) || DEFAULT_SETTINGS.daysPerMonth,
    minimum: {
      country,
      monthly: d.monthly_amount === null || d.monthly_amount === undefined ? null : Number(d.monthly_amount),
      currency: String(d.currency ?? currencyFor(country)),
      effectiveFrom: (d.effective_from as string | null) ?? null,
    },
  };
}

export async function saveMinimumWageSettings(patch: Partial<MinimumWageSettings>): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.enabled !== undefined) row.minimum_wage_check = patch.enabled;
  if (patch.daysPerMonth !== undefined) row.minimum_wage_days = patch.daysPerMonth;
  const { error } = await supabase.from('company_payroll_settings').upsert(row, { onConflict: 'tenant_id' });
  if (error) throw error;
}

/** Per employee, the minimum in force on a day (employee_minimum_wages). */
export async function loadEmployeeMinimums(day: string): Promise<Map<string, EmployeeMinimum>> {
  const { data, error } = await supabase.rpc('employee_minimum_wages', { p_day: day });
  if (error) {
    if (notThereYet(error)) return new Map();
    throw error;
  }
  return new Map(
    ((data ?? []) as { employee_number: string; country: string; monthly_amount: number | string | null; currency: string; effective_from: string | null }[])
      .map((r) => [r.employee_number, {
        country: r.country,
        monthly: r.monthly_amount === null ? null : Number(r.monthly_amount),
        currency: r.currency,
        effectiveFrom: r.effective_from,
      }]),
  );
}

/** Per worker, the month's days of approved work and its work and jobs gross (minimum_wage_work_month). */
export async function loadWorkMonth(month: string): Promise<WorkMonthDays[]> {
  const { data, error } = await supabase.rpc('minimum_wage_work_month', { p_month: `${month}-01` });
  if (error) {
    if (notThereYet(error)) return [];
    throw error;
  }
  return (data ?? []) as WorkMonthDays[];
}

/** Everything the Run tab's warning needs for a month. */
export async function loadMinimumWageCheck(payPeriod: string, day: string) {
  const [company, minimums, work] = await Promise.all([loadCompanyMinimum(day), loadEmployeeMinimums(day), loadWorkMonth(payPeriod)]);
  return {
    settings: { enabled: company.enabled, daysPerMonth: company.daysPerMonth } as MinimumWageSettings,
    minimums,
    workDays: new Map(work.map((w) => [w.employee_number, Number(w.days) || 0])),
  };
}
