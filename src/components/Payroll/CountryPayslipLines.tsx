import { countryPayslipLines } from '../../lib/payroll/countries';
import { currencyOf, currencySymbol } from '../../lib/payroll/currency';

// A payslip's statutory deductions and employer costs for a country whose lines are not Kenya's (FIG-905: Tanzania's
// PAYE, NSSF and HESLB; the employer's NSSF, SDL and WCF shown apart, as they are never taken from pay).

/* eslint-disable @typescript-eslint/no-explicit-any -- a payroll row or saved payslip */
export const hasCountryLines = (record: any) => countryPayslipLines(record ?? {}) !== null;

export function CountryDeductionLines({ record, sym }: { record: any; sym?: string }) {
  const lines = countryPayslipLines(record ?? {});
  if (!lines) return null;
  const s = sym ?? currencySymbol(currencyOf(record));
  return (
    <>
      {lines.deductions.map((l) => (
        <div key={l.label} className="flex justify-between">
          <span>{l.label}</span>
          <span className="font-semibold">{s} {Math.round(l.amount).toLocaleString()}</span>
        </div>
      ))}
    </>
  );
}

export function CountryEmployerLines({ record, sym }: { record: any; sym?: string }) {
  const lines = countryPayslipLines(record ?? {});
  if (!lines || lines.employer.length === 0) return null;
  const s = sym ?? currencySymbol(currencyOf(record));
  return (
    <div className="mt-2 border-t border-gray-200 pt-1 text-gray-500" data-testid="employer-costs">
      <div className="text-xs font-semibold uppercase">Paid by the employer (not taken from pay)</div>
      {lines.employer.map((l) => (
        <div key={l.label} className="flex justify-between">
          <span>{l.label}</span>
          <span>{s} {Math.round(l.amount).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
