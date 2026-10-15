import { parseAmount } from './employeeTemplate';
import { appliesInPeriod, parsePeriod } from './voluntaryDeductions';

/**
 * Bonuses and incentives (tables earning_types, employee_earnings): the company's kinds of earnings on top of salary
 * (Bonus, Commission, Performance incentive...) and what each employee is paid for one month, or every month between
 * two pay periods. The earnings counterpart of lib/voluntaryDeductions. Pure: the database calls are in earningsDb.
 *
 * Every earning is cash pay, so it adds to gross pay and SHIF and the housing levy are worked out on it. A taxable
 * earning also counts towards PAYE taxable pay, a pensionable one towards the pay NSSF is worked out on.
 */
export interface EarningType {
  id: string;
  name: string;
  /** counts towards PAYE taxable pay */
  taxable: boolean;
  /** counts towards the pay NSSF is worked out on */
  pensionable: boolean;
  description: string | null;
  /** a paused type is not paid to anyone until it is resumed */
  active: boolean;
}

export interface EmployeeEarning {
  id: string;
  employee_number: string;
  earning_type_id: string;
  amount: number;
  /** 'YYYY-MM': the first month it is paid */
  start_period: string;
  /** 'YYYY-MM': the last month it is paid; the same as start_period for a one-off, null = every month until removed */
  end_period: string | null;
  notes: string | null;
}

export type NewEmployeeEarning = Omit<EmployeeEarning, 'id'>;

/** One line on a payslip (salary_history.earning_items) */
export interface EarningItem {
  name: string;
  amount: number;
  taxable: boolean;
  pensionable: boolean;
}

export const isOneOff = (e: Pick<EmployeeEarning, 'start_period' | 'end_period'>) => e.end_period === e.start_period;

