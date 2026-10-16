import { describe, expect, it } from 'vitest';
import {
  basicAfterLeave,
  leaveDailyRate,
  leaveLineLabel,
  leaveLineWorking,
  leaveLinesText,
  leavePayFor,
  payslipLeaveLines,
  type LeavePayRow,
} from './leavePay';
import { statutoryFor } from './statutoryCalc';

// The rates seeded in statutory_rates for October 2026 (as statutoryCalc.test.ts)
const rates = {
  paye_bands: [{ upto: 24000, rate: 0.1 }, { upto: 32333, rate: 0.25 }, { upto: 500000, rate: 0.3 }, { upto: 800000, rate: 0.325 }, { upto: null, rate: 0.35 }],
  personal_relief: 2400, insurance_relief_rate: 0.15, insurance_relief_cap: 5000, pension_deduction_cap: 30000,
  prmf_deduction_cap: 15000, mortgage_interest_cap: 30000, non_cash_benefit_exempt_limit: 5000, meals_exempt_limit: 5000,
  pwd_exempt_income: 150000, shif_deductible: 1, ahl_deductible: 1, shif_rate: 0.0275, shif_minimum: 300, ahl_rate: 0.015,
  nssf_rate: 0.06, nssf_lower_limit: 9000, nssf_upper_limit: 108000,
};

const row = (apps: Partial<LeavePayRow['applications'][number]>[], monthWorkingDays = 22): LeavePayRow => {
  const applications = apps.map((a, i) => ({
    id: `app-${i}`, leave_type: 'Unpaid Leave', start_date: '2026-10-05', end_date: '2026-10-06', days_in_month: 2,
    unpaid_days: 0, half_pay_days: 0, ...a,
  }));
  return {
    employee_number: 'E1',
    unpaid_days: applications.reduce((s, a) => s + a.unpaid_days, 0),
    half_pay_days: applications.reduce((s, a) => s + a.half_pay_days, 0),
    month_working_days: monthWorkingDays,
    applications,
  };
};

describe('a day’s pay', () => {
  it('is basic ÷ 30 by default, to the cent', () => {
    expect(leaveDailyRate(60000, 'basic_30')).toBe(2000);
    expect(leaveDailyRate(50000, 'basic_30')).toBe(1666.67);
    expect(leaveDailyRate(50000, 'basic_30', 22)).toBe(1666.67); // working days ignored
  });

  it("is basic ÷ the month's working days when the company chooses it", () => {
    expect(leaveDailyRate(44000, 'working_days', 22)).toBe(2000);
    expect(leaveDailyRate(50000, 'working_days', 23)).toBe(2173.91);
  });

  it('falls back to ÷ 30 when the working days are unknown', () => {
    expect(leaveDailyRate(60000, 'working_days', 0)).toBe(2000);
  });
});

describe('leavePayFor', () => {
  it('has nothing for an employee without unpaid or half-pay leave', () => {
    expect(leavePayFor(undefined, 60000, 'basic_30')).toEqual({ items: [], total: 0, dailyRate: 0 });
  });

  it('takes a day for each unpaid day and half a day for each half-pay day', () => {
    const r = leavePayFor(row([
      { unpaid_days: 2 },
      { leave_type: 'Sick Leave', half_pay_days: 3, days_in_month: 5 },
    ]), 60000, 'basic_30');
    expect(r.dailyRate).toBe(2000);
    expect(r.items.map((i) => [leaveLineLabel(i), i.amount])).toEqual([
      ['Unpaid Leave: 2 days', 4000],
      ['Sick Leave at half pay: 3 days', 3000],
    ]);
    expect(r.total).toBe(7000);
    expect(leaveLineWorking(r.items[1])).toBe('3 × KSh 2,000.00 × ½');
  });

  it('puts one leave type’s applications on one line, and keeps which applications they were', () => {
    const r = leavePayFor(row([{ unpaid_days: 1, id: 'a' }, { unpaid_days: 1.5, id: 'b' }]), 30000, 'basic_30');
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ days: 2.5, daily_rate: 1000, amount: 2500 });
    expect(r.items[0].applications.map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('rounds each line to the cent', () => {
    // 50,000 / 30 = 1,666.67 a day; 3 half-pay days = 2,500.005 -> 2,500.01
    const r = leavePayFor(row([{ leave_type: 'Sick Leave', half_pay_days: 3 }]), 50000, 'basic_30');
    expect(r.total).toBe(2500.01);
  });

  it("works on the month's working days when the company chooses it", () => {
    const r = leavePayFor(row([{ unpaid_days: 2 }], 22), 44000, 'working_days');
    expect(r.total).toBe(4000);
  });

  it('a leave type not named "Unpaid ..." says it is unpaid', () => {
    const r = leavePayFor(row([{ leave_type: 'Study Leave', unpaid_days: 1 }]), 30000, 'basic_30');
    expect(leaveLineLabel(r.items[0])).toBe('Study Leave (unpaid): 1 day');
  });

  it('never takes more than the basic salary', () => {
    // 31 calendar days of unpaid leave at basic / 30
    const r = leavePayFor(row([{ unpaid_days: 31 }]), 30000, 'basic_30');
    expect(r.total).toBe(30000);
  });
});

describe('tax on the reduced gross', () => {
  it('PAYE, NSSF, SHIF and the housing levy are worked out on pay after the leave deduction', () => {
    const basic = 60000;
    const leave = leavePayFor(row([{ unpaid_days: 2 }, { leave_type: 'Sick Leave', half_pay_days: 3 }]), basic, 'basic_30');
    expect(leave.total).toBe(7000);
    const { earnedBasic, perDiem } = basicAfterLeave(basic, leave.total);
    expect(earnedBasic).toBe(53000);
    expect(perDiem).toBeCloseTo(17490, 2); // 33% of what was earned
    const gross = earnedBasic; // no allowances
    const reduced = statutoryFor({ cashPay: gross - perDiem }, rates);
    const full = statutoryFor({ cashPay: basic - basicAfterLeave(basic, 0).perDiem }, rates);
    // cash pay 35,510 rather than 40,200
    expect(reduced.ahl).toBe(532.65);
    expect(reduced.nssf).toBe(2130.6);
    expect(reduced.shif).toBe(976.53);
    expect(reduced.paye).toBeLessThan(full.paye);
    expect(reduced.paye).toBeCloseTo(statutoryFor({ cashPay: 35510 }, rates).paye, 2);
  });

  it('a whole month unpaid leaves no basic and no per diem', () => {
    expect(basicAfterLeave(30000, 30000)).toEqual({ earnedBasic: 0, perDiem: 0 });
  });
});

describe('saved payslips', () => {
  it('reads the lines back, and older payslips have none', () => {
    const saved = { leave_items: [{ name: 'Unpaid Leave', kind: 'unpaid', days: 2, daily_rate: 1000, amount: 2000 }] };
    expect(payslipLeaveLines(saved).map(leaveLineLabel)).toEqual(['Unpaid Leave: 2 days']);
    expect(leaveLinesText(saved)).toBe('Unpaid Leave: 2 days -2000');
    expect(payslipLeaveLines({})).toEqual([]);
  });
});
