import type { PayslipContext } from '../../payslipCalc';
import type { Rates } from '../../statutoryCalc';
import type { EmployeeRecord } from '../../profileCompleteness';
import type { ExportFile } from '../../payrollExports';
import type { TaxWorking } from '../taxDetails';

// The country engine interface (FIG-905 stage 2). One payroll run pays everyone, but each employee is worked out by
// their branch's country's engine, in that country's currency, and each country files its own returns. Kenya is the
// first engine (lib/payroll/countries/kenya.ts); Tanzania and Uganda plug in here in the next stages.

/* eslint-disable @typescript-eslint/no-explicit-any -- payslip records are the untyped rows the payroll page uses */
export type PayslipRecord = Record<string, any>;

/** What a country engine needs to work out one employee's month: the employee and the month's context. */
export interface PayrollInput {
  employee: Record<string, any>;
  /** the month's context (rates are the employee's country's rates for the period) */
  ctx: PayslipContext;
}

/** One line on a payslip, labelled for people. */
export interface PayslipLine {
  label: string;
  amount: number;
}

/** A payslip as a country engine works it out. */
export interface PayslipResult {
  country: string;
  currency: string;
  /** the record saved as the salary_history row (with country and currency) */
  record: PayslipRecord;
  earnings: PayslipLine[];
  /** statutory deductions taken from the employee (tax, social security, health...) */
  statutoryDeductions: PayslipLine[];
  /** costs the employer pays on top of pay (never taken from pay) */
  employerCosts: PayslipLine[];
  grossPay: number;
  taxablePay: number;
  tax: number;
  netPay: number;
  /** how taxable pay and tax were worked out: pay not taxed, benefits, deductions before tax, reliefs (FIG-814); null for a contractor */
  working: TaxWorking | null;
}

/** A statutory or payment file for one country's payslips (P10, NSSF, SHA...). */
export interface ReturnFile {
  key: string;
  label: string;
  /** the file's name before the month: kra-p10 -> kra-p10-2026-10.csv */
  name: string;
  /** one line on what it is for */
  what: string;
  /** who the file is filed with ("KRA", "NSSF") */
  authority: string;
  /** only shown when it has rows (e.g. the WHT return in a month with no contractors) */
  optional?: boolean;
  build: (payslips: PayslipRecord[], employees: EmployeeRecord[], ctx: { payPeriod: string; rates: Rates }) => ExportFile;
}

/** Something wrong with an employee for their country's payroll. Blocking problems hold the country back from approval. */
export interface EmployeeProblem {
  employeeNumber: string;
  name: string;
  problem: string;
  blocking: boolean;
}

export interface CountryPayrollEngine {
  country: string;
  currency: string;
  /** the statutory rate codes the engine can't work without; a missing one blocks the country */
  requiredRates: readonly string[];
  calculate(input: PayrollInput): PayslipResult;
  /** the country's statutory returns, filed with its own tax and social security bodies */
  returns(): ReturnFile[];
  /** what is missing on an employee for this country's payroll (tax number, social security number, where they are paid) */
  validate(employee: Record<string, any>): EmployeeProblem[];
}
/* eslint-enable @typescript-eslint/no-explicit-any */
