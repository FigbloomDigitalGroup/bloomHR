// The month-end settlement of piece rate work and contract jobs (FIG-812 stage 5): the maths, through the payroll
// page's own payslip calculation (lib/payslipCalc) so PAYE, NSSF, SHIF and AHL come from the same engine as salary.
import { describe, expect, it } from 'vitest';
import { calculatePayslip, type PayslipContext } from './payslipCalc';
import {
  arrearsNote,
  payslipSettlementLines,
  payslipWorkLines,
  settleMonth,
  settlementApplies,
  workMonthOf,
  type WorkSettlementRow,
} from './workSettlement';

const rates = {
  paye_bands: [
    { upto: 24000, rate: 0.1 }, { upto: 32333, rate: 0.25 }, { upto: 500000, rate: 0.3 }, { upto: 800000, rate: 0.325 }, { upto: null, rate: 0.35 },
  ],
  personal_relief: 2400, shif_rate: 0.0275, shif_minimum: 300, nssf_rate: 0.06, nssf_upper_limit: 108000, ahl_rate: 0.015,
  shif_deductible: 1, ahl_deductible: 1, wht_contractual: 0.03, wht_professional: 0.05, nita_levy: 50, per_diem_rate: 0.33,
};

const ctx = (over: Partial<PayslipContext> = {}): PayslipContext => ({
  period: '2026-10',
  rates,
  overrideStatutoryChecks: true,
  voluntaryByEmployee: new Map(),
  payrollLoans: [],
  earningsByEmployee: new Map(),
  leaveByEmployee: new Map(),
  leaveBasis: 'basic_30',
  absenceByEmployee: new Map(),
  leavePayouts: new Map(),
  overtimeMonth: undefined,
  advanceFor: () => 0,
  ...over,
});

const row = (r: Partial<WorkSettlementRow> & { employee_number: string }): WorkSettlementRow => ({
  work_gross: 0, jobs_gross: 0, paid: 0, ahl: 0, reserve: 0, wht: 0, rounding: 0, arrears: 0, ...r,
});

const worker = { 'Employee Number': 'W1', 'First Name': 'Wanjiru', worker_kind: 'employee', pay_basis: 'work', 'Basic Salary': 0 };
const contractor = { 'Employee Number': 'C1', 'First Name': 'Chege', worker_kind: 'contractor', wht_category: 'contractual', pay_basis: 'work', 'Basic Salary': 0 };
const salaried = { 'Employee Number': 'S1', 'First Name': 'Sara', worker_kind: 'employee', pay_basis: 'salary', 'Basic Salary': 60000, house_allowance: 10000 };

// the worked example: no salary, KES 30,000 of work in the month, 20,000 of it paid out during the month (AHL 1.5% =
// 300 and the 10% reserve = 2,000 held back, so 17,700 received)
const example = row({ employee_number: 'W1', work_gross: 30000, paid: 17700, ahl: 300, reserve: 2000, work_lines: [{ name: 'Tea picked', unit: 'kg', quantity: 1500, amount: 30000 }] });

describe('piece rate only (the worked example)', () => {
  const p = calculatePayslip(worker, ctx({ workByEmployee: new Map([['W1', example]]) }));

  it("adds the month's work to gross pay and works out PAYE, NSSF, SHIF and AHL on the total", () => {
    expect(p.gross_pay).toBe(30000);
    expect(p.work_pay).toBe(30000);
    expect(p.nhif_deduction).toBe(825);
    expect(p.nssf_deduction).toBe(1800);
    expect(p.housing_levy).toBe(450);
    // taxable 30,000 - 1,800 - 825 - 450 = 26,925: 2,400 + 2,925 x 25% = 3,131.25, less 2,400 relief
    expect(p.paye_tax).toBe(731.25);
    expect(p.total_deductions).toBeCloseTo(3806.25, 2);
  });

  it('pays the balance: net for the month less what was already paid; holdbacks are not deducted again', () => {
    // 30,000 - 3,806.25 = 26,193.75 for the month; 17,700 already paid: 8,493.75 now
    // (= the 10,000 not paid out + the 2,000 reserve released + the 300 AHL credited - 3,806.25)
    expect(p.paid_out).toBe(17700);
    expect(p.ahl_withheld).toBe(300);
    expect(p.reserve_released).toBe(2000);
    expect(p.net_pay).toBeCloseTo(8493.75, 2);
    expect(p.arrears_carried_forward).toBe(0);
    expect(p.work_settlement).toBe(true);
  });

  it('the payslip shows the work and the settlement lines', () => {
    expect(payslipWorkLines(p)).toEqual([{ name: 'Piece rate work', amount: 30000, detail: ['Tea picked: 1,500 kg, KSh 30,000'] }]);
    expect(payslipSettlementLines(p).map((l) => [l.label, l.kind, l.amount])).toEqual([
      ['Net pay for the month', 'total', 26193.75],
      ['Already paid during the month', 'minus', 17700],
      ['Held back (reserve) released', 'info', 2000],
      ['AHL already withheld', 'info', 300],
      ['Net to pay at month end', 'total', 8493.75],
    ]);
  });
});

