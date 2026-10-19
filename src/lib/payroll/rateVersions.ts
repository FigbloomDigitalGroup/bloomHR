import type { Rates } from '../statutoryCalc';
import type { PayslipContext } from '../payslipCalc';
import { engineFor } from './countries';
import type { PayslipLine } from './countries/types';

/**
 * Dated rate versions (FIG-813), pure: what the database does with statutory_rates, so the platform rates screen can
 * preview a change and the per-Finance-Act tests can pin the rules on the dated rows themselves.
 *
 *   ratesOn(rows, day, country, tenant)   statutory_rates_on(): every code's version in force on the day, a company's
 *                                         own winning over the platform default
 *   withVersion(rows, change)             add_platform_rate(): the new platform version from its date; the version in
 *                                         force then ends the day before, a later one keeps its date
 *   rateChangeProblems(change, ...)       the checks add_platform_rate() makes (bands go up, rates between 0 and 1, a
 *                                         date not inside an approved month unless confirmed)
 *   previewChange(...)                    old vs new figures for sample salaries, worked out by the country's engine
 */

/** A row of statutory_rates. */
export interface RateVersion {
  tenant_id: string | null;
  country: string;
  code: string;
  value: number | null;
  bands: Record<string, unknown>[] | null;
  effective_from: string;
  effective_to: string | null;
  source?: string | null;
}

/** A new platform version of one rate (or band set) for a country. */
export interface RateChange {
  country: string;
  code: string;
  value: number | null;
  bands: { upto: number | null; rate?: number; amount?: number }[] | null;
  from: string;
  source: string;
}

const sameCountry = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** The last day of a pay period: '2026-10' -> '2026-10-31'. */
export const periodEnd = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** Every code's version in force on a day for a country, as statutory_rates_on() returns it to a company. */
export function ratesOn(rows: RateVersion[], day: string, country: string, tenantId: string | null = null): Rates {
  const chosen = new Map<string, RateVersion>();
  for (const r of rows) {
    if (!sameCountry(r.country, country)) continue;
    if (r.tenant_id !== null && r.tenant_id !== tenantId) continue;
    if (r.effective_from > day || (r.effective_to !== null && r.effective_to < day)) continue;
    const seen = chosen.get(r.code);
    if (!seen || (seen.tenant_id === null && r.tenant_id !== null)) chosen.set(r.code, r);
  }
  const out: Rates = {};
  for (const [code, r] of chosen) out[code] = r.value ?? r.bands;
  return out;
}

/** The rows once a new platform version is added (what add_platform_rate() does; a version from the same day is replaced). */
export function withVersion(rows: RateVersion[], change: RateChange): RateVersion[] {
  const isPlatformCode = (r: RateVersion) => r.tenant_id === null && sameCountry(r.country, change.country) && r.code === change.code;
  const same = rows.find((r) => isPlatformCode(r) && r.effective_from === change.from);
  const next: RateVersion = {
    tenant_id: null,
    country: change.country,
    code: change.code,
    value: change.value,
    bands: change.bands,
    effective_from: change.from,
    effective_to: null,
    source: change.source,
  };
  if (same) return rows.map((r) => (r === same ? { ...next, effective_to: r.effective_to } : r));
  const later = rows.filter((r) => isPlatformCode(r) && r.effective_from > change.from).map((r) => r.effective_from).sort()[0];
  next.effective_to = later ? dayBefore(later) : null;
  return [
    ...rows.map((r) =>
      isPlatformCode(r) && r.effective_from < change.from && (r.effective_to === null || r.effective_to >= change.from)
        ? { ...r, effective_to: dayBefore(change.from) }
        : r
    ),
    next,
  ];
}

/** A code that is a share between 0 and 1 (a rate, every withholding tax rate). */
export const isShareCode = (code: string) => /rate$/.test(code) || /^wht_/.test(code);

/**
 * What is wrong with a change (none: it can be saved). The same checks as the database's platform_rate_problems and
 * add_platform_rate. `latestApproved` is the latest month any company has approved for the country: a rate starting
 * before its end reaches back into it and needs `confirmBackdate`.
 */
