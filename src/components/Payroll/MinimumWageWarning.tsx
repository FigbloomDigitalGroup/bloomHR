import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Scale } from 'lucide-react';
import { Card, TableScroll } from '../UI';
import { money, payslipShortfalls, periodDay, type EmployeeMinimum, type MinimumWageSettings } from '../../lib/minimumWage';
import { loadMinimumWageCheck } from '../../lib/minimumWageApi';

// The Run tab's minimum wage warning (FIG-812 stage 6), shown before the month is approved: who on the payroll is paid
// below the minimum wage for their country, with their pay, the minimum and the shortfall. A warning only: approving
// is never blocked. Nothing shows when the check is off, no amount is set, or everyone is at or above it.

type Row = Record<string, unknown>;

interface Loaded {
  settings: MinimumWageSettings;
  minimums: Map<string, EmployeeMinimum>;
  workDays: Map<string, number>;
}

export default function MinimumWageWarning({ payslips, employees, payPeriod, periodLabel, onShortfalls }: {
  payslips: Row[];
  employees: Row[];
  payPeriod: string;
  periodLabel: string;
  /** who is below, counted by country (the Run tab's readiness check per country, FIG-905) */
  onShortfalls?: (byCountry: Map<string, number>) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let live = true;
    setLoaded(null);
    loadMinimumWageCheck(payPeriod, periodDay(payPeriod))
      .then((l) => live && setLoaded(l))
      .catch((err) => console.error('Could not load the minimum wage check:', err));
    return () => {
      live = false;
    };
  }, [payPeriod]);

  const below = useMemo(
    () =>
      loaded
        ? payslipShortfalls({ payslips, employees, minimumFor: (n) => loaded.minimums.get(n), workDays: loaded.workDays, settings: loaded.settings })
        : [],
    [loaded, payslips, employees],
  );
  // reported only when the counts change: reporting the same counts again re-renders the payroll page, which could
  // hand this a new payslip list and come back here (a loop that hung the page)
  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (!onShortfalls) return;
    const byCountry = new Map<string, number>();
    for (const s of below) byCountry.set(s.country, (byCountry.get(s.country) ?? 0) + 1);
    const key = JSON.stringify([...byCountry].sort());
    if (key === reported.current) return;
    reported.current = key;
    onShortfalls(byCountry);
  }, [below, onShortfalls]);
  if (below.length === 0) return null;

  return (
    <Card padding="none" className="!rounded-xl overflow-hidden border-orange-text-alt" data-testid="minimum-wage-warning">
      <div className="flex items-start gap-2 px-4 py-3 text-xs" role="status">
        <Scale className="w-4 h-4 text-orange-text-alt shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1 text-ink">
          <p className="m-0 font-semibold">
            {below.length} {below.length === 1 ? 'person is' : 'people are'} paid below the minimum wage for {periodLabel}
          </p>
          <p className="m-0 text-muted-foreground">
            A warning only: you can still approve. Check their pay, or the amount on the Rates tab. People paid by work are
            compared with the per-day minimum x the days they recorded work.
          </p>
        </div>
      </div>
      <TableScroll>
        <table className="min-w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] font-bold uppercase text-subtle border-t border-border">
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Country</th>
              <th className="px-4 py-2 text-right">Pay</th>
              <th className="px-4 py-2 text-right">Minimum</th>
              <th className="px-4 py-2 text-right">Short by</th>
            </tr>
          </thead>
          <tbody>
            {below.map((s) => (
              <tr key={s.employeeNumber} className="border-t border-[#F1F5F2] text-ink">
                <td className="px-4 py-2">
                  <Link to={`/view-employee/${encodeURIComponent(s.employeeNumber)}`} className="font-semibold text-brand">{s.name}</Link>
                  <div className="text-[10px] text-subtle">{s.employeeNumber}</div>
                </td>
                <td className="px-4 py-2">{s.country}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">{money(s.pay, s.currency)}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {money(s.minimum, s.currency)}
                  {s.basis === 'per_day' && <div className="text-[10px] text-subtle">{s.days} {s.days === 1 ? 'day' : 'days'} of work</div>}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap font-semibold text-status-danger">{money(s.shortfall, s.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </Card>
  );
}
