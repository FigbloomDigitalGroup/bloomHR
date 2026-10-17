import { describe, expect, it } from 'vitest';
import { leavePayoutItems, leavePayoutLabel, type LeavePayoutDue } from './leavePay';
import { statutoryPayWith, summariseEarnings } from './earnings';

const payout = (days: number, extra: Partial<LeavePayoutDue> = {}): LeavePayoutDue => ({
  id: 'p1', employee_number: 'E1', leave_type: 'Annual Leave', days, year: 2027, pay_period: '2027-01', month_working_days: 20, ...extra,
});

describe('leave paid out on the payslip (FIG-877)', () => {
  it('is days x a day\'s pay, basic / 30 by default', () => {
    const items = leavePayoutItems([payout(5)], 30000, 'basic_30');
    expect(items).toEqual([{ name: 'Leave paid out: 5 days', amount: 5000, taxable: true, pensionable: true, leave_payout_id: 'p1' }]);
  });

  it('or basic / the month\'s working days', () => {
    expect(leavePayoutItems([payout(2, { month_working_days: 21 })], 42000, 'working_days')[0].amount).toBe(4000);
  });

  it('one line per payout; none without payouts or a salary', () => {
    expect(leavePayoutItems([payout(1), payout(2.5, { id: 'p2', leave_type: 'Study Leave' })], 3000, 'basic_30').map((i) => [i.name, i.amount]))
      .toEqual([['Leave paid out: 1 day', 100], ['Leave paid out: 2.5 days', 250]]);
    expect(leavePayoutItems(undefined, 30000, 'basic_30')).toEqual([]);
    expect(leavePayoutItems([payout(5)], 0, 'basic_30')).toEqual([]);
    expect(leavePayoutLabel(1)).toBe('Leave paid out: 1 day');
  });

  it('is taxable cash pay with the month\'s other earnings', () => {
    const items = [{ name: 'Bonus', amount: 1000, taxable: true, pensionable: true }, ...leavePayoutItems([payout(5)], 30000, 'basic_30')];
    const e = summariseEarnings(items);
    expect(e.taxable).toBe(6000);
    expect(e.bonus).toBe(6000);
    expect(statutoryPayWith(20000, items).cashPay).toBe(26000);
  });
});
