import { ugandaPayslipResult } from './countries/uganda';

// A payslip's statutory lines for a country other than Kenya (FIG-905): Uganda's PAYE, NSSF (5%) and Local Service
// Tax, and the employer's NSSF (10%) as an employer cost. Kenya's payslips keep their own lines.

/* eslint-disable @typescript-eslint/no-explicit-any -- payslip rows are the untyped rows the payroll page uses */
const countryOf = (record: any) => String(record?.country ?? '').trim() || 'Kenya';

export const isKenyaPayslip = (record: any) => countryOf(record).toLowerCase() === 'kenya';

/** The payslip's statutory deductions and employer costs as labelled lines, or null for Kenya (and unknown countries). */
export function countryPayslipLines(record: any) {
  if (countryOf(record).toLowerCase() !== 'uganda') return null;
  const r = ugandaPayslipResult(record);
  return { deductions: r.statutoryDeductions, employerCosts: r.employerCosts };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
