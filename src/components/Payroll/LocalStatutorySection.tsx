import { localStatutorySection } from '../../lib/payroll/usdPay';
import { currencySymbol } from '../../lib/payroll/currency';

// On a USD payslip (FIG-906): the statutory figures in the country's own currency, at the month's rate, as they are
// filed with KRA, TRA or URA and the social security funds. "Statutory deductions in KES at 1 USD = 129 KES". Nothing
// for a payslip in local currency.

/* eslint-disable @typescript-eslint/no-explicit-any -- a payroll row or saved payslip */
export default function LocalStatutorySection({ record, compact = false }: { record: any; compact?: boolean }) {
  const section = localStatutorySection(record);
  if (!section) return null;
  const sym = currencySymbol(section.currency);
  const fmt = (n: number) => `${sym} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <div
      className={compact ? 'mt-2 border-t border-border pt-2 text-xs' : 'border border-gray-300 p-3 mb-6 text-sm text-black'}
      data-testid="local-statutory"
    >
      <div className={compact ? 'text-[10px] font-bold uppercase text-subtle mb-1' : 'font-bold mb-1'}>{section.title}</div>
      {section.lines.map((l) => (
        <div key={l.label} className="flex justify-between gap-3">
          <span>{l.label}</span>
          <span className="whitespace-nowrap">{fmt(l.amount)}</span>
        </div>
      ))}
      {!compact && <p className="mt-1 text-xs text-gray-500">Pay above is in USD. These are the amounts filed with the tax and social security bodies.</p>}
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
