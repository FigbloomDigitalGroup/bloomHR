import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOAN_SETTINGS,
  addMonths,
  loanDeductionsFor,
  loanDueFor,
  loanLineName,
  loanSchedule,
  maxLoanFor,
  maxMonthsFor,
  monthlyInstalment,
  outstandingBalance,
  scheduleTotals,
  settingsError,
  totalInterest,
  validateLoanRequest,
  type PayrollLoan,
} from './loans';

const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

describe('monthlyInstalment', () => {
  it('reducing balance: 100,000 at 12% over 12 months is about 8,885', () => {
    expect(monthlyInstalment(100000, 12, 12, 'reducing_balance')).toBe(8884.88);
  });

  it('flat: 100,000 at 12% over 12 months is 9,333.33', () => {
    expect(monthlyInstalment(100000, 12, 12, 'flat')).toBe(9333.33);
  });

  it('0% is the amount in equal parts, either way', () => {
    expect(monthlyInstalment(12000, 0, 12, 'reducing_balance')).toBe(1000);
    expect(monthlyInstalment(12000, 0, 12, 'flat')).toBe(1000);
  });

  it('more known values: 50,000 at 14% over 6 months; 200,000 at 10% over 24', () => {
    expect(monthlyInstalment(50000, 14, 6, 'reducing_balance')).toBe(8676.9);
    expect(monthlyInstalment(200000, 10, 24, 'reducing_balance')).toBe(9228.99);
    expect(monthlyInstalment(50000, 14, 6, 'flat')).toBe(8916.67);
  });

  it('nothing for no amount; at least one month', () => {
    expect(monthlyInstalment(0, 12, 12, 'reducing_balance')).toBe(0);
    expect(monthlyInstalment(1200, 0, 0, 'reducing_balance')).toBe(1200);
  });
});

describe('loanSchedule', () => {
  it('reducing balance: whole shillings, interest on what is owed, the last instalment evens out', () => {
    const s = loanSchedule(100000, 12, 12, 'reducing_balance', '2026-11');
    expect(s).toHaveLength(12);
    expect(s[0]).toEqual({ instalment_no: 1, period: '2026-11', payment: 8885, principal: 7885, interest: 1000, balance: 92115 });
    expect(s[1]).toMatchObject({ period: '2026-12', interest: 921, principal: 7964, balance: 84151 });
    expect(s[2].period).toBe('2027-01');
    expect(s.slice(0, 11).every((i) => i.payment === 8885)).toBe(true);
    expect(s[11].balance).toBe(0);
    expect(sum(s.map((i) => i.principal))).toBe(100000);
    // the same totals as the database's loan_schedule
    expect(totalInterest(s)).toBe(6619);
    expect(scheduleTotals(s)).toEqual({ instalment: 8885, totalInterest: 6619, totalRepayable: 106619 });
  });

  it('flat: the interest on the whole amount, spread evenly', () => {
    const s = loanSchedule(100000, 12, 12, 'flat', '2026-11');
    expect(s.map((i) => i.payment)).toEqual([...Array(11).fill(9333), 9337]);
    expect(s[0]).toMatchObject({ principal: 8333, interest: 1000, balance: 91667 });
    expect(s[11]).toMatchObject({ principal: 8337, interest: 1000, balance: 0 });
    expect(scheduleTotals(s)).toEqual({ instalment: 9333, totalInterest: 12000, totalRepayable: 112000 });
  });

  it('0%: equal parts with the remainder last', () => {
    expect(loanSchedule(10000, 0, 3, 'reducing_balance', '2026-11').map((i) => i.payment)).toEqual([3333, 3333, 3334]);
    expect(loanSchedule(10000, 0, 3, 'flat', '2026-11').map((i) => i.payment)).toEqual([3333, 3333, 3334]);
  });

  it('totals are exact for awkward amounts and terms', () => {
    for (const [p, rate, n] of [[12345.67, 13.5, 7], [999, 24, 36], [250000, 18, 60], [1, 12, 12]] as const) {
      for (const method of ['reducing_balance', 'flat'] as const) {
        const s = loanSchedule(p, rate, n, method, '2026-01');
        expect(s).toHaveLength(n);
        expect(sum(s.map((i) => i.principal))).toBe(p);
        expect(s[n - 1].balance).toBe(0);
        expect(sum(s.map((i) => i.payment))).toBe(sum([p, totalInterest(s)]));
        expect(s.every((i) => i.principal >= 0 && i.interest >= 0)).toBe(true);
      }
    }
  });

  it('runs across the year end', () => {
    expect(loanSchedule(3000, 0, 3, 'flat', '2026-12').map((i) => i.period)).toEqual(['2026-12', '2027-01', '2027-02']);
    expect(addMonths('2026-12', 13)).toBe('2028-01');
  });

  it('nothing without an amount or a start', () => {
    expect(loanSchedule(0, 12, 12, 'flat', '2026-11')).toEqual([]);
    expect(loanSchedule(1000, 12, 12, 'flat', '')).toEqual([]);
  });
});

