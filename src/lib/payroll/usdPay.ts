import type { PayslipContext } from '../payslipCalc';
import type { EmployeeRecord } from '../profileCompleteness';
import type { PayrollLoan } from '../loans';
import { type ExportFile, bankFile } from '../payrollExports';
import { paymentKind } from '../paymentMethods';
import { currencyFor } from '../branches';
import type { CountryPayrollEngine, PayslipRecord } from './countries/types';
import { currencyOf } from './currency';

// Paying a country in US dollars at the rate the company enters each month (FIG-906). "Don't complicate it with FX":
// nothing is fetched. Each company picks a pay currency per country, the local one (the default) or USD
// (company_pay_currencies). For a USD country the company types the month's rate ("1 USD = 129 KES",
// payroll_fx_rates) and payroll is worked out like this for each employee:
//
//   1. their salary, allowances, earnings, deductions, loans and advances are entered and held in USD;
//   2. each is converted to the local currency at the month's rate;
//   3. the country's engine runs unchanged in the local currency (PAYE, NSSF, SHIF, AHL, Tanzania's and Uganda's
//      rules, minimum wage...);
//   4. every amount is converted back to USD, rounded to cents, and net pay is gross less the deductions, in USD.
//
// The payslip is saved in USD (currency 'USD') with the rate (fx_rate), the local currency (local_currency) and the
// local figures the engine worked out (local_amounts: the same keys as the payslip's own amounts). Returns to KRA,
// TRA, URA, NSSF and SHA always use the local figures (localPayslip); the bank file pays the USD net.
//
// Scope: salaried monthly payroll. Piece rate work, contract jobs and casual pay stay in the local currency (their
// rates, payouts, holdbacks and arrears never change currency); someone with piece rate work or contract jobs in a
// USD-paid country is held back from the USD run (heldBackReason) rather than mixing currencies on one payslip.

/* eslint-disable @typescript-eslint/no-explicit-any -- employee rows and payslips are the untyped rows the payroll page uses */
type Employee = Record<string, any>;

export const USD = 'USD';

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
/** Rounded to cents. */
export const cents = (n: number) => Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------------------------
// the pay currency per country
// ---------------------------------------------------------------------------------------------
/** company_pay_currencies: the currency each country is paid in, by country ("Kenya" -> "USD"). Missing: local. */
export type PayCurrencies = Map<string, string>;

/** The currencies a country can be paid in: its own, or USD. */
export const payCurrencyChoices = (country: string): string[] => [currencyFor(country), USD];

/** The currency a country is paid in: the company's choice, else the country's own. */
export function payCurrencyOf(country: string, choices?: PayCurrencies | null, localCurrency?: string): string {
  const local = localCurrency || currencyFor(country);
  const chosen = text(choices?.get(country)).toUpperCase();
  return chosen === USD ? USD : local;
}

export const paidInUsd = (country: string, choices?: PayCurrencies | null) => payCurrencyOf(country, choices) === USD;

/** "1 USD = 129 KES" */
export const rateText = (rate: number, localCurrency: string) => `1 USD = ${num(rate).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${localCurrency}`;

/** A rate as typed: a positive number, at most 4 decimals ("129", "129.5"). null when it isn't one. */
export function parseRate(value: string | number | null | undefined): number | null {
  const t = String(value ?? '').replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,4})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n < 1_000_000 ? n : null;
}

// ---------------------------------------------------------------------------------------------
// from USD to local: the employee and the month's context
// ---------------------------------------------------------------------------------------------
/** The money fields on an employee record (all in the pay currency). */
export const EMPLOYEE_MONEY_FIELDS = [
  'Basic Salary', 'house_allowance', 'travel_allowance', 'medical_allowance', 'Overtime Rate', 'other_pension_contribution',
  'post_retirement_medical_fund', 'car_benefit', 'meals_benefit', 'non_cash_benefit', 'housing_benefit', 'other_benefits',
  'mortgage_interest', 'insurance_premium',
] as const;

