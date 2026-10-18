import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { DollarSign, Lock } from 'lucide-react';
import { Card } from '../UI';
import { currencyFor } from '../../lib/branches';
import { parseRate, rateText } from '../../lib/payroll/usdPay';
import type { FxRate } from '../../lib/payroll/usdPayApi';

// The Run tab's "USD rate for Kenya this month" (FIG-906), only for countries the company pays in USD. The company types
// the rate it uses (129 this month, 130 the next); nothing is fetched. Last month's rate is offered as a suggestion, but
// nothing is worked out until this month's rate is confirmed, and the country is held back until then. Once the
// country's month is approved, its rate is locked (reopen to change it).

export interface UsdRatePanelProps {
  /** the countries on this month's payroll paid in USD */
  countries: string[];
  periodLabel: string;
  /** this month's confirmed rates, and the latest earlier rate per country (the suggestion) */
  confirmed: Map<string, FxRate>;
  previous: Map<string, FxRate>;
  /** countries whose month is approved or paid: their rate is locked */
  locked: Set<string>;
  canEdit: boolean;
  onConfirm: (country: string, rate: number) => Promise<void>;
}

function RateRow({ country, periodLabel, confirmed, previous, locked, canEdit, onConfirm }: Omit<UsdRatePanelProps, 'countries' | 'confirmed' | 'previous' | 'locked'> & {
  country: string;
  confirmed?: FxRate;
  previous?: FxRate;
  locked: boolean;
}) {
  const local = currencyFor(country);
  const [value, setValue] = useState(String(confirmed?.rate ?? previous?.rate ?? ''));
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(String(confirmed?.rate ?? previous?.rate ?? '')), [confirmed?.rate, previous?.rate]);
  const rate = parseRate(value);
  const id = `usd-rate-${country}`;
  const save = async () => {
    if (!rate) return;
    setBusy(true);
    try {
      await onConfirm(country, rate);
      toast.success(`${country}: ${rateText(rate, local)} for ${periodLabel}. Recalculate to use it.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The rate was not saved.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="px-4 py-3 text-xs" data-testid={`usd-rate-${country}`}>
      <label htmlFor={id} className="font-semibold text-ink">USD rate for {country} this month</label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">1 USD =</span>
        <input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={locked || !canEdit || busy}
          className="w-28 rounded-tile border border-border px-2 py-1 text-xs"
        />
        <span className="text-muted-foreground">{local}</span>
        {locked ? (
          <span className="inline-flex items-center gap-1 text-subtle"><Lock className="w-3 h-3" aria-hidden /> Locked: {country} is approved</span>
        ) : (
          canEdit && (
            <button
              type="button"
              onClick={() => void save()}
              disabled={!rate || busy || rate === confirmed?.rate}
              className="rounded-tile bg-brand px-2.5 py-1 font-semibold text-white disabled:opacity-50"
            >
              {confirmed ? 'Update rate' : 'Confirm rate'}
            </button>
          )
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {confirmed
          ? `Confirmed for ${periodLabel}: ${rateText(confirmed.rate, local)}.`
          : previous
            ? `Last used: ${rateText(previous.rate, local)} (${previous.pay_period}). Confirm it or type this month's rate; ${country} isn't worked out until you do.`
            : `Type the rate your company uses this month; ${country} isn't worked out until you do.`}
        {value && !rate ? ' Type a number, like 129.' : ''}
      </p>
    </li>
  );
}

export default function UsdRatePanel({ countries, confirmed, previous, locked, ...rest }: UsdRatePanelProps) {
  if (countries.length === 0) return null;
  return (
    <Card padding="none" className="!rounded-xl overflow-hidden" data-testid="usd-rates">
      <div className="flex items-start gap-2 px-4 py-3 border-b border-border">
        <DollarSign className="w-4 h-4 text-brand shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-bold text-ink m-0">Paid in USD</h3>
          <p className="text-[11px] text-muted-foreground m-0">
            Pay is converted to the local currency at your rate, tax and contributions are worked out and filed there, and
            payslips show USD.
          </p>
        </div>
      </div>
      <ul className="divide-y divide-border">
        {countries.map((c) => (
          <RateRow key={c} country={c} confirmed={confirmed.get(c)} previous={previous.get(c)} locked={locked.has(c)} {...rest} />
        ))}
      </ul>
    </Card>
  );
}
