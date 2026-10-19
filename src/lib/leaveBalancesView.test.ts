import { describe, expect, it } from 'vitest';
import { BalanceRow, filterBalances, sortBalances } from './leaveBalancesView';

const row = (first: string, last: string, number: string, type: string, remaining: number, used = 0, office = 'Nairobi'): BalanceRow => ({
  employee_number: number, first_name: first, last_name: last, office,
  leave_type_id: type.toLowerCase(), leave_type_name: type, accrued_days: remaining + used, used_days: used, remaining_days: remaining,
});

const rows = [
  row('Zilpar', 'Okoth', 'MCL-000009', 'Sick Leave', 10),
  row('Joseph', 'Wachira', 'MCL-000011', 'Sick Leave', 10),
  row('joseph', 'Wachira', 'MCL-000011', 'Annual Leave', 7.5, 0.5),
  row('', '', 'MCL-000099', 'Annual Leave', 1),
  row('Ian', 'Duncan', 'MCL-000001', 'Annual Leave', 3, 5, 'Mombasa'),
];
const names = (r: BalanceRow[]) => r.map((b) => `${b.first_name || b.employee_number}:${b.leave_type_name}`);

describe('sortBalances', () => {
  it('by employee A-Z keeps each person together, their leave types A-Z, nameless last', () => {
    expect(names(sortBalances(rows, 'employee', 'asc'))).toEqual([
      'Ian:Annual Leave', 'joseph:Annual Leave', 'Joseph:Sick Leave', 'Zilpar:Sick Leave', 'MCL-000099:Annual Leave',
    ]);
  });

  it('by remaining, fewest first, ties by name', () => {
    expect(names(sortBalances(rows, 'remaining', 'asc'))).toEqual([
      'MCL-000099:Annual Leave', 'Ian:Annual Leave', 'joseph:Annual Leave', 'Joseph:Sick Leave', 'Zilpar:Sick Leave',
    ]);
    expect(names(sortBalances(rows, 'remaining', 'desc')).slice(0, 2)).toEqual(['Joseph:Sick Leave', 'Zilpar:Sick Leave']);
  });

  it('by leave type, then name', () => {
    expect(names(sortBalances(rows, 'leave_type', 'asc'))).toEqual([
      'Ian:Annual Leave', 'joseph:Annual Leave', 'MCL-000099:Annual Leave', 'Joseph:Sick Leave', 'Zilpar:Sick Leave',
    ]);
  });

  it('by employee number, and by days earned, most first', () => {
    expect(sortBalances(rows, 'number', 'asc').map((b) => b.employee_number))
      .toEqual(['MCL-000001', 'MCL-000009', 'MCL-000011', 'MCL-000011', 'MCL-000099']);
    expect(names(sortBalances(rows, 'earned', 'desc')).slice(0, 3)).toEqual(['Joseph:Sick Leave', 'Zilpar:Sick Leave', 'Ian:Annual Leave']);
  });

  it('does not change the list it is given', () => {
    const copy = [...rows];
    sortBalances(rows, 'used', 'desc');
    expect(rows).toEqual(copy);
  });
});

describe('filterBalances', () => {
  it('by name or employee number, any case, and by leave type', () => {
    expect(names(filterBalances(rows, ' wachira ', ''))).toEqual(['Joseph:Sick Leave', 'joseph:Annual Leave']);
    expect(names(filterBalances(rows, 'mcl-000001', ''))).toEqual(['Ian:Annual Leave']);
    expect(names(filterBalances(rows, 'joseph', 'annual leave'))).toEqual(['joseph:Annual Leave']);
    expect(filterBalances(rows, '', '')).toHaveLength(5);
  });
});
