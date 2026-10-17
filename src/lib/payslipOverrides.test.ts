import { describe, expect, it } from 'vitest';
import {
  applyPayslipOverride,
  editedColumnsOf,
  isEmptyOverride,
  markEditedPayslips,
  normaliseOverride,
  payslipChanges,
  statutoryContextFor,
  withPayslipEdits,
  type StatutoryContext,
} from './payslipOverrides';
import { statutoryFor } from './statutoryCalc';
import { statutoryPayWith, summariseEarnings, type EarningItem } from './earnings';
import { basicAfterLeave } from './leavePay';

// the rates seeded in statutory_rates for October 2026 (as statutoryCalc.test.ts)
const rates = {
  paye_bands: [{ upto: 24000, rate: 0.1 }, { upto: 32333, rate: 0.25 }, { upto: 500000, rate: 0.3 }, { upto: 800000, rate: 0.325 }, { upto: null, rate: 0.35 }],
  personal_relief: 2400, insurance_relief_rate: 0.15, insurance_relief_cap: 5000, pension_deduction_cap: 30000,
  prmf_deduction_cap: 15000, mortgage_interest_cap: 30000, non_cash_benefit_exempt_limit: 5000, meals_exempt_limit: 5000,
  pwd_exempt_income: 150000, shif_deductible: 1, ahl_deductible: 1, shif_rate: 0.0275, shif_minimum: 300, ahl_rate: 0.015,
  nssf_rate: 0.06, nssf_lower_limit: 9000, nssf_upper_limit: 108000,
};
const employee = { 'Employee Number': 'E1', 'Tax PIN': 'A123', 'NSSF Number': '1', 'SHIF Number': '2' };
const ctx: StatutoryContext = statutoryContextFor(employee, rates, false);

/** A payslip worked out the way PayrollDashboard does, for comparison. */
const calculate = (pay: { basic: number; house?: number; transport?: number; hours?: number; rate?: number; items?: EarningItem[]; leave?: number; voluntary?: number; loan?: number }) => {
  const earnings = summariseEarnings(pay.items ?? []);
  const leave = pay.leave ?? 0;
  const { perDiem } = basicAfterLeave(pay.basic, leave);
  const overtime = (pay.hours ?? 0) * (pay.rate ?? 0);
  const gross = pay.basic + (pay.house ?? 0) + (pay.transport ?? 0) + overtime + earnings.commission + earnings.bonus - leave;
  const taxableGross = gross - perDiem - earnings.nonTaxable;
  const s = statutoryFor({ ...statutoryPayWith(taxableGross - earnings.taxable, earnings.items), ...ctx.inputs, apply: ctx.apply }, rates);
  const other = pay.voluntary ?? 0;
  const loan = pay.loan ?? 0;
  const total = s.paye + s.shif + s.nssf + s.ahl + loan + other;
  return {
    employee_id: 'E1',
    employee_name: 'Ann',
    basic_salary: pay.basic,
    house_allowance: pay.house ?? 0,
    transport_allowance: pay.transport ?? 0,
    medical_allowance: 0,
    other_allowances: 0,
    overtime_hours: pay.hours ?? 0,
    overtime_rate: pay.rate ?? 0,
    commission: earnings.commission,
    bonus: earnings.bonus,
    per_diem: perDiem,
    gross_pay: gross,
    paye_tax: s.paye,
    nhif_deduction: s.shif,
    nssf_deduction: s.nssf,
    housing_levy: s.ahl,
    tax_relief: s.personalRelief,
    loan_deduction: loan,
    advance_deduction: 0,
    welfare_deduction: 0,
    other_deductions: other,
    deduction_items: other ? [{ name: 'SACCO', amount: other }] : [],
    earning_items: earnings.items,
    leave_deduction: leave,
    leave_items: [],
    total_deductions: total,
    net_pay: gross - total,
  };
};

const base = calculate({ basic: 60000, house: 10000, items: [{ name: 'Commission', amount: 4000, taxable: true, pensionable: true }], voluntary: 1500, loan: 2000 });

