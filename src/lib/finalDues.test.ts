import { describe, expect, it } from 'vitest';
import { duesTotals, finalDuesLines, leaveDaysOutstanding, statementCsv, type FinalDuesInput } from './finalDues';

const base: FinalDuesInput = {
  basicSalary: 60000,
  lastWorkingDay: '2026-11-15',
  startDate: '2020-01-06',
  noticeGivenOn: '2026-10-18',
  noticeDays: 28,
  noticePay: false,
  leaveDays: 0,
  advances: 0,
  loans: 0,
  voluntary: [],
};

describe('final dues', () => {
  it('pro-rates the last month by days worked over days in the month', () => {
    const [basic] = finalDuesLines(base);
    expect(basic).toMatchObject({ code: 'basic', kind: 'earning', amount: 30000, detail: '15 of 30 days x 60,000.00 / 30' });
    expect(finalDuesLines({ ...base, lastWorkingDay: '2026-12-31' })[0].amount).toBe(60000);
    // February: 10 of 28 days
    expect(finalDuesLines({ ...base, lastWorkingDay: '2027-02-10' })[0].amount).toBe(21428.57);
    // started in the last month: only from their first day
    expect(finalDuesLines({ ...base, startDate: '2026-11-11' })[0].amount).toBe(10000);
  });

  it('pays leave not taken at basic / 30 a day, and takes back leave overdrawn', () => {
    const leave = finalDuesLines({ ...base, leaveDays: 7.5 }).find((l) => l.code === 'leave');
    expect(leave).toMatchObject({ kind: 'earning', amount: 15000 });
    const over = finalDuesLines({ ...base, leaveDays: -2 }).find((l) => l.code === 'leave');
    expect(over).toMatchObject({ kind: 'deduction', amount: 4000 });
    expect(finalDuesLines(base).some((l) => l.code === 'leave')).toBe(false);
  });

  it('pays in lieu only the notice not worked, and only when the exit says so', () => {
    expect(finalDuesLines(base).some((l) => l.code === 'notice')).toBe(false);
    // given 18 Oct, left 15 Nov: 28 days served, nothing owed
    expect(finalDuesLines({ ...base, noticePay: true }).some((l) => l.code === 'notice')).toBe(false);
    // told on the 10th, out on the 15th: 23 of 28 days not worked
    const notice = finalDuesLines({ ...base, noticePay: true, noticeGivenOn: '2026-11-10' }).find((l) => l.code === 'notice');
    expect(notice).toMatchObject({ kind: 'earning', amount: 46000 });
  });

  it('deducts advances, loans and the voluntary deductions due, and totals the statement', () => {
    const lines = finalDuesLines({
      ...base,
      leaveDays: 5,
      advances: 5000,
      loans: 12000.456,
      voluntary: [
        { name: 'SACCO', amount: 2000 },
        { name: 'Welfare', amount: 0 },
      ],
    });
    expect(lines.filter((l) => l.kind === 'deduction').map((l) => [l.label, l.amount])).toEqual([
      ['Salary advances owed', 5000],
      ['Loans owed', 12000.46],
      ['SACCO', 2000],
    ]);
    expect(duesTotals(lines)).toEqual({ earnings: 40000, deductions: 19000.46, net: 20999.54 });
  });

  it('works out leave outstanding from the balance', () => {
    // a yearly allowance given in January is earned month by month for a leaver: 21 days, leaving in June = 10.5
    expect(leaveDaysOutstanding({ accrued: 21, carried: 2, used: 4, method: 'annual', month: 6 })).toBe(8.5);
    // already earned month by month: as it stands
    expect(leaveDaysOutstanding({ accrued: 10, carried: 0, used: 12, method: 'monthly_cumulative', month: 6 })).toBe(-2);
  });

  it('exports as CSV with totals and the net', () => {
    const csv = statementCsv(finalDuesLines({ ...base, advances: 1000 }));
    expect(csv.split('\r\n')[0]).toBe('Item,Detail,Earning,Deduction');
    expect(csv).toContain('Salary advances owed,,,"1,000.00"');
    expect(csv).toContain('Net final dues (before tax and statutory deductions),,"29,000.00",');
  });
});
