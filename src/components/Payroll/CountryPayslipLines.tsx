import { countryPayslipLines } from '../../lib/payroll/payslipLines';
import { currencyOf, currencySymbol } from '../../lib/payroll/currency';

// The statutory lines of a payslip from a country other than Kenya (FIG-905): Uganda's PAYE, NSSF (5%) and Local
// Service Tax, with the employer's NSSF (10%) shown as a cost the employer pays, not taken from pay. Kenya's payslips
// keep their own lines (PAYE, SHIF, NSSF, AHL, relief, NITA), so the documents check isKenyaPayslip first.

/* eslint-disable @typescript-eslint/no-explicit-any -- payslip rows are the untyped rows the payroll page uses */
const amount = (n: number) => Math.round(n).toLocaleString();

export function CountryDeductionLines({ record }: { record: any }) {
  const lines = countryPayslipLines(record);
  if (!lines) return null;
  const sym = currencySymbol(currencyOf(record));
  return (
    <>
      {/* a contractor's withholding tax has its own line (WhtDeductionLine) */}
      {lines.deductions.filter((l) => l.label !== 'Withholding tax').map((l) => (
        <div key={l.label} className="flex justify-between">
          <span>{l.label}</span>
          <span className="font-semibold">{sym} {amount(l.amount)}</span>
        </div>
      ))}
      {lines.employerCosts.map((l) => (
        <div key={l.label} className="flex justify-between text-gray-500">
          <span>{l.label} (paid by employer)</span>
          <span>{sym} {amount(l.amount)}</span>
        </div>
      ))}
    </>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