describe('what payroll takes', () => {
  const schedule = loanSchedule(12000, 0, 3, 'flat', '2026-10'); // 4,000 a month, October to December

  it('nothing before the first month; the instalment in each month', () => {
    expect(loanDueFor(schedule, [], '2026-09')).toBe(0);
    expect(loanDueFor(schedule, [], '2026-10')).toBe(4000);
    expect(loanDueFor(schedule, [{ pay_period: '2026-10', amount: 4000 }], '2026-11')).toBe(4000);
  });

  it('a shortfall carries forward, and is still due after the last instalment', () => {
    // October took only 1,500
    expect(loanDueFor(schedule, [{ pay_period: '2026-10', amount: 1500 }], '2026-11')).toBe(6500);
    const repaid = [
      { pay_period: '2026-10', amount: 1500 },
      { pay_period: '2026-11', amount: 4000 },
      { pay_period: '2026-12', amount: 4000 },
    ];
    expect(loanDueFor(schedule, repaid, '2027-01')).toBe(2500);
    expect(outstandingBalance(schedule, repaid)).toBe(2500);
  });

  it("this month's own draft repayment does not count, and nothing is taken once it is repaid", () => {
    expect(loanDueFor(schedule, [{ pay_period: '2026-10', amount: 4000 }], '2026-10')).toBe(4000);
    const all = ['2026-10', '2026-11', '2026-12'].map((pay_period) => ({ pay_period, amount: 4000 }));
    expect(loanDueFor(schedule, all, '2027-01')).toBe(0);
    expect(outstandingBalance(schedule, all)).toBe(0);
  });

  const loans: PayrollLoan[] = [
    { id: 'L1', employee_number: 'E1', product_name: 'School fees loan', status: 'repaying', schedule, repayments: [] },
    { id: 'L2', employee_number: 'E1', product_name: null, status: 'disbursed', schedule: loanSchedule(6000, 0, 3, 'flat', '2026-10'), repayments: [] },
    { id: 'L3', employee_number: 'E2', product_name: null, status: 'disbursed', schedule, repayments: [] },
    { id: 'L4', employee_number: 'E1', product_name: null, status: 'approved', schedule, repayments: [] },
  ];

  it('the payslip lines: each disbursed or repaying loan of the employee, named after its type', () => {
    expect(loanDeductionsFor(loans, 'E1', '2026-10', 50000)).toEqual([
      { name: 'Loan repayment: School fees loan', amount: 4000, loan_id: 'L1' },
      { name: 'Loan repayment: Staff loan', amount: 2000, loan_id: 'L2' },
    ]);
    expect(loanLineName('  ')).toBe('Loan repayment: Staff loan');
  });

  it('never more than the pay left: what does not fit waits for next month', () => {
    expect(loanDeductionsFor(loans, 'E1', '2026-10', 5000)).toEqual([
      { name: 'Loan repayment: School fees loan', amount: 4000, loan_id: 'L1' },
      { name: 'Loan repayment: Staff loan', amount: 1000, loan_id: 'L2' },
    ]);
    expect(loanDeductionsFor(loans, 'E1', '2026-10', 0)).toEqual([]);
    expect(loanDeductionsFor(loans, 'E1', '2026-10', -300)).toEqual([]);
  });
});

describe('limits and checks', () => {
  it('the most someone may borrow is the lower of the fixed amount and the salary multiple', () => {
    expect(maxLoanFor(DEFAULT_LOAN_SETTINGS, 50000)).toBeNull();
    expect(maxLoanFor({ ...DEFAULT_LOAN_SETTINGS, max_salary_multiple: 3 }, '50000')).toBe(150000);
    expect(maxLoanFor({ ...DEFAULT_LOAN_SETTINGS, max_salary_multiple: 3, max_amount: 100000 }, 50000)).toBe(100000);
    expect(maxLoanFor({ ...DEFAULT_LOAN_SETTINGS, max_amount: 100000 }, null)).toBe(100000);
  });

  it('a loan type sets its own longest term', () => {
    expect(maxMonthsFor(DEFAULT_LOAN_SETTINGS)).toBe(12);
    expect(maxMonthsFor(DEFAULT_LOAN_SETTINGS, { max_months: 6 })).toBe(6);
  });

  it('checks a request', () => {
    const limits = { minMonths: 2, maxMonths: 12, maxAmount: 100000 };
    expect(validateLoanRequest({ amount: '50000', months: 6, reason: 'School fees for next term' }, limits)).toEqual({});
    const errors = validateLoanRequest({ amount: '150000', months: 1, reason: 'fees' }, limits);
    expect(errors.amount).toBe('The most you can borrow is KSh 100,000.');
    expect(errors.months).toBe('Choose between 2 and 12 months.');
    expect(errors.reason).toMatch(/at least 10 characters/);
    expect(validateLoanRequest({ amount: '', months: 6, reason: 'School fees for next term' }, { ...limits, maxAmount: null }).amount).toMatch(/Enter the amount/);
  });

  it('checks the settings', () => {
    expect(settingsError(DEFAULT_LOAN_SETTINGS)).toBeNull();
    expect(settingsError({ ...DEFAULT_LOAN_SETTINGS, annual_rate: 120 })).toMatch(/between 0% and 100%/);
    expect(settingsError({ ...DEFAULT_LOAN_SETTINGS, min_months: 13 })).toMatch(/can’t be longer/);
    expect(settingsError({ ...DEFAULT_LOAN_SETTINGS, max_amount: 0 })).toMatch(/above 0/);
  });
});
