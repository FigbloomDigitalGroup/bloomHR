import * as XLSX from 'xlsx';
import { type Branch, currencyFor, employeeBranch } from '../branches';
import { countryPayslipLines, tidyCountry } from '../payroll/countries';
import { kenyaPayslipResult } from '../payroll/countries/kenya';
import { currencyOf } from '../payroll/currency';
import { isContractorSlip } from '../payrollExports';
import type { Rates } from '../statutoryCalc';
import { sheetName } from '../xlsxExport';

// Reports across countries (FIG-905 stage 5). A company with staff in Kenya, Tanzania and Uganda sees one group view,
// filtered to all of it, one country or one branch.
//
//   counts (headcount, joiners, leavers, leave days, absence, casual days, piece-rate workers) are added up across
//   countries: a person is a person wherever they work.
//   money (gross, net, deductions, employer cost, remittances) is kept per currency: KES, TZS and UGX amounts are never
//   added together, and there is no grand total across currencies. Everything below groups money by currency first.
//
// Where a payslip is: its own country and currency (salary_history.country / currency); its branch and department are
// the employee's now (payslips don't keep a branch). Someone who has since moved to a branch in another country keeps
// their payslip in the country that paid it, under "Moved since".

/* eslint-disable @typescript-eslint/no-explicit-any -- employee, payslip and leave rows are the untyped rows the app reads */
type Row = Record<string, any>;

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Kenya first (the company's home country), then the others by name. */
export const countryOrder = (a: string, b: string) => (a === 'Kenya' ? -1 : b === 'Kenya' ? 1 : a.localeCompare(b));
/** KES first, then the other currencies by code. */
export const currencyOrder = (a: string, b: string) => (a === 'KES' ? -1 : b === 'KES' ? 1 : a.localeCompare(b));

export const PER_CURRENCY_NOTE = 'Totals are shown per currency. Amounts in different currencies are never added together.';

// ---------------------------------------------------------------------------------------------
// the filter: everything, one country, or one branch
// ---------------------------------------------------------------------------------------------
export type ReportScope = 'all' | `country:${string}` | `branch:${string}`;

export interface ScopeOption {
  value: ReportScope;
  label: string;
  kind: 'all' | 'country' | 'branch';
}

/** All, then each country the company has a branch in (and any extra, e.g. from payslips), then each active branch. */
export function scopeOptions(branches: Branch[], extraCountries: string[] = []): ScopeOption[] {
  const countries = [...new Set([...branches.map((b) => tidyCountry(b.country)), ...extraCountries.map(tidyCountry)].filter(Boolean))].sort(countryOrder);
  const active = branches
    .filter((b) => b.active)
    .sort((a, b) => countryOrder(tidyCountry(a.country), tidyCountry(b.country)) || a.name.localeCompare(b.name));
  return [
    { value: 'all', label: countries.length > 1 ? 'All countries' : 'All', kind: 'all' },
    ...(countries.length > 1 ? countries.map<ScopeOption>((c) => ({ value: `country:${c}`, label: c, kind: 'country' })) : []),
    ...(active.length > 1 ? active.map<ScopeOption>((b) => ({ value: `branch:${b.id}`, label: `${b.name} · ${tidyCountry(b.country)}`, kind: 'branch' })) : []),
  ];
}

/** "All countries", "Tanzania", "Arusha · Tanzania". */
export function scopeLabel(scope: ReportScope, branches: Branch[]): string {
  if (scope === 'all') return 'All countries';
  if (scope.startsWith('country:')) return scope.slice('country:'.length);
  const b = branches.find((x) => x.id === scope.slice('branch:'.length));
  return b ? `${b.name} · ${tidyCountry(b.country)}` : 'One branch';
}

/** Where a person (or their payslip) is: country, currency and branch. */
export interface Place {
  country: string;
  currency: string;
  branchId: string | null;
  branchName: string;
}

const MOVED = 'Moved since';

/** An employee's country, currency and branch (their branch's; the default branch when they have none; else Kenya). */
export function placeOfEmployee(e: Row | undefined, branches: Branch[]): Place {
  const b = e && branches.length ? employeeBranch(e, branches) : branches.find((x) => x.is_default);
  const country = tidyCountry(b?.country) || 'Kenya';
  return { country, currency: text(b?.currency).toUpperCase() || currencyFor(country), branchId: b?.id ?? null, branchName: b?.name || text(e?.Branch) || 'No branch' };
}

/** A payslip's place: its own country and currency; the employee's branch while it is in that country. */
export function placeOfPayslip(p: Row, employee: Row | undefined, branches: Branch[]): Place {
  const country = tidyCountry(text(p.country)) || 'Kenya';
  const now = placeOfEmployee(employee, branches);
  const same = now.country === country;
  return { country, currency: currencyOf(p), branchId: same ? now.branchId : null, branchName: same ? now.branchName : MOVED };
}

export function inScope(place: Pick<Place, 'country' | 'branchId'>, scope: ReportScope): boolean {
  if (scope === 'all') return true;
  if (scope.startsWith('country:')) return place.country === scope.slice('country:'.length);
  return place.branchId === scope.slice('branch:'.length);
}

// ---------------------------------------------------------------------------------------------
// counts: added up across countries, with the breakdown by country and branch
// ---------------------------------------------------------------------------------------------
export interface Breakdown {
  total: number;
  byCountry: { country: string; count: number; branches: { name: string; count: number }[] }[];
}

/** Adds up counts (a weight each: 1 for a person, the days for leave) by country and branch. */
export function countByPlace(items: { place: Place; weight?: number }[]): Breakdown {
  const countries = new Map<string, { count: number; branches: Map<string, number> }>();
  let total = 0;
  for (const { place, weight = 1 } of items) {
    total += weight;
    const c = countries.get(place.country) ?? { count: 0, branches: new Map<string, number>() };
    c.count += weight;
    c.branches.set(place.branchName, (c.branches.get(place.branchName) ?? 0) + weight);
    countries.set(place.country, c);
  }
  return {
    total: round2(total),
    byCountry: [...countries.entries()]
      .sort(([a], [b]) => countryOrder(a, b))
      .map(([country, c]) => ({
        country,
        count: round2(c.count),
        branches: [...c.branches.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => ({ name, count: round2(count) })),
      })),
  };
}

/** Someone still with the company (not terminated, resigned, exited or inactive). */
export const isCurrentEmployee = (e: Row) => !/terminat|resign|exit|left|inactive|dismiss/i.test(text(e.Status));

/** The month ("2026-10") a date is in, or '' (accepts 2026-10-05, 2026-10-05T..., 05/10/2026 and what Date can read). */
export function monthOf(value: unknown): string {
  const t = text(value);
  if (!t) return '';
  const iso = /^(\d{4})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}`;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export interface HrInput {
  month: string;
  employees: Row[];
  branches: Branch[];
  scope: ReportScope;
  /** employee_exits */
  exits?: Row[];
  /** leave_application */
  leaves?: Row[];
  /** leave_absences */
  absences?: Row[];
  /** casual_days */
  casualDays?: Row[];
}

export interface HrMetric {
  key: string;
  label: string;
  unit: 'people' | 'days';
  breakdown: Breakdown;
}

export interface HrReport {
  headcount: Breakdown;
  metrics: HrMetric[];
  /** leavers in the month for every 100 people (per country too) */
  turnover: { total: number; byCountry: { country: string; percent: number }[] };
}

/** Headcount and the month's HR numbers for the filter: totals across countries, with each country's and branch's. */
export function hrReport(input: HrInput): HrReport {
  const byNumber = new Map(input.employees.map((e) => [text(e['Employee Number']), e]));
  const placeOf = (number: unknown) => placeOfEmployee(byNumber.get(text(number)), input.branches);
  const keep = <T extends { place: Place }>(items: T[]) => items.filter((i) => inScope(i.place, input.scope));

  const current = input.employees.filter(isCurrentEmployee);
  const people = keep(current.map((e) => ({ place: placeOfEmployee(e, input.branches), e })));
  const headcount = countByPlace(people);
  const joiners = people.filter(({ e }) => monthOf(e['Start Date']) === input.month);
  const pieceRate = people.filter(({ e }) => text(e.pay_basis) === 'work');
  const casuals = people.filter(({ e }) => text(e.worker_kind) === 'casual');

  const leavers = keep(
    (input.exits ?? [])
      .filter((x) => !['declined', 'cancelled'].includes(text(x.status)) && monthOf(x.last_working_day) === input.month)
      .map((x) => ({ place: placeOf(x.employee_number) }))
  );
  const leave = keep(
    (input.leaves ?? [])
      .filter((l) => /^approved$/i.test(text(l.status)) && monthOf(l['Start Date']) === input.month)
      .map((l) => ({ place: placeOf(l['Employee Number']), weight: num(l.days) }))
  );
  const absence = keep(
    (input.absences ?? [])
      .filter((a) => text(a.status) !== 'excused' && monthOf(a.start_date) === input.month)
      .map((a) => ({ place: placeOf(a.employee_number), weight: num(a.days) }))
  );
  const casualDays = keep(
    (input.casualDays ?? [])
      .filter((d) => text(d.portion) !== 'absent' && monthOf(d.work_date) === input.month)
      .map((d) => ({ place: placeOf(d.employee_number), weight: text(d.portion) === 'half' ? 0.5 : 1 }))
  );

  const leaverCounts = countByPlace(leavers);
  const pct = (n: number, of: number) => (of > 0 ? round2((n / of) * 100) : 0);
  return {
    headcount,
    metrics: [
      { key: 'joiners', label: 'Joiners', unit: 'people', breakdown: countByPlace(joiners) },
      { key: 'leavers', label: 'Leavers', unit: 'people', breakdown: leaverCounts },
      { key: 'leave', label: 'Leave taken', unit: 'days', breakdown: countByPlace(leave) },
      { key: 'absence', label: 'Unexcused absence', unit: 'days', breakdown: countByPlace(absence) },
      { key: 'casual-days', label: 'Casual days worked', unit: 'days', breakdown: countByPlace(casualDays) },
      { key: 'casuals', label: 'Casual workers', unit: 'people', breakdown: countByPlace(casuals) },
      { key: 'piece-rate', label: 'Piece-rate workers', unit: 'people', breakdown: countByPlace(pieceRate) },
    ],
    turnover: {
      total: pct(leaverCounts.total, headcount.total),
      byCountry: headcount.byCountry.map((c) => ({ country: c.country, percent: pct(leaverCounts.byCountry.find((l) => l.country === c.country)?.count ?? 0, c.count) })),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// money: per currency, never across currencies
// ---------------------------------------------------------------------------------------------
/**
 * Adds up fields per currency: one bucket per currency, sorted KES first. Nothing is ever added across currencies, and
 * there is no grand total.
 */
export function sumByCurrency<T, K extends string>(
  rows: T[],
  currency: (row: T) => string,
  fields: Record<K, (row: T) => number>
): ({ currency: string; count: number } & Record<K, number>)[] {
  const keys = Object.keys(fields) as K[];
  const by = new Map<string, { currency: string; count: number } & Record<K, number>>();
  for (const row of rows) {
    const c = text(currency(row)).toUpperCase() || 'KES';
    let b = by.get(c);
    if (!b) {
      b = { currency: c, count: 0 } as { currency: string; count: number } & Record<K, number>;
      for (const k of keys) (b as Record<string, number>)[k] = 0;
      by.set(c, b);
    }
    b.count += 1;
    for (const k of keys) (b as Record<string, number>)[k] = round2((b as Record<string, number>)[k] + num(fields[k](row)));
  }
  return [...by.values()].sort((a, b) => currencyOrder(a.currency, b.currency));
}

export interface Line {
  label: string;
  amount: number;
}

/** "PAYE (non-resident, flat)" and "PAYE" are one column; so are the withholding tax rates. */
const columnOf = (label: string) => (/^PAYE\b/.test(label) ? 'PAYE' : /^Withholding tax\b/.test(label) ? 'Withholding tax' : label);

/** Each country's own statutory columns, shown even in a month they are nothing. */
const STANDARD: Record<string, { deductions: string[]; employer: string[] }> = {
  Kenya: { deductions: ['PAYE', 'NSSF', 'SHIF', 'Housing levy'], employer: ['NSSF (employer)', 'Housing levy (employer)', 'NITA levy'] },
  Tanzania: { deductions: ['PAYE', 'NSSF', 'HESLB loan repayment'], employer: ['NSSF (employer)', 'SDL (skills levy)', 'WCF (workers compensation)'] },
  Uganda: { deductions: ['PAYE', 'NSSF', 'Local service tax'], employer: ['NSSF (employer)'] },
};

/** A payslip's statutory deductions and employer costs, labelled by its own country's engine. */
export function statutoryLinesOf(p: Row, rates: Rates | null | undefined): { deductions: Line[]; employerCosts: Line[] } {
  const country = tidyCountry(text(p.country)) || 'Kenya';
  if (country === 'Kenya') {
    const r = kenyaPayslipResult(p, rates ?? {});
    return { deductions: r.statutoryDeductions, employerCosts: r.employerCosts };
  }
  return countryPayslipLines(p) ?? { deductions: [], employerCosts: [] };
}

export interface PayslipBreakdown {
  payslip: Row;
  place: Place;
  gross: number;
  statutory: Line[];
  statutoryTotal: number;
  loans: number;
  otherDeductions: number;
  totalDeductions: number;
  net: number;
  employerCosts: Line[];
  employerCostTotal: number;
  /** gross pay plus the employer's costs */
  totalCost: number;
}

/** One payslip's figures, with its place (country, currency, branch). */
export function breakDownPayslip(p: Row, employee: Row | undefined, branches: Branch[], ratesByCountry: Map<string, Rates | null>): PayslipBreakdown {
  const place = placeOfPayslip(p, employee, branches);
  const { deductions, employerCosts } = statutoryLinesOf(p, ratesByCountry.get(place.country));
  const statutory = deductions.map((l) => ({ label: columnOf(l.label), amount: l.amount }));
  const statutoryTotal = round2(statutory.reduce((t, l) => t + l.amount, 0));
  const loans = round2(num(p.loan_deduction) + num(p.advance_deduction));
  const totalDeductions = round2(num(p.total_deductions));
  const employerCostTotal = round2(employerCosts.reduce((t, l) => t + l.amount, 0));
  const gross = round2(num(p.gross_pay));
  return {
    payslip: p, place, gross, statutory, statutoryTotal, loans,
    otherDeductions: round2(Math.max(0, totalDeductions - statutoryTotal - loans)),
    totalDeductions, net: round2(num(p.net_pay)), employerCosts, employerCostTotal, totalCost: round2(gross + employerCostTotal),
  };
}

/** The month's payslips in the filter, each broken down. */
export function payslipsInScope(payslips: Row[], employees: Row[], branches: Branch[], scope: ReportScope, ratesByCountry: Map<string, Rates | null>): PayslipBreakdown[] {
  const byNumber = new Map(employees.map((e) => [text(e['Employee Number']), e]));
  return payslips
    .map((p) => breakDownPayslip(p, byNumber.get(text(p.employee_id)), branches, ratesByCountry))
    .filter((b) => inScope(b.place, scope));
}

const addLines = (into: Map<string, number>, lines: Line[]) => {
  for (const l of lines) into.set(l.label, round2((into.get(l.label) ?? 0) + l.amount));
};
const orderedLines = (sums: Map<string, number>, standard: string[] = []): Line[] => {
  const labels = [...standard, ...[...sums.keys()].filter((k) => !standard.includes(k))];
  return labels.map((label) => ({ label, amount: sums.get(label) ?? 0 }));
};

export interface CountryPayrollSummary {
  country: string;
  currency: string;
  headcount: number;
  gross: number;
  statutory: Line[];
  statutoryTotal: number;
  loans: number;
  otherDeductions: number;
  totalDeductions: number;
  net: number;
  employerCosts: Line[];
  employerCostTotal: number;
  totalCost: number;
  payslips: PayslipBreakdown[];
}

/** The month's payroll per country, each in its own currency, with that country's own statutory lines. */
export function payrollSummary(lines: PayslipBreakdown[]): CountryPayrollSummary[] {
  // by country and currency: a payslip in another currency than its country's would be its own row, never mixed in
  const groups = new Map<string, PayslipBreakdown[]>();
  for (const l of lines) {
    const key = `${l.place.country}|${l.place.currency}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  return [...groups.values()]
    .map((ls) => {
      const { country, currency } = ls[0].place;
      const statutory = new Map<string, number>();
      const employer = new Map<string, number>();
      ls.forEach((l) => {
        addLines(statutory, l.statutory);
        addLines(employer, l.employerCosts);
      });
      const sum = (f: (l: PayslipBreakdown) => number) => round2(ls.reduce((t, l) => t + f(l), 0));
      return {
        country, currency,
        headcount: new Set(ls.map((l) => text(l.payslip.employee_id))).size,
        gross: sum((l) => l.gross),
        statutory: orderedLines(statutory, STANDARD[country]?.deductions),
        statutoryTotal: sum((l) => l.statutoryTotal),
        loans: sum((l) => l.loans),
        otherDeductions: sum((l) => l.otherDeductions),
        totalDeductions: sum((l) => l.totalDeductions),
        net: sum((l) => l.net),
        employerCosts: orderedLines(employer, STANDARD[country]?.employer),
        employerCostTotal: sum((l) => l.employerCostTotal),
        totalCost: sum((l) => l.totalCost),
        payslips: ls,
      };
    })
    .sort((a, b) => countryOrder(a.country, b.country) || currencyOrder(a.currency, b.currency));
}

