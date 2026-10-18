import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { lastDayOf } from '../lib/payrollExports';
import type { Rates } from '../lib/statutoryCalc';

/**
 * The statutory rates in force for a pay period, for each country with a payroll engine (FIG-905): each country's own
 * dated statutory_rates, read for the period's last day. `ratesByCountry` is null until every country has loaded; a
 * country whose rates failed to load is null in the map (its payroll is held back, the others go ahead).
 */
export default function useCountryRates(payPeriod: string, countries: string[]) {
  const [ratesByCountry, setRatesByCountry] = useState<Map<string, Rates | null> | null>(null);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const key = countries.join('|');

  const reload = useCallback(async () => {
    const list = key ? key.split('|') : [];
    const results = await Promise.all(
      list.map(async (country) => {
        const { data, error } = await supabase.rpc('statutory_rates_on', { p_day: lastDayOf(payPeriod), p_country: country });
        return { country, rates: error ? null : ((data ?? {}) as Rates), error: error ? error.message || 'Could not load the statutory rates.' : null };
      })
    );
    setRatesByCountry(new Map(results.map((r) => [r.country, r.rates])));
    setErrors(new Map(results.filter((r) => r.error).map((r) => [r.country, r.error as string])));
  }, [payPeriod, key]);

  useEffect(() => {
    setRatesByCountry(null);
    void reload();
  }, [reload]);

  return { ratesByCountry, errors, isLoading: ratesByCountry === null, reload };
}