const times = (v: unknown, rate: number) => (v === null || v === undefined || v === '' ? v : num(v) * rate);

/** A USD-paid employee's record with every amount in the local currency at the month's rate. */
export function employeeInLocal(employee: Employee, rate: number): Employee {
  const out: Employee = { ...employee };
  for (const f of EMPLOYEE_MONEY_FIELDS) out[f] = times(employee[f], rate);
  return out;
}

const itemsTimes = <T extends { amount: number }>(items: T[] | undefined, rate: number): T[] | undefined =>
  items?.map((i) => ({ ...i, amount: num(i.amount) * rate }));

const loanInLocal = (loan: PayrollLoan, rate: number): PayrollLoan => ({
  ...loan,
  schedule: loan.schedule.map((s) => ({ ...s, payment: s.payment * rate, principal: s.principal * rate, interest: s.interest * rate, balance: s.balance * rate })),
  repayments: loan.repayments.map((r) => ({ ...r, amount: num(r.amount) * rate })),
});

/**
 * The month's context for one USD-paid employee in the local currency: their earnings, voluntary deductions, loans and
 * advances (entered in USD) at the month's rate. Piece rate work, LST already paid and other local figures stay as
 * they are. Only this employee's entries are kept (the engine reads no one else's).
 */
export function contextInLocal(ctx: PayslipContext, employeeNumber: string, rate: number): PayslipContext {
  const one = <T extends { amount: number }>(m: Map<string, T[]>) => {
    const items = itemsTimes(m.get(employeeNumber), rate);
    return new Map<string, T[]>(items ? [[employeeNumber, items]] : []);
  };
  return {
    ...ctx,
    earningsByEmployee: one(ctx.earningsByEmployee),
    voluntaryByEmployee: one(ctx.voluntaryByEmployee),
    payrollLoans: ctx.payrollLoans.filter((l) => l.employee_number === employeeNumber).map((l) => loanInLocal(l, rate)),
    advanceFor: (n, p) => ctx.advanceFor(n, p) * rate,
  };
}

// ---------------------------------------------------------------------------------------------
// from local back to USD: the payslip
// ---------------------------------------------------------------------------------------------
/** The payslip's amounts (every country's), as saved on salary_history. */
export const PAYSLIP_MONEY_FIELDS = [
  'basic_salary', 'house_allowance', 'transport_allowance', 'medical_allowance', 'other_allowances', 'overtime_rate', 'overtime_pay',
  'commission', 'bonus', 'per_diem', 'gross_pay', 'paye_tax', 'nhif_deduction', 'nssf_deduction', 'housing_levy', 'tax_relief',
  'loan_deduction', 'advance_deduction', 'welfare_deduction', 'other_deductions', 'leave_deduction', 'total_deductions', 'net_pay',
  'nita_levy', 'taxable_pay', 'wht_tax', 'employer_nssf', 'heslb_deduction', 'sdl_levy', 'wcf_levy', 'lst_deduction',
  'work_pay', 'jobs_pay', 'paid_out', 'ahl_withheld', 'reserve_released', 'wht_withheld', 'arrears_brought_forward', 'arrears_carried_forward',
] as const;

/** What comes off pay, each converted on its own (their USD total is the payslip's total deductions). */
export const DEDUCTION_FIELDS = [
  'paye_tax', 'nhif_deduction', 'nssf_deduction', 'housing_levy', 'wht_tax', 'heslb_deduction', 'lst_deduction',
  'loan_deduction', 'advance_deduction', 'welfare_deduction', 'other_deductions',
] as const;

/** Piece rate and contract job amounts: they stay in the local currency, so they never go on a USD payslip. */
const WORK_FIELDS = ['work_pay', 'jobs_pay', 'paid_out', 'ahl_withheld', 'reserve_released', 'wht_withheld', 'arrears_brought_forward', 'arrears_carried_forward'] as const;

