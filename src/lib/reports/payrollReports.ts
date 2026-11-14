import { type ReportFilters, type Row, addMonths, byNumber, fullName, matchesFilters, monthOf } from './reportKit';

// The payroll reports (Staff salary, Staff other deductions): pure calculations over salary_history rows (one payslip
// per employee per month), so the pages only read, filter and render. Money is never added across currencies: every
// total is kept per currency.

const num = (v: unknown) => Number(v) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The payslip's currency code (KES for payslips saved before currencies were recorded). */
export const currencyOfPayslip = (p: Row) => {
  const c = String(p?.currency ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : 'KES';
};

/** KES first, then the rest by code. */
export const currencyOrder = (a: string, b: string) => (a === 'KES' ? -1 : b === 'KES' ? 1 : a.localeCompare(b));

/** A per-currency record as [currency, amount] pairs, KES first. */
export const currencyEntries = (totals: Record<string, number>) =>
  Object.entries(totals).sort(([a], [b]) => currencyOrder(a, b));

/** Adds `amount` to `totals[currency]`. */
function addTo(totals: Record<string, number>, currency: string, amount: number) {
  totals[currency] = round2((totals[currency] ?? 0) + amount);
}

// ---------------------------------------------------------------------------------------------
// months
// ---------------------------------------------------------------------------------------------

/** The latest valid pay period among these, or null. */
export function latestPeriod(periods: unknown[]): string | null {
  let latest: string | null = null;
  for (const p of periods) {
    const s = String(p ?? '').slice(0, 7);
    if (PERIOD.test(s) && (!latest || s > latest)) latest = s;
  }
  return latest;
}

/** The month a salary report opens on: the latest month with payslips, else last month. */
export const defaultMonth = (latest: string | null, today: Date = new Date()) => latest ?? addMonths(monthOf(today), 1);

/** The range the deductions report opens on: the three months up to the latest month with payslips. */
export function defaultRange(latest: string | null, today: Date = new Date()) {
  const to = defaultMonth(latest, today);
  return { from: addMonths(to, 2), to };
}

// ---------------------------------------------------------------------------------------------
// filters
// ---------------------------------------------------------------------------------------------

/** The employee row behind a payslip, or a stand-in from the payslip itself (name and number, no branch). */
const personOf = (p: Row, employees: Map<string, Row>): Row =>
  employees.get(String(p.employee_id)) ?? { 'Employee Number': p.employee_id, 'First Name': p.employee_name };

/** The payslips whose person matches the branch / department / search filters (by the person's current place). */
export function filterPayslips(payslips: Row[], employees: Row[], filters: ReportFilters): Row[] {
  const people = byNumber(employees);
  return payslips.filter((p) => matchesFilters(personOf(p, people), filters));
}

/** Department id -> name */
const departmentNames = (departments: { id: string; name: string }[]) => new Map(departments.map((d) => [d.id, d.name]));

// ---------------------------------------------------------------------------------------------
// Staff salary
// ---------------------------------------------------------------------------------------------

export interface SalaryLine {
  employeeNumber: string;
  name: string;
  department: string;
  jobGroup: string;
  currency: string;
  basic: number;
  allowances: number;
  overtime: number;
  gross: number;
  paye: number;
  shif: number;
  nssf: number;
  housingLevy: number;
  otherDeductions: number;
  net: number;
  paymentMethod: string;
}

export type SalaryAmount = 'basic' | 'allowances' | 'overtime' | 'gross' | 'paye' | 'shif' | 'nssf' | 'housingLevy' | 'otherDeductions' | 'net';

/** The money columns of the salary table, in order. */
export const SALARY_AMOUNTS: { key: SalaryAmount; label: string }[] = [
  { key: 'basic', label: 'Basic' },
  { key: 'allowances', label: 'Allowances' },
  { key: 'overtime', label: 'Overtime and piece rate' },
  { key: 'gross', label: 'Gross' },
  { key: 'paye', label: 'PAYE' },
  { key: 'shif', label: 'SHIF' },
  { key: 'nssf', label: 'NSSF' },
  { key: 'housingLevy', label: 'Housing Levy' },
  { key: 'otherDeductions', label: 'Other deductions' },
  { key: 'net', label: 'Net' },
];

/** One payslip as a row of the salary table. */
export function salaryLine(p: Row, employee: Row | undefined, departmentName: string): SalaryLine {
  return {
    employeeNumber: String(p.employee_id ?? ''),
    name: (employee ? fullName(employee) : '') || String(p.employee_name ?? p.employee_id ?? ''),
    department: departmentName,
    jobGroup: String(employee?.['Job Group'] ?? ''),
    currency: currencyOfPayslip(p),
    basic: num(p.basic_salary),
    allowances: round2(num(p.house_allowance) + num(p.transport_allowance) + num(p.medical_allowance) + num(p.other_allowances)),
    overtime: round2(num(p.overtime_pay) + num(p.work_pay) + num(p.jobs_pay)),
    gross: num(p.gross_pay),
    paye: num(p.paye_tax),
    shif: num(p.nhif_deduction),
    nssf: num(p.nssf_deduction),
    housingLevy: num(p.housing_levy),
    otherDeductions: round2(num(p.loan_deduction) + num(p.advance_deduction) + num(p.welfare_deduction) + num(p.other_deductions)),
    net: num(p.net_pay),
    paymentMethod: String(p.payment_method ?? ''),
  };
}

/** The salary table's rows, by employee number. */
export function salaryLines(payslips: Row[], employees: Row[], departments: { id: string; name: string }[]): SalaryLine[] {
  const people = byNumber(employees);
  const names = departmentNames(departments);
  return payslips
    .map((p) => {
      const e = people.get(String(p.employee_id));
      return salaryLine(p, e, names.get(e?.department_id) ?? '');
    })
    .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber, undefined, { numeric: true }));
}

