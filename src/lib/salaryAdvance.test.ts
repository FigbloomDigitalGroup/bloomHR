import { describe, expect, it } from 'vitest';
import {
  accountNameMatches,
  addMonths,
  advanceDeductionFor,
  advanceStage,
  checkPayee,
  maxAdvanceFor,
  queueTab,
  repaymentProgress,
  repaymentSchedule,
  validateAdvanceRequest,
  type AdvanceRow,
} from './salaryAdvance';

const paid = (over: Partial<AdvanceRow> = {}): AdvanceRow => ({
  'Employee Number': 'E1',
  'Amount Requested': 9000,
  status: 'paid',
  payment_processed: 'true',
  time_added: '2026-10-05T09:00:00Z',
  ...over,
});

describe('repayment schedule', () => {
  it('one month: the whole amount, exactly as asked, in the month it was asked for', () => {
    expect(repaymentSchedule(5000.555, 1, '2026-10')).toEqual([{ period: '2026-10', amount: 5000.555 }]);
  });

  it('N months: equal parts from that month, the last evening out the cents', () => {
    expect(repaymentSchedule(9000, 3, '2026-11')).toEqual([
      { period: '2026-11', amount: 3000 },
      { period: '2026-12', amount: 3000 },
      { period: '2027-01', amount: 3000 },
    ]);
    const parts = repaymentSchedule(10000, 3, '2026-10');
    expect(parts.map((p) => p.amount)).toEqual([3333.33, 3333.33, 3333.34]);
    expect(parts.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(10000, 2);
  });

  it('nothing without an amount or a month', () => {
    expect(repaymentSchedule(0, 2, '2026-10')).toEqual([]);
    expect(repaymentSchedule(1000, 2, '')).toEqual([]);
  });

  it('adds months across years', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', 23)).toBe('2027-12');
  });
});

describe('payroll deduction', () => {
  it('a one-month advance (old rows have no repayment_months) comes off in full in its month only, as before', () => {
    const rows = [paid({ repayment_months: null })];
    expect(advanceDeductionFor(rows, 'E1', '2026-10')).toBe(9000);
    expect(advanceDeductionFor(rows, 'E1', '2026-11')).toBe(0);
    expect(advanceDeductionFor(rows, 'E1', '2026-09')).toBe(0);
  });

  it('matches employee numbers loosely and sums several advances', () => {
    const rows = [paid({ 'Employee Number': 42, 'Amount Requested': '1500' }), paid({ 'Employee Number': '42', 'Amount Requested': 500 })];
    expect(advanceDeductionFor(rows, '42', '2026-10')).toBe(2000);
    expect(advanceDeductionFor(rows, '', '2026-10')).toBe(0);
    expect(advanceDeductionFor(rows, 'E9', '2026-10')).toBe(0);
  });

  it('without a period, every advance counts in full (as before)', () => {
    expect(advanceDeductionFor([paid(), paid({ repayment_months: 3 })], 'E1', '')).toBe(18000);
  });

  it('a spread advance takes amount / N a month until repaid', () => {
    const rows = [paid({ repayment_months: 3 })];
    expect(['2026-09', '2026-10', '2026-11', '2026-12', '2027-01'].map((p) => advanceDeductionFor(rows, 'E1', p))).toEqual([0, 3000, 3000, 3000, 0]);
  });

  it('skips advances with no usable date', () => {
    expect(advanceDeductionFor([paid({ time_added: null })], 'E1', '2026-10')).toBe(0);
  });
});

describe('catching up a part payroll missed', () => {
  const slip = (pay_period: string, amount: number, employee_number = 'E1') => ({ employee_number, pay_period, amount });

  it('an advance recorded paid after its month was approved comes off the next payroll', () => {
    // October's payslip was approved before the payment was recorded, so it took nothing
    const taken = [slip('2026-09', 0), slip('2026-10', 0)];
    expect(advanceDeductionFor([paid()], 'E1', '2026-11', taken)).toBe(9000);
    // once November took it, nothing more
    expect(advanceDeductionFor([paid()], 'E1', '2026-12', [...taken, slip('2026-11', 9000)])).toBe(0);
  });

  it('nothing extra when each month took its part', () => {
    const rows = [paid({ repayment_months: 3 })];
    const taken = [slip('2026-10', 3000), slip('2026-11', 3000)];
    expect(advanceDeductionFor(rows, 'E1', '2026-12', taken)).toBe(3000);
    expect(advanceDeductionFor(rows, 'E1', '2027-01', [...taken, slip('2026-12', 3000)])).toBe(0);
  });

  it('a missed part is added to the month’s own part', () => {
    const rows = [paid({ repayment_months: 3 })];
    expect(advanceDeductionFor(rows, 'E1', '2026-11', [slip('2026-10', 0)])).toBe(6000);
  });

  it('a month with no payslip counts as missed, once the person has an approved payslip', () => {
    const rows = [paid({ repayment_months: 3 })];
    expect(advanceDeductionFor(rows, 'E1', '2026-12', [slip('2026-10', 3000)])).toBe(6000);
  });

  it('months before the first approved payslip in the app are not charged again', () => {
    // paid outside the app before payroll moved in; payroll first ran in December
    expect(advanceDeductionFor([paid({ repayment_months: 3 })], 'E1', '2027-01', [slip('2026-12', 0)])).toBe(3000);
    expect(advanceDeductionFor([paid()], 'E1', '2027-01', [])).toBe(0);
  });

  it('only the person’s own payslips before this month count', () => {
    const taken = [slip('2026-10', 9000, 'E2'), slip('2026-11', 9000)];
    expect(advanceDeductionFor([paid()], 'E1', '2026-11', taken)).toBe(0);
  });
});