export interface CurrencySummary {
  currency: string;
  countries: string[];
  headcount: number;
  gross: number;
  statutoryTotal: number;
  loans: number;
  otherDeductions: number;
  totalDeductions: number;
  net: number;
  employerCostTotal: number;
  totalCost: number;
}

/** The countries' payroll added up per currency (countries paying in the same currency add up; others never). */
export function summaryByCurrency(countries: CountryPayrollSummary[]): CurrencySummary[] {
  return sumByCurrency(countries, (c) => c.currency, {
    headcount: (c) => c.headcount,
    gross: (c) => c.gross,
    statutoryTotal: (c) => c.statutoryTotal,
    loans: (c) => c.loans,
    otherDeductions: (c) => c.otherDeductions,
    totalDeductions: (c) => c.totalDeductions,
    net: (c) => c.net,
    employerCostTotal: (c) => c.employerCostTotal,
    totalCost: (c) => c.totalCost,
  }).map(({ count: _count, ...t }) => ({ ...t, countries: countries.filter((c) => c.currency === t.currency).map((c) => c.country) }));
}

// ---------------------------------------------------------------------------------------------
// statutory remittances: what is owed to each authority, per country, and when
// ---------------------------------------------------------------------------------------------
export interface Remittance {
  authority: string;
  label: string;
  amount: number;
  /** the employees' and the employer's parts, when both pay */
  employee?: number;
  employer?: number;
  /** the date it is due (YYYY-MM-DD), when the rules give a day */
  due: string | null;
  dueNote: string;
}

