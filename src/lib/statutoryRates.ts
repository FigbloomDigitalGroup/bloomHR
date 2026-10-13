import { supabase } from './supabase';
import { currentUserAndTenant } from './privateFiles';

// The statutory_rates table as payroll manages it: every rate with its dates, the platform default or the company's
// own. A company rate starts on a date and runs until replaced; adding one ends the company's previous rate for that
// code the day before.

export const RATE_LABELS: Record<string, string> = {
  paye_bands: 'PAYE bands',
  personal_relief: 'Personal relief (monthly)',
  insurance_relief_rate: 'Insurance relief rate',
  insurance_relief_cap: 'Insurance relief cap (monthly)',
  pension_deduction_cap: 'Pension deduction cap (monthly)',
  prmf_deduction_cap: 'Post-retirement medical fund cap (monthly)',
  mortgage_interest_cap: 'Mortgage interest cap (monthly)',
  non_cash_benefit_exempt_limit: 'Non-cash benefits exempt up to (monthly)',
  meals_exempt_limit: 'Meals exempt up to (monthly)',
  pwd_exempt_income: 'PWD exemption (monthly)',
  shif_deductible: 'SHIF deducted before PAYE (1 = yes)',
  ahl_deductible: 'AHL deducted before PAYE (1 = yes)',
  shif_rate: 'SHIF rate',
  shif_minimum: 'SHIF minimum (monthly)',
  ahl_rate: 'Housing levy rate (employee)',
  ahl_employer_rate: 'Housing levy rate (employer)',
  nssf_rate: 'NSSF rate (employee)',
  nssf_employer_rate: 'NSSF rate (employer)',
  nssf_lower_limit: 'NSSF lower earnings limit',
  nssf_upper_limit: 'NSSF upper earnings limit',
};

export interface RateRow {
  id: string;
  tenant_id: string | null;
  code: string;
  value: number | null;
  bands: { upto: number | null; rate: number }[] | null;
  effective_from: string;
  effective_to: string | null;
  source: string | null;
}

const fail = (err: unknown, fallback: string): never => {
  const message = (err as { message?: unknown } | null)?.message;
  throw new Error(typeof message === 'string' && message ? message : fallback);
};

/** The rate of each code in force on a day: the company's own where it has one, else the default. */
export async function ratesInForce(day: string): Promise<RateRow[]> {
  const { data, error } = await supabase
    .from('statutory_rates')
    .select('id, tenant_id, code, value, bands, effective_from, effective_to, source')
    .lte('effective_from', day)
    .or(`effective_to.is.null,effective_to.gte.${day}`);
  if (error) fail(error, 'Could not load the statutory rates.');
  const byCode = new Map<string, RateRow>();
  for (const r of (data ?? []) as RateRow[]) {
    const seen = byCode.get(r.code);
    if (!seen || (seen.tenant_id === null && r.tenant_id !== null)) byCode.set(r.code, r);
  }
  return [...byCode.values()].sort((a, b) => Object.keys(RATE_LABELS).indexOf(a.code) - Object.keys(RATE_LABELS).indexOf(b.code));
}

const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** Gives the company its own rate for a code from a date (a number; PAYE bands stay the default). */
export async function setCompanyRate(code: string, value: number, from: string, source?: string): Promise<void> {
  if (!Number.isFinite(value) || value < 0) throw new Error('Enter a number of 0 or more.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('Choose the date it starts.');
  const { tenantId } = await currentUserAndTenant();
  // the company's rate already running on that date ends the day before
  const { error: endError } = await supabase
    .from('statutory_rates')
    .update({ effective_to: dayBefore(from) })
    .eq('tenant_id', tenantId).eq('code', code).lt('effective_from', from).is('effective_to', null);
  if (endError) fail(endError, 'The rate was not saved.');
  const { error } = await supabase.from('statutory_rates').insert({
    tenant_id: tenantId, code, value, effective_from: from, source: source?.trim() || 'Set by the company',
  });
  if (error) fail(error, 'The rate was not saved.');
}
