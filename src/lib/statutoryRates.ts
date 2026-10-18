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
  nita_levy: 'NITA training levy (employer, per employee monthly)',
  // Uganda (FIG-905)
  paye_bands_non_resident: 'PAYE bands (non-resident)',
  paye_surcharge_threshold: 'Extra PAYE above (monthly)',
  paye_surcharge_rate: 'Extra PAYE rate',
  nssf_deductible: 'NSSF deducted before PAYE (1 = yes)',
  lst_bands: 'Local service tax bands (annual amount)',
  lst_deductible: 'LST deducted before PAYE (1 = yes)',
  lst_first_month: 'LST first month of collection (7 = July)',
  lst_months: 'LST months of collection',
  wht_contractual: 'Withholding tax on contractors (services)',
  wht_professional: 'Withholding tax on professional fees',
};

/** A band: up to an amount (null: everything above), at a rate (PAYE) or an annual amount (LST). */
export type RateBand = { upto: number | null; rate?: number; amount?: number };
/** Tanzania's rates (FIG-905, migration 20261021000000_tanzania_payroll.sql), labelled for people. */
export const TANZANIA_RATE_LABELS: Record<string, string> = {
  paye_bands: 'PAYE bands (resident)',
  nonresident_paye_rate: 'PAYE rate for a non-resident (flat, on gross)',
  secondary_paye_rate: 'PAYE rate for a secondary employment (flat)',
  nssf_rate: 'NSSF rate (employee)',
  nssf_employer_rate: 'NSSF rate (employer)',
  nssf_deductible: 'NSSF deducted before PAYE (1 = yes)',
  sdl_rate: 'SDL rate (employer, on gross emoluments)',
  sdl_min_employees: 'SDL applies from this many employees',
  wcf_rate: 'WCF rate (employer, on gross earnings)',
  heslb_rate: 'HESLB loan repayment rate (on basic)',
  wht_resident: 'Withholding tax on a resident contractor’s fees rate',
  wht_nonresident: 'Withholding tax on a non-resident contractor’s fees rate',
};

/** A rate's label in a country: Tanzania's own labels where it has them, else the shared ones (Kenya and Uganda). */
export const rateLabel = (code: string, country = 'Kenya') =>
  (country === 'Tanzania' ? TANZANIA_RATE_LABELS[code] : undefined) ?? RATE_LABELS[code] ?? code;

/** A value that is typed and shown as a percentage (rates, and every withholding tax rate), not an amount or a count. */
export const isPercentCode = (code: string) => /rate$/.test(code) || /^wht_/.test(code);

export interface RateRow {
  id: string;
  tenant_id: string | null;
  code: string;
  value: number | null;
  bands: RateBand[] | null;
  effective_from: string;
  effective_to: string | null;
  source: string | null;
  /** the country the rate is for (FIG-905): Kenya's rows so far */
  country?: string;
}

const fail = (err: unknown, fallback: string): never => {
  const message = (err as { message?: unknown } | null)?.message;
  throw new Error(typeof message === 'string' && message ? message : fallback);
};

/** The rate of each code in force on a day for a country (Kenya by default): the company's own where it has one, else the default. */
export async function ratesInForce(day: string, country = 'Kenya'): Promise<RateRow[]> {
  const { data, error } = await supabase
    .from('statutory_rates')
    .select('id, tenant_id, code, value, bands, effective_from, effective_to, source, country')
    .eq('country', country)
    .lte('effective_from', day)
    .or(`effective_to.is.null,effective_to.gte.${day}`);
  if (error) fail(error, 'Could not load the statutory rates.');
  const byCode = new Map<string, RateRow>();
  for (const r of (data ?? []) as RateRow[]) {
    const seen = byCode.get(r.code);
    if (!seen || (seen.tenant_id === null && r.tenant_id !== null)) byCode.set(r.code, r);
  }
  const order = Object.keys(country === 'Tanzania' ? TANZANIA_RATE_LABELS : RATE_LABELS);
  return [...byCode.values()].sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
}

const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** Gives the company its own rate for a code from a date in a country (a number; PAYE bands stay the default). */
export async function setCompanyRate(code: string, value: number, from: string, source?: string, country = 'Kenya'): Promise<void> {
  if (!Number.isFinite(value) || value < 0) throw new Error('Enter a number of 0 or more.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('Choose the date it starts.');
  const { tenantId } = await currentUserAndTenant();
  // the company's rate already running on that date ends the day before
  const { error: endError } = await supabase
    .from('statutory_rates')
    .update({ effective_to: dayBefore(from) })
    .eq('tenant_id', tenantId).eq('country', country).eq('code', code).lt('effective_from', from).is('effective_to', null);
  if (endError) fail(endError, 'The rate was not saved.');
  const { error } = await supabase.from('statutory_rates').insert({
    tenant_id: tenantId, country, code, value, effective_from: from, source: source?.trim() || 'Set by the company',
  });
  if (error) fail(error, 'The rate was not saved.');
}

/**
 * Gives the company its own bands for a code from a date in a country (PAYE bands, Uganda's LST bands): each band up to
 * an amount, the last for everything above. The bands must go up, with only the last open-ended.
 */
export async function setCompanyBands(code: string, bands: RateBand[], from: string, source?: string, country = 'Kenya'): Promise<void> {
  if (!bands.length) throw new Error('Add at least one band.');
  bands.forEach((b, i) => {
    const last = i === bands.length - 1;
    if (last ? b.upto !== null : !(Number.isFinite(b.upto) && (b.upto as number) > 0)) {
      throw new Error(last ? 'The last band is for everything above: leave its "up to" empty.' : 'Each band but the last needs an "up to" amount.');
    }
    if (i > 0 && !last && (b.upto as number) <= (bands[i - 1].upto as number)) throw new Error('Each band must go up from the one before.');
    const v = b.amount ?? b.rate;
    if (v === undefined || !Number.isFinite(v) || v < 0) throw new Error('Enter a rate or amount of 0 or more for each band.');
  });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('Choose the date it starts.');
  const { tenantId } = await currentUserAndTenant();
  const { error: endError } = await supabase
    .from('statutory_rates')
    .update({ effective_to: dayBefore(from) })
    .eq('tenant_id', tenantId).eq('country', country).eq('code', code).lt('effective_from', from).is('effective_to', null);
  if (endError) fail(endError, 'The bands were not saved.');
  const { error } = await supabase.from('statutory_rates').insert({
    tenant_id: tenantId, country, code, bands, effective_from: from, source: source?.trim() || 'Set by the company',
  });
  if (error) fail(error, 'The bands were not saved.');
}