export interface CountryRemittances {
  country: string;
  currency: string;
  items: Remittance[];
  /** what the country owes in all, in its own currency */
  total: number;
}

/** A day of the month after the pay period ("2026-10", 9 -> "2026-11-09"; 'end' -> the last day of November). */
export function dueDate(payPeriod: string, day: number | 'end'): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(payPeriod);
  if (!m) return null;
  const next = new Date(Date.UTC(Number(m[1]), Number(m[2]), 1));
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  const d = day === 'end' ? last : Math.min(day, last);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

type Item = Omit<Remittance, 'due' | 'dueNote'> & { day: number | 'end' | null; note?: string };

/**
 * Each country's remittances. Tanzania's days are the engine's (tanzaniaRemittance: PAYE and SDL by the 7th, HESLB by
 * the 15th, NSSF and WCF by the month's end). Kenya: PAYE, NSSF and SHIF by the 9th; the housing levy within nine
 * working days; NITA has no fixed day. Uganda: PAYE and NSSF by the 15th; LST as the local government asks.
 */
function remittanceItems(country: string, ls: PayslipBreakdown[]): Item[] {
  const sum = (f: (p: Row) => number) => round2(ls.reduce((t, l) => t + num(f(l.payslip)), 0));
  const line = (label: string, employer = false) => round2(ls.reduce((t, l) => t + ((employer ? l.employerCosts : l.statutory).find((x) => x.label === label)?.amount ?? 0), 0));
  const wht = sum((p) => (isContractorSlip(p) ? p.wht_tax : 0));
  const pair = (authority: string, label: string, employee: number, employer: number, day: Item['day'], note?: string): Item => ({
    authority, label, amount: round2(employee + employer), employee, employer, day, note,
  });
  if (country === 'Kenya') {
    return [
      { authority: 'KRA', label: wht ? 'PAYE and withholding tax' : 'PAYE', amount: round2(sum((p) => p.paye_tax) + wht), day: 9 },
      pair('KRA', 'Housing levy (AHL)', sum((p) => p.housing_levy), line('Housing levy (employer)', true), null, 'Within 9 working days after the month'),
      pair('NSSF Kenya', 'NSSF', sum((p) => p.nssf_deduction), line('NSSF (employer)', true), 9),
      { authority: 'SHA', label: 'SHIF', amount: sum((p) => p.nhif_deduction), day: 9 },
      { authority: 'NITA', label: 'NITA training levy', amount: sum((p) => p.nita_levy), day: null, note: 'Employer only' },
    ];
  }
  if (country === 'Tanzania') {
    return [
      { authority: 'TRA', label: wht ? 'PAYE and withholding tax' : 'PAYE', amount: round2(sum((p) => p.paye_tax) + wht), day: 7 },
      { authority: 'TRA', label: 'SDL (skills levy)', amount: sum((p) => p.sdl_levy), day: 7, note: 'Employer only' },
      pair('NSSF Tanzania', 'NSSF', sum((p) => p.nssf_deduction), sum((p) => p.employer_nssf), 'end'),
      { authority: 'WCF', label: 'Workers compensation', amount: sum((p) => p.wcf_levy), day: 'end', note: 'Employer only' },
      { authority: 'HESLB', label: 'Student loan repayments', amount: sum((p) => p.heslb_deduction), day: 15 },
    ];
  }
  if (country === 'Uganda') {
    return [
      { authority: 'URA', label: wht ? 'PAYE and withholding tax' : 'PAYE', amount: round2(sum((p) => p.paye_tax) + wht), day: 15 },
      pair('NSSF Uganda', 'NSSF', sum((p) => p.nssf_deduction), sum((p) => p.employer_nssf), 15),
      { authority: 'Local government', label: 'Local service tax (LST)', amount: sum((p) => p.lst_deduction), day: null, note: 'As the local government asks' },
    ];
  }
  return [];
}

