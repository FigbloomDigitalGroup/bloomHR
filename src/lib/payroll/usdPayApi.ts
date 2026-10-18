import { supabase } from '../supabase';
import type { PayCurrencies } from './usdPay';

// The pay currency per country (company_pay_currencies) and the month's USD rates (payroll_fx_rates), FIG-906. See
// supabase/migrations/20261021500000_usd_pay.sql: payroll chooses and enters them; a rate is locked once its country's
// month is approved.

/** A database without the tables yet (the migration not applied): treated as everyone paid in local currency. */
const missingTable = (error: { code?: string } | null) => ['42P01', 'PGRST205'].includes(error?.code ?? '');

const fail = (error: { message?: string }, fallback: string): never => {
  throw new Error(error.message || fallback);
};

/** The countries the company pays in USD (and any other choice saved), by country. */
export async function loadPayCurrencies(): Promise<PayCurrencies> {
  const { data, error } = await supabase.from('company_pay_currencies').select('country, currency');
  if (error) {
    if (missingTable(error)) return new Map();
    fail(error, 'Could not load the pay currencies.');
  }
  return new Map((data ?? []).map((r: { country: string; currency: string }) => [r.country, r.currency]));
}

/** Chooses the currency a country is paid in: its own or USD. */
export async function savePayCurrency(country: string, currency: string): Promise<void> {
  const { error } = await supabase
    .from('company_pay_currencies')
    .upsert({ country, currency }, { onConflict: 'tenant_id,country' });
  if (error) fail(error, 'The pay currency was not saved.');
}

export interface FxRate {
  pay_period: string;
  country: string;
  rate: number;
  local_currency: string;
  entered_at: string | null;
}

const toRate = (r: Record<string, unknown>): FxRate => ({
  pay_period: String(r.pay_period),
  country: String(r.country),
  rate: Number(r.rate),
  local_currency: String(r.local_currency ?? ''),
  entered_at: (r.entered_at as string | null) ?? null,
});

/**
 * The month's confirmed rates by country, and the latest rate before the month for each (offered as this month's
 * suggestion, never used until confirmed).
 */
export async function loadFxRates(payPeriod: string): Promise<{ confirmed: Map<string, FxRate>; previous: Map<string, FxRate> }> {
  const { data, error } = await supabase
    .from('payroll_fx_rates')
    .select('pay_period, country, rate, local_currency, entered_at')
    .lte('pay_period', payPeriod)
    .order('pay_period', { ascending: false })
    .limit(500);
  if (error) {
    if (missingTable(error)) return { confirmed: new Map(), previous: new Map() };
    fail(error, 'Could not load the USD rates.');
  }
  const confirmed = new Map<string, FxRate>();
  const previous = new Map<string, FxRate>();
  for (const r of (data ?? []).map(toRate)) {
    if (r.pay_period === payPeriod) confirmed.set(r.country, r);
    else if (!previous.has(r.country)) previous.set(r.country, r);
  }
  return { confirmed, previous };
}

/** Confirms a country's USD rate for the month (1 USD = rate local currency). */
export async function saveFxRate(payPeriod: string, country: string, rate: number): Promise<void> {
  const { error } = await supabase
    .from('payroll_fx_rates')
    .upsert({ pay_period: payPeriod, country, rate }, { onConflict: 'tenant_id,pay_period,country' });
  if (error) fail(error, 'The USD rate was not saved.');
}
