import { describe, expect, it } from 'vitest';
import { foldIntoOther, headcountByTown, lastMonths, leaveByStatus, onLeaveToday, pendingLeave, percentChange, staffByMonth } from './dashboardStats';

const today = new Date(2026, 9, 19); // 19 October 2026

describe('dashboard stats', () => {
  it('lists the last 12 months, oldest first, across a year end', () => {
    const m = lastMonths(today);
    expect(m).toHaveLength(12);
    expect(m[0]).toBe('2025-11');
    expect(m[11]).toBe('2026-10');
  });

  it('counts staff at each month end, joiners and leavers, and leaves out leavers with no termination date', () => {
    const employees = [
      { Status: 'Active', 'Start Date': '2020-01-01' },
      { Status: 'Active', 'Start Date': '2026-10-05' },
      { Status: 'Active', 'Start Date': '' }, // no start date: counted from the start
      { Status: 'Terminated', 'Start Date': '2019-03-01', 'Termination Date': '2026-08-31' },
      { Status: 'Terminated', 'Start Date': '2019-03-01' }, // when they left is unknown
    ];
    const points = staffByMonth(employees, today);
    const aug = points.find((p) => p.month === '2026-08')!;
    const sep = points.find((p) => p.month === '2026-09')!;
    const oct = points.find((p) => p.month === '2026-10')!;
    expect(aug.headcount).toBe(2);
    expect(aug.leavers).toBe(1);
    expect(sep.headcount).toBe(2);
    expect(oct).toMatchObject({ headcount: 3, joiners: 1, leavers: 0, label: 'Oct' });
  });

  it('counts different people on approved leave today, ends included', () => {
    const leaves = [
      { 'Employee Number': 'E1', status: 'Approved', 'Start Date': '2026-10-15', 'End Date': '2026-10-19' },
      { 'Employee Number': 'E1', status: 'approved', 'Start Date': '2026-10-19', 'End Date': '2026-10-20' },
      { 'Employee Number': 'E2', status: 'Approved', 'Start Date': '2026-10-19' }, // one day, no end date
      { 'Employee Number': 'E3', status: 'Pending', 'Start Date': '2026-10-18', 'End Date': '2026-10-21' },
      { 'Employee Number': 'E4', status: 'Approved', 'Start Date': '2026-10-20', 'End Date': '2026-10-21' },
    ];
    expect(onLeaveToday(leaves, today)).toBe(2);
    expect(pendingLeave([...leaves, { status: null }])).toBe(2);
  });

  it('breaks leave down by status, biggest first, a missing status as Pending', () => {
    expect(leaveByStatus([{ status: 'approved' }, { status: 'APPROVED' }, { status: null }, { status: 'Rejected' }])).toEqual([
      { name: 'Approved', value: 2 },
      { name: 'Pending', value: 1 },
      { name: 'Rejected', value: 1 },
    ]);
  });

  it('counts current staff by town and folds the tail into Other', () => {
    const rows = headcountByTown([
      { Town: 'Nairobi' }, { Town: 'Nairobi' }, { Town: 'Kisumu' }, { Town: '' }, { Town: 'Mombasa', Status: 'Terminated' },
    ]);
    expect(rows).toEqual([{ name: 'Nairobi', value: 2 }, { name: 'Kisumu', value: 1 }, { name: 'Unassigned', value: 1 }]);
    const many = Array.from({ length: 10 }, (_, i) => ({ name: `T${i}`, value: 10 - i }));
    const folded = foldIntoOther(many, 7);
    expect(folded).toHaveLength(8);
    expect(folded[7]).toEqual({ name: 'Other (3)', value: 3 + 2 + 1 });
    expect(foldIntoOther(many.slice(0, 8), 7)).toHaveLength(8); // one extra row is shown, not folded
  });

  it('works out a change only when there is something to compare with', () => {
    expect(percentChange(110, 100)).toBe(10);
    expect(percentChange(90, 100)).toBe(-10);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(5, null)).toBeNull();
  });
});