const fmtDue = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** What each country owes each authority for the month, in its own currency, with due dates. */
export function remittanceSummary(lines: PayslipBreakdown[], payPeriod: string): CountryRemittances[] {
  return payrollSummary(lines).map((c) => {
    const items = remittanceItems(c.country, c.payslips).map<Remittance>(({ day, note, ...i }) => {
      const due = day === null ? null : dueDate(payPeriod, day);
      return { ...i, due, dueNote: [due ? `By ${fmtDue(due)}` : '', note ?? ''].filter(Boolean).join(' · ') };
    });
    return { country: c.country, currency: c.currency, items, total: round2(items.reduce((t, i) => t + i.amount, 0)) };
  });
}

// ---------------------------------------------------------------------------------------------
// employer cost by branch and department, per currency
// ---------------------------------------------------------------------------------------------
export interface CostRow {
  currency: string;
  country: string;
  branch: string;
  department: string;
  headcount: number;
  gross: number;
  employerCosts: number;
  totalCost: number;
}

export interface CostGroup {
  currency: string;
  rows: CostRow[];
  /** the currency's total (one currency only) */
  total: Omit<CostRow, 'country' | 'branch' | 'department'>;
}

/** Employer cost per branch and department, grouped by currency, each with its own total. */
export function costByBranchDepartment(lines: PayslipBreakdown[], employees: Row[]): CostGroup[] {
  const byNumber = new Map(employees.map((e) => [text(e['Employee Number']), e]));
  const rows = new Map<string, CostRow & { people: Set<string> }>();
  for (const l of lines) {
    const department = text(byNumber.get(text(l.payslip.employee_id))?.['Job Level']) || 'No department';
    const key = [l.place.currency, l.place.country, l.place.branchName, department].join('|');
    const r = rows.get(key) ?? {
      currency: l.place.currency, country: l.place.country, branch: l.place.branchName, department, headcount: 0, gross: 0, employerCosts: 0, totalCost: 0, people: new Set<string>(),
    };
    r.people.add(text(l.payslip.employee_id));
    r.headcount = r.people.size;
    r.gross = round2(r.gross + l.gross);
    r.employerCosts = round2(r.employerCosts + l.employerCostTotal);
    r.totalCost = round2(r.totalCost + l.totalCost);
    rows.set(key, r);
  }
  const all = [...rows.values()].map(({ people: _people, ...r }) => r);
  return sumByCurrency(all, (r) => r.currency, { headcount: (r) => r.headcount, gross: (r) => r.gross, employerCosts: (r) => r.employerCosts, totalCost: (r) => r.totalCost }).map(
    ({ count: _count, ...total }) => ({
      currency: total.currency,
      rows: all
        .filter((r) => r.currency === total.currency)
        .sort((a, b) => countryOrder(a.country, b.country) || a.branch.localeCompare(b.branch) || a.department.localeCompare(b.department)),
      total,
    })
  );
}

