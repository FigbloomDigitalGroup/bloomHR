import { useState } from 'react';
import toast from 'react-hot-toast';
import { Card } from '../UI';
import { currencyFor } from '../../lib/branches';
import { engineFor } from '../../lib/payroll/countries';
import { USD, payCurrencyOf } from '../../lib/payroll/usdPay';
import { savePayCurrency } from '../../lib/payroll/usdPayApi';
import { usePayCurrencies } from '../../hooks/usePayCurrencies';

// Payroll settings: the currency each country is paid in (FIG-906), one choice per country the company has branches in:
// the country's own currency (the default) or USD. Paid in USD, staff's salary and earnings are in USD and payroll
// converts at the rate entered on the Run tab each month; tax and contributions are still worked out and filed in the
// local currency. Piece rate work, contract jobs and casual pay stay in the local currency.

export default function PayCurrencySetting({ countries, canEdit, onChanged }: { countries: string[]; canEdit: boolean; onChanged?: () => void }) {
  const { payCurrencies, loading, reload } = usePayCurrencies();
  const [busy, setBusy] = useState<string | null>(null);
  const shown = countries.filter((c) => engineFor(c));
  if (shown.length === 0) return null;

  const choose = async (country: string, currency: string) => {
    if (busy || payCurrencyOf(country, payCurrencies) === currency) return;
    setBusy(country);
    try {
      await savePayCurrency(country, currency);
      await reload();
      toast.success(`${country} is paid in ${currency}. Recalculate any draft month.`);
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the pay currency.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card padding="sm">
      <div className="space-y-3 text-xs" data-testid="pay-currency-setting">
        <div>
          <p className="font-semibold text-ink">Pay currency by country</p>
          <p className="text-[11px] text-muted-foreground">
            Pay a country in its own currency or in USD. In USD, salaries, allowances, earnings, deductions and loans for its
            staff are in USD; you enter the month’s rate on the Run tab (no rates are fetched). PAYE and social security are
            still worked out and filed in the local currency.
          </p>
        </div>
        {shown.map((country) => {
          const local = currencyFor(country);
          const current = payCurrencyOf(country, payCurrencies);
          return (
            <fieldset key={country} className="space-y-1" disabled={!canEdit || loading || busy !== null}>
              <legend className="font-semibold text-ink">{country}</legend>
              <div className="flex flex-wrap gap-4">
                {[local, USD].map((c) => (
                  <label key={c} className="flex items-center gap-1.5">
                    <input type="radio" name={`pay-currency-${country}`} checked={current === c} onChange={() => void choose(country, c)} />
                    {c === USD ? 'USD, at a rate we enter each month' : `${c} (default)`}
                  </label>
                ))}
              </div>
              {current === USD && (
                <p className="text-[11px] text-orange-text-alt">
                  Piece rate work, contract jobs and casual pay in {country} stay in {local}; anyone with piece rate work or
                  contract jobs in a month holds {country} back until it is paid in {local}.
                </p>
              )}
            </fieldset>
          );
        })}
      </div>
    </Card>
  );
}
