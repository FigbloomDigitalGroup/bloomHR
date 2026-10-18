/**
 * The minimum wage check (FIG-812 stage 6; migration 20261020400000). Pure: the database calls are in minimumWageApi.
 *
 * One set monthly minimum wage per country, entered by each company (no regions or occupations, nothing seeded). It
 * is a warning only, never a block:
 *   * salaried employees: basic salary (plus any piece rate work or contract jobs that month) against the monthly amount
 *   * paid by work: the month's work + jobs gross against the per-day minimum x the days they recorded approved work
 *   * casual workers: their daily rate against the per-day minimum
 *   * contractors are not checked (a contract for service)
 * The per-day minimum is the monthly amount / the company's working days in a month (26 by default). With the check
 * off, or no amount for the employee's country, nothing is warned about.
 */

/** A row of minimum_wages. */
export interface MinimumWage {
  id: string;
  country: string;
  monthly_amount: number | string;
  currency: string;
  effective_from: string;
  notes?: string | null;
  created_at?: string;
}

export interface MinimumWageSettings {
  /** company_payroll_settings.minimum_wage_check (on by default) */
  enabled: boolean;
  /** company_payroll_settings.minimum_wage_days (26 by default) */
  daysPerMonth: number;
}

export const DEFAULT_SETTINGS: MinimumWageSettings = { enabled: true, daysPerMonth: 26 };

/** The minimum in force for one employee (employee_minimum_wages): null amount when none is set for their country. */
export interface EmployeeMinimum {
  country: string;
  monthly: number | null;
  currency: string;
  effectiveFrom?: string | null;
}

export interface Shortfall {
  employeeNumber: string;
  name: string;
  country: string;
  currency: string;
  /** 'monthly' (a salary) or 'per_day' (paid by work, or a casual's daily rate) */
  basis: 'monthly' | 'per_day';
  pay: number;
  minimum: number;
  shortfall: number;
  /** for per-day comparisons: the days the minimum was multiplied by */
  days?: number;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The countries offered first (the first client's), and their currencies. Any other country can be typed. */
export const COUNTRIES = ['Kenya', 'Tanzania', 'Uganda'] as const;
const CURRENCY: Record<string, string> = { kenya: 'KES', tanzania: 'TZS', uganda: 'UGX', rwanda: 'RWF' };

/** The currency a country's minimum is in, by default (the same as minimum_wage_currency in SQL). */
export const currencyFor = (country: string | null | undefined) => CURRENCY[String(country ?? '').trim().toLowerCase()] ?? 'KES';

/**
 * The country whose minimum applies to an employee: for now the company's country, Kenya when not set (the same as
 * employee_country in SQL; "country as branches" will change both).
 */
export const employeeCountry = (companyCountry: string | null | undefined) => String(companyCountry ?? '').trim() || 'Kenya';

const sameCountry = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The amount in force in a country on a day ('YYYY-MM-DD'): the latest that took effect on or before it. */
export function minimumInForce(rows: MinimumWage[], country: string, day: string): MinimumWage | null {
  return rows
    .filter((r) => sameCountry(r.country, country) && r.effective_from <= day)
    .reduce<MinimumWage | null>((best, r) => (!best || r.effective_from > best.effective_from ? r : best), null);
}

/** A country's amounts, latest first (the settings card's history). */
export function historyByCountry(rows: MinimumWage[]): { country: string; rows: MinimumWage[] }[] {
  const groups = new Map<string, { country: string; rows: MinimumWage[] }>();
  for (const r of rows) {
    const key = r.country.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, { country: r.country.trim(), rows: [] });
    groups.get(key)!.rows.push(r);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, rows: [...g.rows].sort((a, b) => b.effective_from.localeCompare(a.effective_from)) }))
    .sort((a, b) => a.country.localeCompare(b.country));
}

/** The per-day minimum: the monthly amount / working days in a month. */
export const perDayMinimum = (monthly: number, daysPerMonth: number) =>
  round2(monthly / (daysPerMonth > 0 ? daysPerMonth : DEFAULT_SETTINGS.daysPerMonth));

const shortOf = (pay: number, minimum: number) => round2(minimum - pay);

/** A casual worker's daily rate against the per-day minimum: the shortfall a day, or null when it is not below. */
export function casualRateShortfall(dailyRate: unknown, minimum: EmployeeMinimum | null | undefined, settings: MinimumWageSettings): number | null {
  if (!settings.enabled || !minimum || minimum.monthly === null || !(minimum.monthly > 0)) return null;
  const rate = num(dailyRate);
  if (!(rate > 0)) return null;
  const short = shortOf(rate, perDayMinimum(minimum.monthly, settings.daysPerMonth));
  return short > 0 ? short : null;
}