export function rateChangeProblems(change: RateChange, opts: { latestApproved?: string | null; confirmBackdate?: boolean } = {}): string[] {
  const problems: string[] = [];
  if (!change.country.trim()) problems.push('Choose a country');
  if (!/^[a-z][a-z0-9_]*$/.test(change.code)) problems.push('Choose a rate code (lower case letters, digits and _)');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(change.from)) problems.push('Choose the date the rate starts');
  if (!change.source.trim()) problems.push('Say where the rate comes from (the Act or notice)');
  if ((change.value === null) === (change.bands === null)) {
    problems.push('Give either a value or bands, not both');
    return problems;
  }
  if (change.value !== null) {
    const v = change.value;
    if (!Number.isFinite(v)) problems.push('Enter a number');
    else if (v < 0) problems.push("The value can't be below 0");
    else if (isShareCode(change.code) && v > 1) problems.push('A rate is a share between 0 and 1 (e.g. 0.015 for 1.5%)');
    else if (/_deductible$/.test(change.code) && v !== 0 && v !== 1) problems.push('Deductible is 1 (yes) or 0 (no)');
  } else {
    const bands = change.bands ?? [];
    if (!bands.length) problems.push('Add at least one band');
    let prev = 0;
    bands.forEach((b, i) => {
      const last = i === bands.length - 1;
      if (!last) {
        if (b.upto === null || !Number.isFinite(b.upto) || b.upto <= prev) problems.push(`Band ${i + 1}: each band's "up to" must be above the one before`);
        else prev = b.upto;
      } else if (b.upto !== null) {
        problems.push('The last band is for everything above: leave its "up to" empty');
      }
      if (b.rate !== undefined) {
        if (!Number.isFinite(b.rate) || b.rate < 0 || b.rate > 1) problems.push(`Band ${i + 1}: a rate is a share between 0 and 1`);
      } else if (b.amount !== undefined) {
        if (!Number.isFinite(b.amount) || b.amount < 0) problems.push(`Band ${i + 1}: the amount can't be below 0`);
      } else {
        problems.push(`Band ${i + 1}: give a rate or an amount`);
      }
    });
  }
  if (opts.latestApproved && /^\d{4}-\d{2}-\d{2}$/.test(change.from) && change.from <= periodEnd(opts.latestApproved) && !opts.confirmBackdate) {
    problems.push(
      `Payroll for ${opts.latestApproved} is already approved by at least one company: confirm that this rate reaches back into approved months (they keep their payslips and need amended returns; drafts are flagged for recalculation)`
    );
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// the preview: old vs new for sample salaries
// ---------------------------------------------------------------------------------------------
/** The sample monthly salaries the preview starts with, in the country's currency. */
export const SAMPLE_SALARIES: Record<string, number[]> = {
  Kenya: [30000, 100000, 500000],
  Tanzania: [500000, 1500000, 5000000],
  Uganda: [500000, 2000000, 10000000],
};

export interface PreviewFigures {
  gross: number;
  tax: number;
  deductions: PayslipLine[];
  employerCosts: PayslipLine[];
  net: number;
}

export interface PreviewRow {
  salary: number;
  before: PreviewFigures;
  after: PreviewFigures;
}

/** A full-time employee on a basic salary, with every number and PIN, as the preview pays them. */
const sampleEmployee = (salary: number) => ({
  'Employee Number': 'PREVIEW',
  'First Name': 'Sample',
  'Last Name': 'Employee',
  'Basic Salary': salary,
  'Tax PIN': 'PREVIEW',
  'NSSF Number': 'PREVIEW',
  'SHIF Number': 'PREVIEW',
  worker_kind: 'employee',
});

/** The month's context with nothing but the rates: no leave, overtime, loans or other earnings. */
const sampleContext = (period: string, rates: Rates): PayslipContext => ({
  period,
  rates,
  overrideStatutoryChecks: true,
  voluntaryByEmployee: new Map(),
  payrollLoans: [],
  earningsByEmployee: new Map(),
  leaveByEmployee: new Map(),
  leaveBasis: 'basic_30',
  absenceByEmployee: new Map(),
  leavePayouts: new Map(),
  overtimeMonth: undefined,
  advanceFor: () => 0,
  countryHeadcount: undefined,
});

/** One sample salary's figures with a set of rates, by the country's own engine (the payroll's calculation). */
export function previewFigures(country: string, salary: number, period: string, rates: Rates): PreviewFigures | null {
  const engine = engineFor(country);
  if (!engine) return null;
  const r = engine.calculate({ employee: sampleEmployee(salary), ctx: sampleContext(period, rates) });
  return { gross: r.grossPay, tax: r.tax, deductions: r.statutoryDeductions, employerCosts: r.employerCosts, net: r.netPay };
}

/** Old vs new figures for each sample salary, for the month the change starts. */
export function previewChange(country: string, salaries: number[], period: string, before: Rates, after: Rates): PreviewRow[] {
  return salaries
    .filter((s) => Number.isFinite(s) && s > 0)
    .flatMap((salary) => {
      const b = previewFigures(country, salary, period, before);
      const a = previewFigures(country, salary, period, after);
      return b && a ? [{ salary, before: b, after: a }] : [];
    });
}

/**
 * Every deduction label either side has, so old and new line up: in the payslip's order, read from the highest salary
 * first (a low salary may pay no PAYE at all).
 */
export const previewLabels = (rows: PreviewRow[], key: 'deductions' | 'employerCosts' = 'deductions') => {
  const labels: string[] = [];
  const bySalary = [...rows].sort((a, b) => b.salary - a.salary);
  for (const r of bySalary) for (const l of [...r.before[key], ...r.after[key]]) if (!labels.includes(l.label)) labels.push(l.label);
  return labels;
};

export const lineAmount = (lines: PayslipLine[], label: string) => lines.find((l) => l.label === label)?.amount ?? 0;