export type SalaryTotals = { currency: string; count: number } & Record<SalaryAmount, number>;

/** The salary table's totals, one row per currency (KES first). */
export function salaryTotals(lines: SalaryLine[]): SalaryTotals[] {
  const out = new Map<string, SalaryTotals>();
  for (const l of lines) {
    let t = out.get(l.currency);
    if (!t) {
      t = { currency: l.currency, count: 0, ...(Object.fromEntries(SALARY_AMOUNTS.map((a) => [a.key, 0])) as Record<SalaryAmount, number>) };
      out.set(l.currency, t);
    }
    t.count += 1;
    for (const { key } of SALARY_AMOUNTS) t[key] = round2(t[key] + l[key]);
  }
  return [...out.values()].sort((a, b) => currencyOrder(a.currency, b.currency));
}

export interface SalarySummary {
  /** people paid (each counted once) */
  staff: number;
  gross: Record<string, number>;
  net: Record<string, number>;
  /** PAYE + SHIF + NSSF + Housing Levy */
  statutory: Record<string, number>;
}

export function salarySummary(lines: SalaryLine[]): SalarySummary {
  const out: SalarySummary = { staff: new Set(lines.map((l) => l.employeeNumber)).size, gross: {}, net: {}, statutory: {} };
  for (const l of lines) {
    addTo(out.gross, l.currency, l.gross);
    addTo(out.net, l.currency, l.net);
    addTo(out.statutory, l.currency, l.paye + l.shif + l.nssf + l.housingLevy);
  }
  return out;
}

export type RunStatus = 'draft' | 'approved' | 'paid';

/** The payroll status of a month from its runs: the furthest along (paid, then approved, then draft), or null. */
export function runStatus(runs: Row[], month: string): RunStatus | null {
  const statuses = new Set(runs.filter((r) => String(r.pay_period ?? '').slice(0, 7) === month).map((r) => String(r.status ?? '')));
  for (const s of ['paid', 'approved', 'draft'] as const) if (statuses.has(s)) return s;
  return null;
}

export interface TrendMonth {
  month: string;
  staff: number;
  gross: Record<string, number>;
  net: Record<string, number>;
}

/** Per month (oldest first): people paid, gross and net per currency. */
export function monthTrend(payslips: Row[], months: string[]): TrendMonth[] {
  return months.map((month) => {
    const these = payslips.filter((p) => String(p.pay_period ?? '').slice(0, 7) === month);
    const gross: Record<string, number> = {};
    const net: Record<string, number> = {};
    for (const p of these) {
      addTo(gross, currencyOfPayslip(p), num(p.gross_pay));
      addTo(net, currencyOfPayslip(p), num(p.net_pay));
    }
    return { month, staff: new Set(these.map((p) => String(p.employee_id))).size, gross, net };
  });
}

