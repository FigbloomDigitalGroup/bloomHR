import { payslipDeductionLines } from '../voluntaryDeductions';
import { whtLabel } from '../workSettlement';
import type { PayslipLine, PayslipResult } from './countries/types';

// The payslip's deductions in three groups (FIG-814): allowed before tax (Kenya: NSSF, SHIF, the housing levy, pension
// and post-retirement medical fund; Tanzania: NSSF; Uganda: the local service tax), tax (PAYE, or a contractor's
// withholding tax) and after tax (everything else: Uganda's NSSF, Tanzania's HESLB repayment, advances, loans and
// voluntary deductions). The figures are the engine's (statutoryDeductions) and the payslip's own lines; which group a
// line is in follows the engine's working (TaxWorking.before_tax).

/* eslint-disable @typescript-eslint/no-explicit-any -- payslip rows are the untyped rows the payroll page uses */
type Payslip = Record<string, any>;

export interface GroupLine extends PayslipLine {
  key: string;
  testId?: string;
}

export interface DeductionGroups {
  beforeTax: GroupLine[];
  tax: GroupLine[];
  afterTax: GroupLine[];
}

/** A statutory line's key, from the engine's label. */
export function statutoryKey(label: string): string {
  const l = label.toLowerCase();
  if (l.startsWith('paye')) return 'paye';
  if (l.startsWith('withholding')) return 'wht';
  if (l.startsWith('nssf')) return 'nssf';
  if (l.startsWith('shif') || l.startsWith('nhif')) return 'shif';
  if (l.startsWith('housing levy')) return 'ahl';
  if (l.startsWith('local service')) return 'lst';
  if (l.startsWith('heslb')) return 'heslb';
  return l.replace(/\W+/g, '_');
}

const DEDUCTION_ITEM_KEYS: Record<string, string> = { 'Pension contribution': 'pension', 'Post-retirement medical fund': 'prmf' };

/** Before tax, tax and after tax, from the engine's result and the payslip. */
export function payslipDeductionGroups(record: Payslip, result: PayslipResult): DeductionGroups {
  const before = new Set((result.working?.before_tax ?? []).map((l) => l.key));
  // a Kenya payslip saved before the working was kept: Kenya's NSSF, SHIF, housing levy, pension and PRMF are all
  // allowed before tax under the rules payroll has run on (SHIF and AHL since December 2024)
  if (result.working && !result.working.recorded && result.country === 'Kenya') ['nssf', 'shif', 'ahl', 'pension', 'prmf'].forEach((k) => before.add(k));
  const groups: DeductionGroups = { beforeTax: [], tax: [], afterTax: [] };
  for (const l of result.statutoryDeductions) {
    const key = statutoryKey(l.label);
    if (key === 'paye') groups.tax.push({ key, label: l.label, amount: l.amount });
    else if (key === 'wht') {
      groups.tax.push({ key, label: result.country === 'Kenya' ? whtLabel(record) : l.label, amount: l.amount, testId: 'wht-line' });
    } else (before.has(key) ? groups.beforeTax : groups.afterTax).push({ key, label: l.label, amount: l.amount });
  }
  for (const item of payslipDeductionLines(record)) {
    const key = DEDUCTION_ITEM_KEYS[item.name] ?? 'item';
    const line = { key, label: item.name, amount: Number(item.amount) || 0 };
    (key !== 'item' && before.has(key) ? groups.beforeTax : groups.afterTax).push(line);
  }
  const advance = Number(record.advance_deduction) || 0;
  if (advance) groups.afterTax.push({ key: 'advance', label: 'Salary advance', amount: advance });
  return groups;
}

/** The employee's tax number's name: KRA PIN, TRA TIN, URA TIN. */
export const employeeTaxLabel = (country: string) => (country === 'Tanzania' ? 'TRA TIN' : country === 'Uganda' ? 'URA TIN' : 'KRA PIN');

/** The national ID's name: ID number (Kenya), NIDA number (Tanzania), NIN (Uganda). */
export const idNumberLabel = (country: string) => (country === 'Tanzania' ? 'NIDA number' : country === 'Uganda' ? 'NIN' : 'ID number');

/** Why a country has no reliefs: Tanzania and Uganda have no personal relief (their bands start at 0% instead). */
export const noReliefNote = (country: string) =>
  country === 'Tanzania' || country === 'Uganda' ? `None: ${country} has no personal relief (the first band is taxed at 0%)` : 'None';
/* eslint-enable @typescript-eslint/no-explicit-any */
