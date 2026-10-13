import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { lastDayOf } from '../lib/payrollExports';
import type { Rates } from '../lib/statutoryCalc';

/**
 * The statutory rates in force for a pay period ('YYYY-MM'): the company's own rate where it has one, else the default
 * (statutory_rates, read for the period's last day). `rates` is null until loaded, and stays null if loading failed.
 */
export default function useStatutoryRates(payPeriod: string) {
  const [rates, setRates] = useState<Rates | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase.rpc('statutory_rates_on', { p_day: lastDayOf(payPeriod) });
    if (err) {
      setRates(null);
      setError(err.message || 'Could not load the statutory rates.');
      return;
    }
    setRates((data ?? {}) as Rates);
  }, [payPeriod]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { rates, isLoading: rates === null && error === null, error, reload };
}