/** The salary table as a sheet: headers and rows (same columns as on screen). */
export function salarySheet(lines: SalaryLine[]) {
  const headers = ['Employee no.', 'Name', 'Department', 'Job group', 'Currency', ...SALARY_AMOUNTS.map((a) => a.label), 'Payment method'];
  const rows = lines.map((l) => [l.employeeNumber, l.name, l.department, l.jobGroup, l.currency, ...SALARY_AMOUNTS.map((a) => l[a.key]), l.paymentMethod]);
  return { headers, rows };
}

// ---------------------------------------------------------------------------------------------
// Staff other deductions
// ---------------------------------------------------------------------------------------------

export const ADVANCE = 'Salary advance';
export const WELFARE = 'Welfare';

/**
 * The deductions on a payslip besides the statutory ones, by name: each deduction_items line (loan repayments under
 * their "Loan repayment: ..." name), the salary advance and welfare. loan_deduction and other_deductions are the totals
 * of those items, so they are only used for payslips saved before the lines were itemised.
 */
export function payslipDeductions(p: Row): { name: string; amount: number }[] {
  const items = Array.isArray(p.deduction_items) ? (p.deduction_items as Row[]) : [];
  const out: { name: string; amount: number }[] = items
    .map((i) => ({ name: String(i?.name ?? '').trim() || 'Other deductions', amount: num(i?.amount) }))
    .filter((i) => i.amount !== 0);
  if (items.length === 0) {
    if (num(p.loan_deduction) > 0) out.push({ name: 'Loan repayment', amount: num(p.loan_deduction) });
    if (num(p.other_deductions) > 0) out.push({ name: 'Other deductions', amount: num(p.other_deductions) });
  }
  if (num(p.advance_deduction) > 0) out.push({ name: ADVANCE, amount: num(p.advance_deduction) });
  if (num(p.welfare_deduction) > 0) out.push({ name: WELFARE, amount: num(p.welfare_deduction) });
  return out;
}

export interface DeductionEntry {
  employeeNumber: string;
  name: string;
  department: string;
  month: string;
  currency: string;
  kind: string;
  amount: number;
}

/** Every deduction line on these payslips, with who and when. */
export function deductionEntries(payslips: Row[], employees: Row[], departments: { id: string; name: string }[]): DeductionEntry[] {
  const people = byNumber(employees);
  const names = departmentNames(departments);
  return payslips.flatMap((p) => {
    const e = people.get(String(p.employee_id));
    const base = {
      employeeNumber: String(p.employee_id ?? ''),
      name: (e ? fullName(e) : '') || String(p.employee_name ?? p.employee_id ?? ''),
      department: names.get(e?.department_id) ?? '',
      month: String(p.pay_period ?? '').slice(0, 7),
      currency: currencyOfPayslip(p),
    };
    return payslipDeductions(p).map((d) => ({ ...base, kind: d.name, amount: d.amount }));
  });
}

export interface DeductionSummary {
  total: Record<string, number>;
  staff: number;
  kinds: number;
  advances: Record<string, number>;
}

export function deductionSummary(entries: DeductionEntry[]): DeductionSummary {
  const total: Record<string, number> = {};
  const advances: Record<string, number> = {};
  for (const e of entries) {
    addTo(total, e.currency, e.amount);
    if (e.kind === ADVANCE) addTo(advances, e.currency, e.amount);
  }
  return { total, staff: new Set(entries.map((e) => e.employeeNumber)).size, kinds: new Set(entries.map((e) => e.kind)).size, advances };
}

export interface DeductionKindRow {
  kind: string;
  staff: number;
  total: Record<string, number>;
  /** month -> per-currency total */
  byMonth: Record<string, Record<string, number>>;
}