describe('applying a payslip’s edits', () => {
  it('no edits: the payslip comes back as it is', () => {
    expect(applyPayslipOverride(base, null, ctx)).toBe(base);
    expect(applyPayslipOverride(base, { fields: {}, one_off_earnings: [{ label: ' ', amount: 100, taxable: true }] }, ctx)).toBe(base);
  });

  it('a taxable one-off earning raises gross, PAYE, NSSF, SHIF and the housing levy', () => {
    const after = applyPayslipOverride(base, { one_off_earnings: [{ label: 'Bonus', amount: 10000, taxable: true }] }, ctx);
    expect(after.gross_pay).toBe(base.gross_pay + 10000);
    expect(after.paye_tax).toBeGreaterThan(base.paye_tax);
    expect(after.nhif_deduction).toBeGreaterThan(base.nhif_deduction);
    expect(after.housing_levy).toBeGreaterThan(base.housing_levy);
    expect(after.nssf_deduction).toBeGreaterThanOrEqual(base.nssf_deduction);
    expect(after.net_pay).toBeLessThan(base.net_pay + 10000);
    expect(after.earning_items).toContainEqual({ name: 'Bonus', amount: 10000, taxable: true, pensionable: true });
    expect(after.bonus).toBe(10000);
    expect(after.commission).toBe(4000);
    // the same as if the bonus had been an earning when payroll worked it out
    const expected = calculate({ basic: 60000, house: 10000, items: [...base.earning_items, { name: 'Bonus', amount: 10000, taxable: true, pensionable: true }], voluntary: 1500, loan: 2000 });
    for (const k of ['gross_pay', 'paye_tax', 'nhif_deduction', 'nssf_deduction', 'housing_levy', 'total_deductions', 'net_pay'] as const) {
      expect(after[k]).toBeCloseTo(expected[k], 2);
    }
  });

  it('a one-off earning that is not taxed doesn’t raise PAYE', () => {
    const after = applyPayslipOverride(base, { one_off_earnings: [{ label: 'Reimbursement', amount: 10000, taxable: false }] }, ctx);
    expect(after.gross_pay).toBe(base.gross_pay + 10000);
    expect(after.paye_tax).toBeLessThanOrEqual(base.paye_tax);
    expect(after.nssf_deduction).toBe(base.nssf_deduction);
    expect(after.net_pay).toBeGreaterThan(base.net_pay);
  });

  it('a one-off deduction lowers net pay only', () => {
    const after = applyPayslipOverride(base, { one_off_deductions: [{ label: 'Damaged equipment', amount: 2500 }] }, ctx);
    expect(after.gross_pay).toBe(base.gross_pay);
    for (const k of ['paye_tax', 'nhif_deduction', 'nssf_deduction', 'housing_levy'] as const) expect(after[k]).toBe(base[k]);
    expect(after.other_deductions).toBe(base.other_deductions + 2500);
    expect(after.total_deductions).toBeCloseTo(base.total_deductions + 2500, 2);
    expect(after.net_pay).toBeCloseTo(base.net_pay - 2500, 2);
    expect(after.deduction_items).toEqual([{ name: 'SACCO', amount: 1500 }, { name: 'Damaged equipment', amount: 2500 }]);
    // loans and other deductions stay as calculated
    expect(after.loan_deduction).toBe(base.loan_deduction);
  });

  it('a changed basic works the per diem and every statutory deduction out again, as payroll would', () => {
    const after = applyPayslipOverride(base, { fields: { basic_salary: 80000 } }, ctx);
    const expected = calculate({ basic: 80000, house: 10000, items: base.earning_items, voluntary: 1500, loan: 2000 });
    for (const k of ['basic_salary', 'per_diem', 'gross_pay', 'paye_tax', 'nhif_deduction', 'nssf_deduction', 'housing_levy', 'total_deductions', 'net_pay'] as const) {
      expect(after[k]).toBeCloseTo(expected[k], 2);
    }
  });

  it('a changed allowance, earning line or overtime amount is recalculated too', () => {
    const after = applyPayslipOverride(base, { fields: { house_allowance: 0, overtime_amount: 3000 }, earning_amounts: { Commission: 1000 } }, ctx);
    const expected = calculate({ basic: 60000, hours: 1, rate: 3000, items: [{ name: 'Commission', amount: 1000, taxable: true, pensionable: true }], voluntary: 1500, loan: 2000 });
    for (const k of ['gross_pay', 'paye_tax', 'nhif_deduction', 'nssf_deduction', 'housing_levy', 'net_pay'] as const) {
      expect(after[k]).toBeCloseTo(expected[k], 2);
    }
    expect(after.commission).toBe(1000);
    expect(after.overtime_hours * after.overtime_rate).toBe(3000);
  });

  it('overtime keeps its hours and changes the rate', () => {
    const withOvertime = calculate({ basic: 60000, hours: 10, rate: 500 });
    const after = applyPayslipOverride(withOvertime, { fields: { overtime_amount: 8000 } }, ctx);
    expect(after.overtime_hours).toBe(10);
    expect(after.overtime_rate).toBe(800);
    expect(after.gross_pay).toBe(withOvertime.gross_pay + 3000);
  });

  it('leaves out a deduction the employee is not registered for, as payroll does', () => {
    const noPin = statutoryContextFor({ 'Employee Number': 'E1' }, rates, false);
    const after = applyPayslipOverride(base, { one_off_earnings: [{ label: 'Bonus', amount: 1000, taxable: true }] }, noPin);
    expect(after.paye_tax).toBe(0);
    expect(after.nssf_deduction).toBe(0);
    expect(statutoryContextFor({}, rates, true).apply).toEqual({ shif: true, nssf: true, ahl: true, paye: true });
  });

  it('carries the note', () => {
    expect(applyPayslipOverride(base, { note: '  Includes September arrears ' }, ctx).payslip_note).toBe('Includes September arrears');
  });
});