/** Each employee's earnings for the pay period ('YYYY-MM'), by employee number, in the order of the type list. */
export const earningsForPeriod = (types: EarningType[], earnings: EmployeeEarning[], period: string) => {
  const order = new Map(types.map((t, i) => [t.id, i]));
  const byType = new Map(types.map((t) => [t.id, t]));
  const result = new Map<string, EarningItem[]>();
  for (const e of [...earnings].sort((a, b) => (order.get(a.earning_type_id) ?? 0) - (order.get(b.earning_type_id) ?? 0))) {
    const type = byType.get(e.earning_type_id);
    if (!type?.active || !appliesInPeriod(e, period)) continue;
    const items = result.get(e.employee_number) ?? [];
    items.push({ name: type.name, amount: Number(e.amount), taxable: type.taxable, pensionable: type.pensionable });
    result.set(e.employee_number, items);
  }
  return result;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (items: EarningItem[]) => round2(items.reduce((s, i) => s + (Number(i.amount) || 0), 0));

/** A commission earning (by its name) goes in the payslip's commission column; every other earning in bonus. */
export const isCommission = (name: string) => /commission/i.test(name);

/**
 * An employee's earnings for a month in total and split the ways payroll needs: taxable / not taxable, pensionable /
 * not, and the payslip's commission and bonus columns (commission + bonus = total).
 */
export const summariseEarnings = (items: EarningItem[]) => {
  const commission = sum(items.filter((i) => isCommission(i.name)));
  const total = sum(items);
  return {
    items,
    total,
    taxable: sum(items.filter((i) => i.taxable)),
    nonTaxable: sum(items.filter((i) => !i.taxable)),
    pensionable: sum(items.filter((i) => i.pensionable)),
    nonPensionable: sum(items.filter((i) => !i.pensionable)),
    commission,
    bonus: round2(total - commission),
  };
};

/** The earnings for one employee for one month (see earningsForPeriod and summariseEarnings). */
export const employeeEarnings = (types: EarningType[], earnings: EmployeeEarning[], employeeNumber: string, period: string) =>
  summariseEarnings(earningsForPeriod(types, earnings.filter((e) => e.employee_number === employeeNumber), period).get(employeeNumber) ?? []);

/**
 * The pay statutoryFor works on, given the employee's other cash pay (salary and allowances, less the per diem) and
 * the month's earnings: every earning is cash pay for SHIF and AHL, taxable ones for PAYE, pensionable ones for NSSF.
 */
export const statutoryPayWith = (salaryCashPay: number, items: EarningItem[]) => {
  const e = summariseEarnings(items);
  return {
    cashPay: round2(salaryCashPay + e.taxable),
    nonTaxableCashPay: e.nonTaxable,
    pensionablePay: round2(salaryCashPay + e.pensionable),
  };
};

const itemsOf = (payslip: { earning_items?: unknown }): EarningItem[] =>
  Array.isArray(payslip.earning_items)
    ? (payslip.earning_items as Partial<EarningItem>[]).map((i) => ({
        name: String(i.name ?? ''),
        amount: Number(i.amount) || 0,
        taxable: i.taxable !== false,
        pensionable: i.pensionable !== false,
      }))
    : [];

/**
 * The earning lines on a payslip: its itemised earnings, or, for payslips saved before they were itemised, its
 * commission and bonus amounts when set.
 */
export const payslipEarningLines = (payslip: {
  earning_items?: unknown;
  commission?: number | string | null;
  bonus?: number | string | null;
}): EarningItem[] => {
  const items = itemsOf(payslip);
  if (items.length) return items;
  return (
    [
      ['Commission', payslip.commission],
      ['Bonus', payslip.bonus],
    ] as const
  )
    .map(([name, amount]) => ({ name, amount: Number(amount) || 0, taxable: true, pensionable: true }))
    .filter((line) => line.amount > 0);
};

/** A saved payslip's earnings that are not taxed (not PAYE cash pay on the P10 and P9). */
export const nonTaxableEarningsOf = (payslip: { earning_items?: unknown }) => summariseEarnings(itemsOf(payslip)).nonTaxable;

/** How a saved payslip's NSSF pay differs from its taxable cash pay: + pensionable untaxed, − taxable non-pensionable. */
export const pensionableAdjustmentOf = (payslip: { earning_items?: unknown }) => {
  const items = itemsOf(payslip);
  return round2(sum(items.filter((i) => !i.taxable && i.pensionable)) - sum(items.filter((i) => i.taxable && !i.pensionable)));
};

// ---------------------------------------------------------------------------------------------
// spreadsheet upload
// ---------------------------------------------------------------------------------------------
export const EARNING_SHEET_COLUMNS = ['Employee Number', 'Earning', 'Amount', 'Period'] as const;

export interface ParsedEarningRow {
  employee_number: string;
  earning: string;
  amount: number;
  period: string;
}

const cell = (row: Record<string, unknown>, column: string) => {
  const key = Object.keys(row).find((k) => k.trim().toLowerCase() === column.toLowerCase());
  return key === undefined ? '' : row[key];
};

/**
 * Rows of an uploaded earnings sheet (columns as EARNING_SHEET_COLUMNS, any order or case), checked against the
 * company's employee numbers. Each row is a one-off earning for its period; an empty period means defaultPeriod (the
 * month on screen). Row numbers in errors count the header as row 1, as in Excel.
 */
export const parseEarningSheet = (rows: Record<string, unknown>[], employeeNumbers: Set<string>, defaultPeriod: string) => {
  const valid: ParsedEarningRow[] = [];
  const errors: string[] = [];
  rows.forEach((row, index) => {
    const line = `Row ${index + 2}`;
    const employee_number = String(cell(row, 'Employee Number') ?? '').trim();
    const earning = String(cell(row, 'Earning') ?? '').trim();
    const rawAmount = cell(row, 'Amount');
    if (!employee_number && !earning && String(rawAmount ?? '').trim() === '') return; // blank line
    const amount = parseAmount(rawAmount);
    const period = parsePeriod(cell(row, 'Period'));

    const problems: string[] = [];
    if (!employee_number) problems.push('no employee number');
    else if (!employeeNumbers.has(employee_number)) problems.push(`no employee with number ${employee_number}`);
    if (!earning) problems.push('no earning name');
    if (amount === null || amount <= 0) problems.push('amount should be a number above 0');
    if (period === undefined) problems.push('"Period" should be a month like 2026-10');

    if (problems.length) errors.push(`${line}: ${problems.join(', ')}`);
    else valid.push({ employee_number, earning, amount: amount as number, period: period ?? defaultPeriod });
  });
  return { valid, errors };
};