/** Why a payslip worked out in local currency can't be paid in USD, or null. */
export function heldBackReason(local: PayslipRecord, localCurrency: string): string | null {
  const work = WORK_FIELDS.some((f) => num(local[f]) !== 0) || local.work_settlement === true;
  return work
    ? `has piece rate work, contract jobs or arrears this month, which stay in ${localCurrency} and can't go on a USD payslip`
    : null;
}

const itemsDiv = (items: unknown, rate: number, fields: string[]) =>
  Array.isArray(items)
    ? items.map((i: any) => ({ ...i, ...Object.fromEntries(fields.filter((f) => i?.[f] !== undefined).map((f) => [f, cents(num(i[f]) / rate)])) }))
    : items;

/** The local figures saved with a USD payslip (local_amounts): every amount, and the lines the returns read. */
export function localAmountsOf(local: PayslipRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of PAYSLIP_MONEY_FIELDS) if (local[f] !== undefined && local[f] !== null) out[f] = num(local[f]);
  for (const f of ['earning_items', 'deduction_items', 'leave_items', 'overtime_items'] as const) if (Array.isArray(local[f])) out[f] = local[f];
  return out;
}

/**
 * A payslip worked out in the local currency, in USD at the month's rate: each amount converted and rounded to cents,
 * total deductions the sum of the converted deductions, and net pay gross less those deductions. The local figures and
 * the rate are kept with it.
 */
export function recordInUsd(local: PayslipRecord, rate: number, localCurrency: string): PayslipRecord {
  const out: PayslipRecord = { ...local };
  for (const f of PAYSLIP_MONEY_FIELDS) {
    if (local[f] !== undefined && local[f] !== null) out[f] = cents(num(local[f]) / rate);
  }
  out.earning_items = itemsDiv(local.earning_items, rate, ['amount']);
  out.deduction_items = itemsDiv(local.deduction_items, rate, ['amount']);
  out.leave_items = itemsDiv(local.leave_items, rate, ['amount', 'daily_rate']);
  out.overtime_items = itemsDiv(local.overtime_items, rate, ['amount', 'hourly_rate']);
  out.total_deductions = cents(DEDUCTION_FIELDS.reduce((s, f) => s + num(out[f]), 0));
  out.net_pay = cents(num(out.gross_pay) - num(out.total_deductions));
  out.currency = USD;
  out.fx_rate = rate;
  out.local_currency = localCurrency;
  out.local_amounts = localAmountsOf(local);
  return out;
}

export type UsdOutcome = { record: PayslipRecord; heldBack?: undefined } | { record?: undefined; heldBack: string };

/** One USD-paid employee's payslip: converted to local, worked out by the country's engine unchanged, back to USD. */
export function calculateInUsd(engine: CountryPayrollEngine, employee: Employee, ctx: PayslipContext, rate: number): UsdOutcome {
  const number = text(employee['Employee Number']);
  const local = engine.calculate({ employee: employeeInLocal(employee, rate), ctx: contextInLocal(ctx, number, rate) });
  const record = { ...local.record, country: engine.country, currency: engine.currency };
  const reason = heldBackReason(record, engine.currency);
  if (reason) return { heldBack: reason };
  return { record: recordInUsd(record, rate, engine.currency) };
}

// ---------------------------------------------------------------------------------------------
// reading a saved payslip
// ---------------------------------------------------------------------------------------------
export const isUsdPayslip = (p: { currency?: unknown } | null | undefined) => currencyOf(p) === USD;

/** A USD payslip's local figures (local_amounts), parsed; null for a payslip in local currency. */
export function localAmounts(p: PayslipRecord | null | undefined): Record<string, any> | null {
  if (!p || !isUsdPayslip(p)) return null;
  let v = p.local_amounts;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  return v && typeof v === 'object' ? (v as Record<string, any>) : null;
}

/**
 * A payslip as the tax and social security bodies see it: in local currency. A USD payslip's local figures replace
 * its USD ones; a payslip in local currency is returned as it is. Every return (P10, NSSF, SHA, TRA, URA, the P9) is
 * built from this.
 */