describe('progress and stages', () => {
  it('counts parts of past months as repaid', () => {
    const row = paid({ repayment_months: 3 });
    expect(repaymentProgress(row, '2026-10')).toMatchObject({ repaid: 0, remaining: 9000, next: { period: '2026-10', amount: 3000 } });
    expect(repaymentProgress(row, '2026-12')).toMatchObject({ repaid: 6000, remaining: 3000, next: { period: '2026-12' } });
    expect(repaymentProgress(row, '2027-01')).toMatchObject({ repaid: 9000, remaining: 0, next: undefined, lastPeriod: '2026-12' });
  });

  it('moves Requested -> Approved -> Paid -> Repaying -> Repaid, or Declined', () => {
    expect(advanceStage({ status: 'Pending' })).toBe('requested');
    expect(advanceStage({ status: 'approved' })).toBe('approved');
    expect(advanceStage({ status: 'rejected' })).toBe('declined');
    const row = paid({ repayment_months: 3 });
    expect(advanceStage(row, '2026-10')).toBe('paid');
    expect(advanceStage(row, '2026-11')).toBe('repaying');
    expect(advanceStage(row, '2027-01')).toBe('repaid');
  });

  it('puts each request in a queue tab', () => {
    expect(queueTab({ status: 'Pending' })).toBe('pending');
    expect(queueTab({ status: 'processing' })).toBe('approved');
    expect(queueTab(paid())).toBe('paid');
    expect(queueTab({ status: 'rejected' })).toBe('declined');
  });
});

describe('request validation', () => {
  it('limits the amount to 20% of basic salary', () => {
    expect(maxAdvanceFor('50000')).toBe(10000);
    expect(validateAdvanceRequest({ amount: '10001', reason: 'School fees for term', months: 1 }, 10000).amount).toMatch(/KSh 10,000/);
    expect(validateAdvanceRequest({ amount: '10000', reason: 'School fees for term', months: 2 }, 10000)).toEqual({});
  });

  it('needs an amount, a reason and 1-6 months', () => {
    const e = validateAdvanceRequest({ amount: '', reason: 'short', months: 7 }, 10000);
    expect(Object.keys(e).sort()).toEqual(['amount', 'months', 'reason']);
  });
});

describe('payee check', () => {
  const base = { 'First Name': 'Jane', 'Last Name': 'Wanjiru' };
  it('M-Pesa needs a valid Kenyan number, shown masked', () => {
    expect(checkPayee({ ...base, payment_method: 'M-Pesa', 'Mobile Number': '+254712345678' })).toEqual({ method: 'M-Pesa', destination: 'M-Pesa 0712 *** 678' });
    expect(checkPayee({ ...base, payment_method: 'M-Pesa', 'Mobile Number': '' }).error).toMatch(/No M-Pesa number/);
    expect(checkPayee({ ...base, payment_method: 'M-Pesa', 'Mobile Number': '12345' }).error).toMatch(/not a valid/);
  });

  it('bank needs an account in the employee name', () => {
    const bank = { ...base, payment_method: 'Bank Transfer', Bank: 'KCB', 'Account Number': '1234567890' };
    expect(checkPayee({ ...bank, account_number_name: 'JANE WANJIRU' })).toEqual({ method: 'Bank Transfer', destination: 'KCB ****7890' });
    expect(checkPayee({ ...bank, account_number_name: 'John Otieno' }).error).toMatch(/does not match/);
    expect(checkPayee({ ...bank, 'Account Number': '' }).error).toMatch(/No bank account/);
  });

  it('cash and missing records cannot be paid', () => {
    expect(checkPayee({ ...base, payment_method: 'Cash' }).error).toMatch(/cash/);
    expect(checkPayee(undefined).error).toBeTruthy();
  });

  it('account names match on all their words or two of them', () => {
    expect(accountNameMatches('Jane W. Wanjiru', { 'First Name': 'Jane', 'Middle Name': 'W', 'Last Name': 'Wanjiru' })).toBe(true);
    expect(accountNameMatches('Jane Wanjiru Kamau', base)).toBe(true);
    expect(accountNameMatches('Jane Otieno', base)).toBe(false);
  });
});