/** One row per kind of deduction (largest first): people, total and each month's total, per currency. */
export function byDeduction(entries: DeductionEntry[], months: string[]): DeductionKindRow[] {
  const out = new Map<string, DeductionKindRow & { people: Set<string> }>();
  for (const e of entries) {
    let r = out.get(e.kind);
    if (!r) {
      r = { kind: e.kind, staff: 0, total: {}, byMonth: Object.fromEntries(months.map((m) => [m, {}])), people: new Set() };
      out.set(e.kind, r);
    }
    r.people.add(e.employeeNumber);
    addTo(r.total, e.currency, e.amount);
    r.byMonth[e.month] ??= {};
    addTo(r.byMonth[e.month], e.currency, e.amount);
  }
  const biggest = (r: DeductionKindRow) => Math.max(0, ...Object.values(r.total));
  return [...out.values()]
    .map(({ people, ...r }) => ({ ...r, staff: people.size }))
    .sort((a, b) => biggest(b) - biggest(a) || a.kind.localeCompare(b.kind));
}

export interface DeductionEmployeeRow {
  employeeNumber: string;
  name: string;
  department: string;
  currency: string;
  /** kind -> amount */
  amounts: Record<string, number>;
  total: number;
}

/** One row per person (and currency), with a column per kind of deduction; the kinds in the order of `byDeduction`. */
export function byEmployee(entries: DeductionEntry[]): { kinds: string[]; rows: DeductionEmployeeRow[] } {
  const kinds = byDeduction(entries, []).map((k) => k.kind);
  const out = new Map<string, DeductionEmployeeRow>();
  for (const e of entries) {
    const key = `${e.employeeNumber}\u0000${e.currency}`;
    let r = out.get(key);
    if (!r) {
      r = { employeeNumber: e.employeeNumber, name: e.name, department: e.department, currency: e.currency, amounts: {}, total: 0 };
      out.set(key, r);
    }
    r.amounts[e.kind] = round2((r.amounts[e.kind] ?? 0) + e.amount);
    r.total = round2(r.total + e.amount);
  }
  const rows = [...out.values()].sort(
    (a, b) => a.employeeNumber.localeCompare(b.employeeNumber, undefined, { numeric: true }) || currencyOrder(a.currency, b.currency)
  );
  return { kinds, rows };
}

/** The By employee table as a sheet. */
export function deductionSheet(table: { kinds: string[]; rows: DeductionEmployeeRow[] }) {
  const headers = ['Employee no.', 'Name', 'Department', 'Currency', ...table.kinds, 'Total'];
  const rows = table.rows.map((r) => [r.employeeNumber, r.name, r.department, r.currency, ...table.kinds.map((k) => r.amounts[k] ?? 0), r.total]);
  return { headers, rows };
}

export interface StandingDeduction {
  employeeNumber: string;
  name: string;
  department: string;
  kind: string;
  /** the type is paused: not taken until resumed */
  paused: boolean;
  amount: number;
  currency: string;
  from: string | null;
  to: string | null;
  notes: string;
}

/**
 * The deductions set up for staff that still run in or after `month` (no end, or ending then or later), for the people
 * matching the filters; by employee number, then kind. `currencyOfBranch` gives the currency of a branch id.
 */
export function standingDeductions(
  deductions: Row[],
  types: Row[],
  employees: Row[],
  departments: { id: string; name: string }[],
  filters: ReportFilters,
  month: string,
  currencyOfBranch: (branchId: string | undefined) => string = () => 'KES'
): StandingDeduction[] {
  const people = byNumber(employees);
  const names = departmentNames(departments);
  const typeById = new Map(types.map((t) => [String(t.id), t]));
  return deductions
    .filter((d) => !d.end_period || String(d.end_period) >= month)
    .map((d) => {
      const e = people.get(String(d.employee_number));
      return { d, e: e ?? { 'Employee Number': d.employee_number } };
    })
    .filter(({ e }) => matchesFilters(e, filters))
    .map(({ d, e }) => {
      const type = typeById.get(String(d.deduction_type_id));
      return {
        employeeNumber: String(d.employee_number ?? ''),
        name: fullName(e),
        department: names.get(e.department_id) ?? '',
        kind: String(type?.name ?? 'Unknown deduction'),
        paused: type ? type.active === false : false,
        amount: num(d.amount),
        currency: currencyOfBranch(e.branch_id ?? undefined) || 'KES',
        from: d.start_period ?? null,
        to: d.end_period ?? null,
        notes: String(d.notes ?? ''),
      };
    })
    .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber, undefined, { numeric: true }) || a.kind.localeCompare(b.kind));
}