/** The last day of a 'YYYY-MM' month: the day the minimum is read for (as the month's statutory rates are). */
export const periodDay = (payPeriod: string) => {
  const [y, m] = payPeriod.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
};

type Row = Record<string, unknown>;

export interface PayslipCheckInput {
  /** the month's payslips (PayrollDashboard's records: employee_id, employee_name, basic_salary, work_pay, jobs_pay, worker_kind) */
  payslips: Row[];
  /** the employees on the payroll (pay_basis, worker_kind) by employee number */
  employees: Row[];
  minimumFor: (employeeNumber: string) => EmployeeMinimum | null | undefined;
  /** distinct days each worker recorded approved work that month */
  workDays: Map<string, number>;
  settings: MinimumWageSettings;
}

const kindOf = (r: Row | undefined) => String(r?.['worker_kind'] ?? '').trim();

/** Everyone on the month's payroll paid below the minimum wage for their country. */
export function payslipShortfalls({ payslips, employees, minimumFor, workDays, settings }: PayslipCheckInput): Shortfall[] {
  if (!settings.enabled) return [];
  const byNumber = new Map(employees.map((e) => [String(e['Employee Number'] ?? ''), e]));
  const out: Shortfall[] = [];
  for (const p of payslips) {
    const number = String(p['employee_id'] ?? '');
    if (!number) continue;
    const employee = byNumber.get(number);
    const kind = kindOf(p) || kindOf(employee);
    if (kind === 'contractor' || kind === 'casual') continue;
    const minimum = minimumFor(number);
    if (!minimum || minimum.monthly === null || !(minimum.monthly > 0)) continue;
    const work = num(p['work_pay']) + num(p['jobs_pay']);
    const pay = round2(num(p['basic_salary']) + work);
    const byWork = String(employee?.['pay_basis'] ?? '') === 'work' || (num(p['basic_salary']) === 0 && work > 0);
    const base = {
      employeeNumber: number,
      name: String(p['employee_name'] ?? '').trim() || number,
      country: minimum.country,
      currency: minimum.currency,
      pay,
    };
    if (byWork) {
      const days = workDays.get(number) ?? 0;
      if (days <= 0) continue;
      const min = round2(perDayMinimum(minimum.monthly, settings.daysPerMonth) * days);
      const short = shortOf(pay, min);
      if (short > 0) out.push({ ...base, basis: 'per_day', minimum: min, shortfall: short, days });
    } else {
      const short = shortOf(pay, minimum.monthly);
      if (short > 0) out.push({ ...base, basis: 'monthly', minimum: round2(minimum.monthly), shortfall: short });
    }
  }
  return out.sort((a, b) => b.shortfall - a.shortfall || a.name.localeCompare(b.name));
}

/** One worker's month of work (minimum_wage_work_month). */
export interface WorkMonthDays {
  employee_number: string;
  days: number;
  work_gross: number | string;
  jobs_gross: number | string;
}

/**
 * Piece rate workers paid below the per-day minimum x their days of approved work in a month (the Workers list's
 * badge). Contractors and casuals are skipped.
 */
export function workShortfalls(
  months: WorkMonthDays[],
  people: { employee_number: string; worker_kind?: string | null; name?: string }[],
  minimumFor: (employeeNumber: string) => EmployeeMinimum | null | undefined,
  settings: MinimumWageSettings,
): Map<string, Shortfall> {
  const out = new Map<string, Shortfall>();
  if (!settings.enabled) return out;
  const byNumber = new Map(people.map((p) => [p.employee_number, p]));
  for (const m of months) {
    const person = byNumber.get(m.employee_number);
    const kind = String(person?.worker_kind ?? '');
    if (!person || kind === 'contractor' || kind === 'casual') continue;
    const minimum = minimumFor(m.employee_number);
    if (!minimum || minimum.monthly === null || !(minimum.monthly > 0) || !(num(m.days) > 0)) continue;
    const pay = round2(num(m.work_gross) + num(m.jobs_gross));
    const min = round2(perDayMinimum(minimum.monthly, settings.daysPerMonth) * num(m.days));
    const short = shortOf(pay, min);
    if (short > 0) {
      out.set(m.employee_number, {
        employeeNumber: m.employee_number, name: person.name ?? m.employee_number, country: minimum.country, currency: minimum.currency,
        basis: 'per_day', pay, minimum: min, shortfall: short, days: num(m.days),
      });
    }
  }
  return out;
}

/** "KES 16,000" (the minimum's own currency). */
export const money = (amount: number, currency: string) =>
  `${currency} ${amount.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