export function localPayslip<T extends PayslipRecord>(p: T): T {
  const local = localAmounts(p);
  if (!local) return p;
  return { ...p, ...local, currency: text(p.local_currency).toUpperCase() || currencyFor(text(p.country)), paid_currency: USD };
}

/** The local statutory section on a USD payslip: "Statutory deductions in KES at 1 USD = 129 KES" and its lines. */
export function localStatutorySection(p: PayslipRecord | null | undefined): { title: string; currency: string; rate: number; lines: { label: string; amount: number }[] } | null {
  const local = localAmounts(p);
  if (!p || !local) return null;
  const currency = text(p.local_currency).toUpperCase() || currencyFor(text(p.country));
  const rate = num(p.fx_rate);
  const country = text(p.country) || 'Kenya';
  const contractor = text(p.worker_kind) === 'contractor';
  const pick = (label: string, key: string) => ({ label, amount: num(local[key]) });
  const lines = [
    pick('Gross pay', 'gross_pay'),
    ...(local.taxable_pay !== undefined ? [pick('Taxable pay', 'taxable_pay')] : []),
    ...(contractor
      ? [pick('Withholding tax', 'wht_tax')]
      : country === 'Tanzania'
        ? [pick('PAYE', 'paye_tax'), pick('NSSF', 'nssf_deduction'), pick('HESLB loan repayment', 'heslb_deduction'), pick('NSSF (employer)', 'employer_nssf'), pick('SDL', 'sdl_levy'), pick('WCF', 'wcf_levy')]
        : country === 'Uganda'
          ? [pick('PAYE', 'paye_tax'), pick('NSSF', 'nssf_deduction'), pick('Local service tax', 'lst_deduction'), pick('NSSF (employer)', 'employer_nssf')]
          : [pick('PAYE', 'paye_tax'), pick('NSSF', 'nssf_deduction'), pick('SHIF', 'nhif_deduction'), pick('Housing levy', 'housing_levy'), pick('NITA levy (employer)', 'nita_levy')]),
  ].filter((l, i) => i === 0 || l.amount !== 0);
  return { title: `Statutory deductions in ${currency} at ${rateText(rate, currency)}`, currency, rate, lines };
}

/** Columns for the register and Excel: the rate and the local statutory figures (blank for local-currency payslips). */
export function fxExportColumns(p: PayslipRecord): Record<string, string | number> {
  const local = localAmounts(p);
  if (!local) return { 'USD Rate': '', 'Local Currency': '', 'Local Gross Pay': '', 'Local PAYE': '', 'Local NSSF': '', 'Local SHIF': '', 'Local Housing Levy': '' };
  return {
    'USD Rate': num(p.fx_rate),
    'Local Currency': text(p.local_currency),
    'Local Gross Pay': num(local.gross_pay),
    'Local PAYE': num(local.paye_tax),
    'Local NSSF': num(local.nssf_deduction),
    'Local SHIF': num(local.nhif_deduction),
    'Local Housing Levy': num(local.housing_levy),
  };
}

// ---------------------------------------------------------------------------------------------
// the USD bank file
// ---------------------------------------------------------------------------------------------
/**
 * The bulk bank payment of USD payslips: everyone paid in USD goes by bank (a USD account). Anyone set up for mobile
 * money or cash is listed as a problem so they aren't missed.
 */
export function usdBankFile(payslips: PayslipRecord[], employees: EmployeeRecord[], payPeriod: string): ExportFile {
  const own = payslips.filter(isUsdPayslip);
  const file = bankFile(own, employees, payPeriod);
  const byNumber = new Map(employees.map((e) => [text(e['Employee Number']), e]));
  const notBank = own
    .filter((p) => num(p.net_pay) > 0)
    .filter((p) => paymentKind(text(p.payment_method) || byNumber.get(text(p.employee_id))?.['payment_method']) !== 'bank')
    .map((p) => ({ name: text(p.employee_name) || text(p.employee_id), employeeNumber: text(p.employee_id), missing: ['A bank account (USD is paid by bank)'] }));
  return { ...file, problems: [...file.problems, ...notBank] };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