// ---------------------------------------------------------------------------------------------
// the Excel workbook: one sheet per country, and the summary by currency
// ---------------------------------------------------------------------------------------------
export const SUMMARY_SHEET = 'Summary by currency';

/** The payroll summary as an Excel workbook: a sheet per country (its own currency and lines) and "Summary by currency". */
export function payrollSummaryWorkbook(countries: CountryPayrollSummary[], payPeriod: string): ArrayBuffer {
  const book = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const c of countries) {
    let name = sheetName(`${c.country} (${c.currency})`);
    while (used.has(name)) name = sheetName(`${name} 2`);
    used.add(name);
    const deductionLabels = c.statutory.map((l) => l.label);
    const employerLabels = c.employerCosts.map((l) => l.label);
    const rows: (string | number)[][] = [
      [`${c.country} payroll summary, ${payPeriod}`, `Amounts in ${c.currency}`],
      [],
      ['Item', `Amount (${c.currency})`],
      ['Headcount', c.headcount],
      ['Gross pay', c.gross],
      ...c.statutory.map((l) => [l.label, l.amount]),
      ['Statutory deductions', c.statutoryTotal],
      ['Loans and advances', c.loans],
      ['Other deductions', c.otherDeductions],
      ['Total deductions', c.totalDeductions],
      ['Net pay', c.net],
      ...c.employerCosts.map((l) => [l.label, l.amount]),
      ['Employer costs', c.employerCostTotal],
      ['Total employer cost (gross + employer costs)', c.totalCost],
      [],
      ['Employee number', 'Name', 'Branch', 'Gross pay', ...deductionLabels, 'Loans and advances', 'Other deductions', 'Net pay', ...employerLabels, 'Total employer cost'],
      ...c.payslips.map((l) => [
        text(l.payslip.employee_id), text(l.payslip.employee_name), l.place.branchName, l.gross,
        ...deductionLabels.map((lab) => l.statutory.find((x) => x.label === lab)?.amount ?? 0),
        l.loans, l.otherDeductions, l.net,
        ...employerLabels.map((lab) => l.employerCosts.find((x) => x.label === lab)?.amount ?? 0),
        l.totalCost,
      ]),
    ];
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  const summary = summaryByCurrency(countries);
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      [`Payroll summary by currency, ${payPeriod}`],
      [PER_CURRENCY_NOTE],
      [],
      ['Currency', 'Countries', 'Headcount', 'Gross pay', 'Statutory deductions', 'Loans and advances', 'Other deductions', 'Total deductions', 'Net pay', 'Employer costs', 'Total employer cost'],
      ...summary.map((s) => [
        s.currency, s.countries.join(', '), s.headcount, s.gross, s.statutoryTotal, s.loans, s.otherDeductions, s.totalDeductions, s.net, s.employerCostTotal, s.totalCost,
      ]),
    ]),
    SUMMARY_SHEET
  );
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
