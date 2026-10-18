import { kenyaEngine } from './kenya';
import type { CountryPayrollEngine } from './types';

export type { CountryPayrollEngine, EmployeeProblem, PayrollInput, PayslipLine, PayslipRecord, PayslipResult, ReturnFile } from './types';
export { kenyaEngine } from './kenya';

// The registry of country payroll engines (FIG-905 stage 2). A country without one (Tanzania and Uganda until their
// stages) is "not supported yet": its staff are worked out by nobody and shown as waiting for that country's rules,
// never paid on another country's rules.

const ENGINES: CountryPayrollEngine[] = [kenyaEngine];

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
