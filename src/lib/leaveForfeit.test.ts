import { describe, expect, it } from 'vitest';
import { forfeitCsv, forfeitWhy, summariseForfeits } from './leaveForfeit';
import type { ForfeitRow } from './leaveYearDb';

const row = (over: Partial<ForfeitRow>): ForfeitRow => ({
  kind: 'forfeit', reason: 'over_cap', employee_number: 'E1', employee_name: 'Ann One', leave_type: 'Annual Leave', year: 2027,
  days: 4, on_date: '2027-01-01', status: null, amount: null, pay_period: null, note: '4 unused day(s) from 2026 were over the cap', ...over,
});

const rows: ForfeitRow[] = [
  row({}),
  row({ reason: 'carry_expired', days: 2, on_date: '2027-07-01', note: '2 of 6 carried days lost' }),
  row({ kind: 'pay_out', leave_type: 'Study Leave', days: 5, status: 'paid', amount: 5000, pay_period: '2027-01', note: null }),
  row({ employee_number: 'E2', employee_name: 'Ben Two', days: 1.5 }),
];

describe('the forfeited & paid out report', () => {
  it('says why the days went', () => {
    expect(forfeitWhy(rows[0])).toBe('Lost: over the carry-forward cap at the yearly reset');
    expect(forfeitWhy(rows[1])).toBe('Lost: carried-over days not used by their deadline');
    expect(forfeitWhy(rows[2])).toBe('Paid out: over the carry-forward cap at the yearly reset');
  });

  it('adds up days lost and paid out per employee and leave type', () => {
    const s = summariseForfeits(rows);
    expect(s.byEmployee).toEqual([
      { employee_number: 'E1', employee_name: 'Ann One', leave_type: 'Annual Leave', lost: 6, paid_out: 0 },
      { employee_number: 'E1', employee_name: 'Ann One', leave_type: 'Study Leave', lost: 0, paid_out: 5 },
      { employee_number: 'E2', employee_name: 'Ben Two', leave_type: 'Annual Leave', lost: 1.5, paid_out: 0 },
    ]);
    expect(s.lost).toBe(7.5);
    expect(s.paidOut).toBe(5);
  });

  it('exports every line to CSV', () => {
    const lines = forfeitCsv(rows).trim().split('\r\n');
    expect(lines[0]).toBe('Employee Number,Employee,Leave Type,Leave Year,Date,Days,What happened,Payout status,Amount paid,Pay period,Details');
    expect(lines[1]).toBe('E1,Ann One,Annual Leave,2027,2027-01-01,4,Lost: over the carry-forward cap at the yearly reset,,,,4 unused day(s) from 2026 were over the cap');
    expect(lines[3]).toBe('E1,Ann One,Study Leave,2027,2027-01-01,5,Paid out: over the carry-forward cap at the yearly reset,Paid,5000,2027-01,');
    expect(lines).toHaveLength(5);
  });
});