describe('salaried plus piece rate', () => {
  const w = row({ employee_number: 'S1', work_gross: 10000, jobs_gross: 5000, paid: 4425, ahl: 75, reserve: 500 });
  const p = calculatePayslip(salaried, ctx({ workByEmployee: new Map([['S1', w]]) }));
  const alone = calculatePayslip(salaried, ctx());

  it('one payslip: salary and work together, taxed on the total', () => {
    expect(p.gross_pay).toBe(85000);
    expect(p.work_pay).toBe(10000);
    expect(p.jobs_pay).toBe(5000);
    expect(p.paye_tax).toBeGreaterThan(alone.paye_tax);
    // the extra 15,000 is cash pay: SHIF and AHL rise by 2.75% and 1.5% of it
    expect(p.nhif_deduction - alone.nhif_deduction).toBeCloseTo(412.5, 2);
    expect(p.housing_levy - alone.housing_levy).toBeCloseTo(225, 2);
  });

  it('net = gross - deductions - paid out', () => {
    expect(p.net_pay).toBeCloseTo(85000 - p.total_deductions - 4425, 2);
    expect(payslipWorkLines(p).map((l) => l.name)).toEqual(['Piece rate work', 'Contract jobs']);
  });
});

describe('contractors', () => {
  const c = row({ employee_number: 'C1', worker_kind: 'contractor', work_gross: 10000, paid: 4850, wht: 150 });
  const p = calculatePayslip(contractor, ctx({ workByEmployee: new Map([['C1', c]]) }));

  it('no PAYE, NSSF, SHIF, AHL or NITA: withholding tax on the month instead', () => {
    expect([p.paye_tax, p.nssf_deduction, p.nhif_deduction, p.housing_levy, p.tax_relief, p.nita_levy]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(p.wht_rate).toBe(0.03);
    expect(p.wht_tax).toBe(300);
    expect(p.total_deductions).toBe(300);
  });

  it('credits the WHT payouts already withheld: the balance is the unpaid work less the rest of the WHT', () => {
    // 10,000 - 300 - 4,850 = 4,850 (the 5,000 not paid out less the remaining 150 of WHT)
    expect(p.net_pay).toBe(4850);
    expect(payslipSettlementLines(p).find((l) => l.label === 'WHT already withheld')).toMatchObject({ amount: 150, kind: 'info' });
  });

  it('a professional contractor at 5%', () => {
    const q = calculatePayslip({ ...contractor, wht_category: 'professional' }, ctx({ workByEmployee: new Map([['C1', row({ employee_number: 'C1', work_gross: 10000 })]]) }));
    expect(q.wht_tax).toBe(500);
    expect(q.net_pay).toBe(9500);
  });

  it("the two-thirds cap doesn't apply to a contractor; a negative balance still carries forward", () => {
    const vol = new Map([['C1', [{ name: 'Tools', amount: 9000 }]]]);
    const q = calculatePayslip(contractor, ctx({ voluntaryByEmployee: vol, workByEmployee: new Map([['C1', row({ employee_number: 'C1', work_gross: 10000 })]]) }));
    // 10,000 - 300 WHT - 9,000 = 700: over two-thirds, but taken in full
    expect(q.net_pay).toBe(700);
    expect(q.arrears_carried_forward).toBe(0);
  });
});

describe('a negative balance becomes an arrear', () => {
  it('all the work paid out and a deduction on top: 0 net pay, the rest carried forward', () => {
    // 30,000 all paid out (AHL 450 and reserve 3,000 held: 26,550 received), and a 5,000 SACCO deduction
    const w = row({ employee_number: 'W1', work_gross: 30000, paid: 26550, ahl: 450, reserve: 3000 });
    const p = calculatePayslip(worker, ctx({ workByEmployee: new Map([['W1', w]]), voluntaryByEmployee: new Map([['W1', [{ name: 'SACCO', amount: 5000 }]]]) }));
    // left to pay 3,450; deductions 3,806.25 + 5,000 = 8,806.25
    expect(p.net_pay).toBe(0);
    expect(p.arrears_carried_forward).toBeCloseTo(5356.25, 2);
    expect(p.arrears_note).toMatch(/more than was left to pay/);
    // gross - deductions - paid out + carried forward = net pay
    expect(p.gross_pay - p.total_deductions - p.paid_out + p.arrears_carried_forward).toBeCloseTo(p.net_pay, 2);
    expect(payslipSettlementLines(p).at(-2)).toMatchObject({ label: 'Carried forward', kind: 'plus' });
  });

  it('arrears brought forward come off the next month', () => {
    const w = row({ employee_number: 'W1', work_gross: 30000, arrears: 5356.25 });
    const p = calculatePayslip(worker, ctx({ workByEmployee: new Map([['W1', w]]) }));
    expect(p.arrears_brought_forward).toBe(5356.25);
    expect(p.net_pay).toBeCloseTo(30000 - 3806.25 - 5356.25, 2);
  });

  it('loans are taken only from what is left after payouts', () => {
    // 30,000 of work, 20,000 of it paid out (17,700 received): 12,300 left, less 3,806.25 of deductions = 8,493.75 room
    const loans = [{ id: 'L1', employee_number: 'W1', product_name: 'Staff loan', status: 'disbursed', repayments: [],
      schedule: [{ instalment_no: 1, period: '2026-10', payment: 9000, principal: 9000, interest: 0, balance: 0 }] }];
    const p = calculatePayslip(worker, ctx({ workByEmployee: new Map([['W1', example]]), payrollLoans: loans as never }));
    expect(p.loan_deduction).toBeCloseTo(8493.75, 2);
    expect(p.net_pay).toBe(0);
    expect(p.arrears_carried_forward).toBe(0);
  });
});

describe('the two-thirds cap (Employment Act s.19(3))', () => {
  it('deductions above two-thirds of wages carry forward', () => {
    const r = settleMonth({ grossPay: 9000, totalDeductions: 8000, statutory: 1000, paidOut: 0, arrearsBroughtForward: 1000, cap: true });
    expect(r).toEqual({ netPay: 3000, carriedForward: 3000, deferredByCap: 3000, shortfall: 0, capLimit: 6000 });
    expect(arrearsNote(r)).toMatch(/over the two-thirds limit/);
  });

  it('the statutory deductions are always taken in full, even above the cap', () => {
    const r = settleMonth({ grossPay: 3000, totalDeductions: 3000, statutory: 2500, paidOut: 0, arrearsBroughtForward: 0, cap: true });
    expect(r).toMatchObject({ netPay: 500, deferredByCap: 500, carriedForward: 500 });
  });

  it('off: everything is taken that fits', () => {
    const r = settleMonth({ grossPay: 9000, totalDeductions: 8000, statutory: 1000, paidOut: 0, arrearsBroughtForward: 1000, cap: false });
    expect(r).toMatchObject({ netPay: 0, carriedForward: 0, capLimit: null });
  });

  it('applies through the payslip, and the company can turn it off', () => {
    const vol = new Map([['W1', [{ name: 'SACCO', amount: 20000 }]]]);
    const work = new Map([['W1', row({ employee_number: 'W1', work_gross: 30000 })]]);
    const on = calculatePayslip(worker, ctx({ voluntaryByEmployee: vol, workByEmployee: work }));
    // deductions 23,806.25 against a 20,000 limit: 3,806.25 carried forward, 10,000 paid
    expect(on.net_pay).toBeCloseTo(10000, 2);
    expect(on.arrears_carried_forward).toBeCloseTo(3806.25, 2);
    const off = calculatePayslip(worker, ctx({ voluntaryByEmployee: vol, workByEmployee: work, deductionCap: false }));
    expect(off.net_pay).toBeCloseTo(6193.75, 2);
    expect(off.arrears_carried_forward).toBe(0);
  });
});

describe('rounding', () => {
  it('the cents payouts held back by rounding are released with the reserve', () => {
    expect(workMonthOf(row({ employee_number: 'R1', work_gross: 86.38, paid: 76, ahl: 1.3, reserve: 8.64, rounding: 0.44 })).reserveReleased).toBe(9.08);
  });

  it('every figure is to the cent, with no floating-point drift', () => {
    const r = settleMonth({ grossPay: 0.1 + 0.2, totalDeductions: 0.1, statutory: 0.1, paidOut: 0.1, arrearsBroughtForward: 0, cap: true });
    expect(r.netPay).toBe(0.1);
    const p = calculatePayslip(worker, ctx({ workByEmployee: new Map([['W1', row({ employee_number: 'W1', work_gross: 86.38, paid: 76, ahl: 1.3, reserve: 8.64, rounding: 0.44 })]]) }));
    expect(Math.round(p.net_pay * 100) / 100).toBe(p.net_pay);
    expect(p.reserve_released).toBe(9.08);
    // SHIF's 300 minimum is more than 86.38: 0 now, the rest carried forward, all to the cent
    expect(p.net_pay).toBe(0);
    expect(p.gross_pay - p.total_deductions - p.paid_out + p.arrears_carried_forward).toBeCloseTo(p.net_pay, 2);
    expect(Math.round(p.arrears_carried_forward * 100) / 100).toBe(p.arrears_carried_forward);
  });
});

describe('who it applies to', () => {
  it('workers paid by work, contractors and anyone with work, payouts or arrears; not a salaried employee with none', () => {
    const none = workMonthOf(undefined);
    expect(settlementApplies(salaried, none)).toBe(false);
    expect(settlementApplies(worker, none)).toBe(true);
    expect(settlementApplies(contractor, none)).toBe(true);
    expect(settlementApplies(salaried, workMonthOf(row({ employee_number: 'S1', arrears: 10 })))).toBe(true);
  });
});

describe('salaried payslips are unchanged (regression)', () => {
  // before stage 5: basic 60,000 + house 10,000, a 33% per diem not taxed, a 2,000 SACCO deduction
  const before = {
    gross_pay: 70000, per_diem: 19800, nhif_deduction: 1380.5, nssf_deduction: 3012, housing_levy: 753, paye_tax: 5899.7,
    tax_relief: 2400, other_deductions: 2000, total_deductions: 13045.2, net_pay: 56954.8, nita_levy: 50,
  };
  const vol = new Map([['S1', [{ name: 'SACCO', amount: 2000 }]]]);

  it('has the same figures as before', () => {
    const p = calculatePayslip(salaried, ctx({ voluntaryByEmployee: vol }));
    for (const [k, v] of Object.entries(before)) expect(p[k], k).toBeCloseTo(v, 2);
  });

  it("other people's work in the month changes nothing on it, and its settlement fields are empty", () => {
    const without = calculatePayslip(salaried, ctx({ voluntaryByEmployee: vol }));
    const withOthers = calculatePayslip(salaried, ctx({ voluntaryByEmployee: vol, workByEmployee: new Map([['W1', example]]), deductionCap: true }));
    expect(withOthers).toEqual(without);
    expect(without).toMatchObject({
      work_pay: 0, jobs_pay: 0, paid_out: 0, ahl_withheld: 0, reserve_released: 0, wht_withheld: 0, wht_rate: 0, wht_tax: 0,
      arrears_brought_forward: 0, arrears_carried_forward: 0, arrears_note: null, work_settlement: false,
    });
    expect(payslipSettlementLines(without)).toEqual([]);
    expect(payslipWorkLines(without)).toEqual([]);
  });

  it('a salaried payslip can still go below 0 as before (no arrears or cap for it)', () => {
    const big = new Map([['S1', [{ name: 'SACCO', amount: 80000 }]]]);
    const p = calculatePayslip(salaried, ctx({ voluntaryByEmployee: big }));
    expect(p.net_pay).toBeLessThan(0);
    expect(p.arrears_carried_forward).toBe(0);
  });
});

describe('editing a settlement payslip by hand (FIG-883)', () => {
  it('keeps the settlement: a one-off deduction comes off the balance, never below 0, the rest carried forward', async () => {
    const { applyPayslipOverride, statutoryContextFor } = await import('./payslipOverrides');
    const p = calculatePayslip(worker, ctx({ workByEmployee: new Map([['W1', example]]) }));
    const edited = applyPayslipOverride(p, { one_off_deductions: [{ label: 'Damaged crates', amount: 10000 }] }, statutoryContextFor(worker, rates, true));
    // 8,493.75 to pay before; a 10,000 deduction leaves 0 and 1,506.25 carried forward
    expect(edited.net_pay).toBe(0);
    expect(edited.arrears_carried_forward).toBeCloseTo(1506.25, 2);
  });

  it("a contractor's edited payslip has WHT on the new gross, not PAYE", async () => {
    const { applyPayslipOverride, statutoryContextFor } = await import('./payslipOverrides');
    const c = row({ employee_number: 'C1', work_gross: 10000, paid: 4850, wht: 150 });
    const p = calculatePayslip(contractor, ctx({ workByEmployee: new Map([['C1', c]]) }));
    const edited = applyPayslipOverride(p, { one_off_earnings: [{ label: 'Bonus', amount: 2000, taxable: true }] }, statutoryContextFor(contractor, rates, true));
    expect(edited.paye_tax).toBe(0);
    expect(edited.wht_tax).toBe(360);
    expect(edited.net_pay).toBe(12000 - 360 - 4850);
  });
});
