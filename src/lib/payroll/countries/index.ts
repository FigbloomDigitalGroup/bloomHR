import { kenyaEngine, kenyaPayslipResult } from './kenya';
import { tanzaniaEngine, tanzaniaPayslipResult } from './tanzania';
import { ugandaEngine, ugandaPayslipResult } from './uganda';
import type { CountryPayrollEngine, PayslipLine, PayslipRecord, PayslipResult } from './types';

export type { CountryPayrollEngine, EmployeeProblem, PayrollInput, PayslipLine, PayslipRecord, PayslipResult, ReturnFile } from './types';
export { kenyaEngine } from './kenya';
export { tanzaniaEngine } from './tanzania';
export { ugandaEngine } from './uganda';

// The registry of country payroll engines (FIG-905). A country without one (Rwanda for now) is "not supported yet": its
// staff are worked out by nobody and shown as waiting for that country's rules, never paid on another country's rules.

const ENGINES: CountryPayrollEngine[] = [kenyaEngine, tanzaniaEngine, ugandaEngine];

/** "tanzania " -> "Tanzania"; the same spelling the database keeps (tidy_country). */
export function tidyCountry(country: string | null | undefined): string {
  const t = (country ?? '').trim();
  if (!t) return '';
  const known = ['Kenya', 'Tanzania', 'Uganda', 'Rwanda'].find((c) => c.toLowerCase() === t.toLowerCase());
  return known ?? t;
}

/** The engine that works out payroll for a country, or null when that country isn't supported yet. */
export function engineFor(country: string | null | undefined): CountryPayrollEngine | null {
  const c = tidyCountry(country).toLowerCase();
  return ENGINES.find((e) => e.country.toLowerCase() === c) ?? null;
}

/** The countries with a payroll engine. */
export const supportedCountries = (): string[] => ENGINES.map((e) => e.country);

/** Shown for staff in a country without an engine: "Waiting for Tanzania payroll rules". */
export const waitingLabel = (country: string) => `Waiting for ${tidyCountry(country) || 'their country’s'} payroll rules`;

/**
 * A saved payslip's statutory deductions and employer costs, labelled, for a country whose payslip lines are not
 * Kenya's (Tanzania: PAYE, NSSF, HESLB; NSSF employer, SDL, WCF. Uganda: PAYE, NSSF, LST; NSSF employer). null for
 * Kenya, whose payslip shows its own lines, and for a country without an engine.
 */
export function countryPayslipLines(record: PayslipRecord | null | undefined): { deductions: PayslipLine[]; employerCosts: PayslipLine[] } | null {
  const country = tidyCountry(String(record?.country ?? ''));
  const result = country === 'Tanzania' ? tanzaniaPayslipResult(record ?? {}) : country === 'Uganda' ? ugandaPayslipResult(record ?? {}) : null;
  return result ? { deductions: result.statutoryDeductions, employerCosts: result.employerCosts } : null;
}

/**
 * A saved (or calculated) payslip as its country's engine labels it (FIG-814): earnings, statutory deductions, employer
 * costs, taxable pay, tax and the working. Kenya's when the payslip has no other country with an engine.
 */
export function payslipResultFor(record: PayslipRecord | null | undefined): PayslipResult {
  const r = record ?? {};
  const country = tidyCountry(String(r.country ?? '')) || 'Kenya';
  if (country === 'Tanzania') return tanzaniaPayslipResult(r);
  if (country === 'Uganda') return ugandaPayslipResult(r);
  return kenyaPayslipResult(r, {});
}