describe('recalculating a run keeps the edits', () => {
  const other = { ...calculate({ basic: 30000 }), employee_id: 'E2' };
  const edits = new Map([['E1', { one_off_earnings: [{ label: 'Bonus', amount: 5000, taxable: true }] }]]);

  it('applies each payslip’s edits on top of the new calculation and marks it edited', () => {
    const raised = calculate({ basic: 70000, house: 10000, items: base.earning_items, voluntary: 1500, loan: 2000 });
    const [e1, e2] = withPayslipEdits([raised, other], edits, () => ctx);
    expect(e1.payslip_edited).toBe(true);
    expect(e1.gross_pay).toBe(raised.gross_pay + 5000);
    expect(e1.basic_salary).toBe(70000);
    expect(e2).toBe(other);
    expect((e2 as { payslip_edited?: boolean }).payslip_edited).toBeUndefined();
  });

  it('removing the edits gives back the calculated payslip', () => {
    const edited = withPayslipEdits([base], edits, () => ctx)[0];
    expect(edited.net_pay).not.toBe(base.net_pay);
    const removed = withPayslipEdits([base], new Map(), () => ctx)[0];
    expect(removed).toBe(base);
    expect(payslipChanges(edited, removed)).toContainEqual({ field: 'Earning: Bonus', before: 5000, after: 0 });
  });

  it('marks saved payslips that have edits', () => {
    expect(markEditedPayslips([base, other], edits).map((r) => (r as { payslip_edited?: boolean }).payslip_edited)).toEqual([true, undefined]);
  });
});

describe('before -> after', () => {
  it('lists every line that changes', () => {
    const after = applyPayslipOverride(base, { fields: { basic_salary: 65000 }, one_off_deductions: [{ label: 'Damaged equipment', amount: 500 }], note: 'x' }, ctx);
    const fields = payslipChanges(base, after).map((c) => c.field);
    expect(fields).toEqual(expect.arrayContaining(['Basic salary', 'Deduction: Damaged equipment', 'Gross pay', 'PAYE', 'NSSF', 'SHIF', 'Housing levy', 'Net pay', 'Note']));
    expect(fields).not.toContain('House allowance');
    expect(payslipChanges(base, base)).toEqual([]);
  });

  it('cleans up an override and writes only the columns an edit changes', () => {
    expect(normaliseOverride({ fields: { basic_salary: -5 }, one_off_deductions: [{ label: 'X', amount: 0 }], note: ' ' })).toBeNull();
    expect(isEmptyOverride({})).toBe(true);
    const cols = editedColumnsOf(applyPayslipOverride(base, { note: 'Hi' }, ctx));
    expect(cols.payslip_note).toBe('Hi');
    expect(Object.keys(cols)).not.toContain('employee_id');
    expect(Object.keys(cols)).not.toContain('loan_deduction');
  });
});
