import { describe, expect, it } from 'vitest';
import { byNumber } from './reportKit';
import {
  addDays,
  annualBalances,
  annualLeaveType,
  averageHeadcount,
  daysTaken,
  exitRecords,
  exitSummary,
  exitsByMonth,
  exitsByReason,
  exitsInPeriod,
  isExit,
  isOpenExit,
  leaveByDepartment,
  leaveByType,
  leaveInRange,
  leaveStatus,
  leaveSummary,
  olderExitRecords,
  onLeaveBetween,
  overlaps,
  periodBounds,
  turnoverRate,
} from './peopleReports';

const EMPLOYEES = [
  { 'Employee Number': 'E1', 'First Name': 'Amina', 'Last Name': 'Otieno', branch_id: 'b1', department_id: 'd1', 'Start Date': '2020-01-01' },
  { 'Employee Number': 'E2', 'First Name': 'Brian', 'Last Name': 'Kamau', branch_id: 'b1', department_id: 'd2', 'Start Date': '2026-03-10' },
  { 'Employee Number': 'E3', 'First Name': 'Chen', 'Last Name': 'Li', branch_id: 'b2', department_id: 'd1', 'Start Date': '2019-05-01', 'Termination Date': '2026-04-15' },
  { 'Employee Number': 'C1', 'First Name': 'Casual', 'Last Name': 'One', branch_id: 'b1', department_id: 'd1', 'Start Date': '2020-01-01', worker_kind: 'casual' },
];
const PEOPLE = byNumber(EMPLOYEES);
const DEPTS = new Map([
  ['d1', 'Sales'],
  ['d2', 'Finance'],
]);

const leave = (n: string, type: string, start: string, end: string, days: number, status: string) => ({
  'Employee Number': n,
  name: n,
  'Leave Type': type,
  'Start Date': start,
  'End Date': end,
  days,
  status,
});

const APPS = [
  leave('E1', 'Annual', '2026-01-28', '2026-02-03', 5, 'Approved'),
  leave('E1', 'Sick', '2026-03-02', '2026-03-03', 2, 'APPROVED'),
  leave('E2', 'Annual', '2026-03-16', '2026-03-20', 5, 'pending'),
  leave('E3', 'Annual', '2026-04-01', '2026-04-02', 2, 'Rejected'),
  leave('E2', 'Annual', '2025-12-20', '2025-12-31', 8, 'Approved'),
  leave('E1', 'Annual', '2026-11-13', '2026-11-18', 4, 'Approved'),
  leave('E2', 'Sick', '2026-11-20', '2026-11-21', 2, 'Approved'),
  leave('E3', 'Annual', '2026-11-14', '2026-11-14', 1, 'Cancelled'),
];

describe('dates', () => {
  it('overlaps periods at their edges and treats a missing end as one day', () => {
    expect(overlaps('2026-01-28', '2026-02-03', '2026-02-01', '2026-02-28')).toBe(true);
    expect(overlaps('2026-01-01', '2026-01-31', '2026-02-01', '2026-02-28')).toBe(false);
    expect(overlaps('2026-02-28', '', '2026-02-01', '2026-02-28')).toBe(true);
    expect(overlaps('', '2026-02-10', '2026-02-01', '2026-02-28')).toBe(false);
    expect(overlaps('2026-02-28T00:00:00', '2026-03-02', '2026-02-01', '2026-02-28')).toBe(true);
  });
  it('gives period bounds and adds days across months', () => {
    expect(periodBounds('2026-01', '2026-02')).toEqual(['2026-01-01', '2026-02-28']);
    expect(addDays('2026-11-25', 14)).toBe('2026-12-09');
  });
});

describe('leave', () => {
  it('reads statuses whatever their casing', () => {
    expect(leaveStatus('Approved')).toBe('approved');
    expect(leaveStatus(' APPROVED ')).toBe('approved');
    expect(leaveStatus('pending')).toBe('pending');
    expect(leaveStatus(null)).toBe('pending');
    expect(leaveStatus('Rejected')).toBe('rejected');
    expect(leaveStatus('canceled')).toBe('cancelled');
  });

  it('keeps requests overlapping the period and counts approved days only', () => {
    const [first, last] = periodBounds('2026-01', '2026-04');
    const inPeriod = leaveInRange(APPS, first, last, PEOPLE);
    expect(inPeriod).toHaveLength(4);
    expect(daysTaken(inPeriod)).toBe(7);
  });

  it('filters by branch, department and search (request name too)', () => {
    const [first, last] = periodBounds('2026-01', '2026-04');
    expect(leaveInRange(APPS, first, last, PEOPLE, { branchId: 'b2' }).map((a) => a['Employee Number'])).toEqual(['E3']);
    expect(leaveInRange(APPS, first, last, PEOPLE, { departmentId: 'd2' }).map((a) => a['Employee Number'])).toEqual(['E2']);
    expect(leaveInRange(APPS, first, last, PEOPLE, { search: 'amina' })).toHaveLength(2);
    const ghost = [leave('X9', 'Annual', '2026-02-01', '2026-02-02', 2, 'Approved')];
    expect(leaveInRange(ghost, first, last, PEOPLE, { search: 'x9' })).toHaveLength(1);
    expect(leaveInRange(ghost, first, last, PEOPLE, { branchId: 'b1' })).toHaveLength(0);
  });

  it('summarises the period and who is on leave today', () => {
    const [first, last] = periodBounds('2026-01', '2026-11');
    const inPeriod = leaveInRange(APPS, first, last, PEOPLE);
    expect(leaveSummary(inPeriod, APPS, '2026-11-14')).toEqual({ requests: 7, approvedDays: 13, pending: 1, onLeaveToday: 1 });
    expect(onLeaveBetween(APPS, '2026-11-14', addDays('2026-11-14', 14)).map((a) => a['Employee Number'])).toEqual(['E1', 'E2']);
  });

  it('groups by leave type and department', () => {
    const [first, last] = periodBounds('2026-01', '2026-04');
    const inPeriod = leaveInRange(APPS, first, last, PEOPLE);
    expect(leaveByType(inPeriod)).toEqual([
      { type: 'Annual', requests: 3, approved: 1, pending: 1, rejected: 1, daysTaken: 5 },
      { type: 'Sick', requests: 1, approved: 1, pending: 0, rejected: 0, daysTaken: 2 },
    ]);
    expect(leaveByDepartment(APPS, PEOPLE, DEPTS)).toEqual([
      { department: 'Sales', people: 1, daysTaken: 11 },
      { department: 'Finance', people: 1, daysTaken: 10 },
    ]);
  });

  it('picks the annual type and its yearly balance row', () => {
    const types = [
      { id: 't1', name: 'Sick', is_deductible: false },
      { id: 't2', name: 'Annual leave', is_deductible: true },
    ];
    expect(annualLeaveType(types)?.id).toBe('t2');
    const balances = [
      { employee_number: 'E1', leave_type_id: 't2', year: 2026, month: 3, accrued_days: 5, used_days: 1, carried_over_days: 0, remaining_days: 4 },
      { employee_number: 'E1', leave_type_id: 't2', year: 2026, month: 0, accrued_days: 21, used_days: 7, carried_over_days: 2, remaining_days: 16 },
      { employee_number: 'E2', leave_type_id: 't2', year: 2026, month: 2, accrued_days: 3, used_days: 0, carried_over_days: 0 },
      { employee_number: 'E2', leave_type_id: 't2', year: 2026, month: 5, accrued_days: 8, used_days: 1, carried_over_days: 0 },
      { employee_number: 'E3', leave_type_id: 't2', year: 2025, month: 0, accrued_days: 21, used_days: 0, carried_over_days: 0 },
      { employee_number: 'E3', leave_type_id: 't1', year: 2026, month: 0, accrued_days: 10, used_days: 0, carried_over_days: 0 },
    ];
    expect(annualBalances(balances, 't2', 2026, PEOPLE)).toEqual([
      { employeeNumber: 'E1', accrued: 21, used: 7, carried: 2, remaining: 16 },
      { employeeNumber: 'E2', accrued: 8, used: 1, carried: 0, remaining: 7 },
    ]);
    expect(annualBalances(balances, 't2', 2026, PEOPLE, { departmentId: 'd2' }).map((b) => b.employeeNumber)).toEqual(['E2']);
    expect(annualBalances(balances, undefined, 2026, PEOPLE)).toEqual([]);
  });
});

describe('terminations', () => {
  const EXITS = [
    { id: 'x1', employee_number: 'E3', kind: 'resignation', reason_category: null, notice_given_on: '2026-03-15', notice_days: 30, last_working_day: '2026-04-15', status: 'completed' },
    { id: 'x2', employee_number: 'E2', kind: 'termination', reason_category: 'misconduct', notice_given_on: '2026-10-01', notice_days: 0, last_working_day: '2026-10-01', status: 'clearance' },
    { id: 'x3', employee_number: 'E1', kind: 'resignation', reason_category: 'resignation', notice_given_on: '2026-09-01', notice_days: 30, last_working_day: '2026-10-01', status: 'declined' },
    { id: 'x4', employee_number: 'E1', kind: 'termination', reason_category: 'redundancy', notice_given_on: '2026-11-01', notice_days: 30, last_working_day: '2026-12-01', status: 'approved' },
  ];
  const CLEARANCE = [
    { exit_id: 'x2', done: true },
    { exit_id: 'x2', done: false },
    { exit_id: 'x2', done: true },
  ];
  const DUES = [{ exit_id: 'x1', net: '12500.50', status: 'included' }];
  const records = exitRecords(EXITS, CLEARANCE, DUES);

  it('joins clearance progress and final dues', () => {
    const x2 = records.find((r) => r.id === 'x2')!;
    expect([x2.clearanceDone, x2.clearanceTotal, x2.duesNet]).toEqual([2, 3, null]);
    const x1 = records.find((r) => r.id === 'x1')!;
    expect([x1.duesNet, x1.duesStatus, x1.reasonCategory]).toEqual([12500.5, 'included', 'resignation']);
  });

  it('turns older terminations into completed exits, skipping people with a newer one', () => {
    const older = olderExitRecords(
      [
        { id: 1, 'Employee Number': 'E3', termination_date: '2026-04-15', termination_type: 'Voluntary' },
        { id: 2, 'Employee Number': 'E9', termination_date: '2026-02-10', termination_type: 'Contract End', clearance_status: 'Completed' },
        { id: 3, 'Employee Number': 'E8', termination_date: '2026-02-11', termination_type: 'Dismissal', is_archived: true },
      ],
      records,
    );
    expect(older).toHaveLength(1);
    expect(older[0]).toMatchObject({ employeeNumber: 'E9', kind: 'termination', reasonCategory: 'contract_end', status: 'completed', older: true, clearanceDone: 1 });
  });

  it('knows real and open exits', () => {
    expect(records.filter(isExit).map((r) => r.id)).toEqual(['x1', 'x2', 'x4']);
    expect(records.filter(isOpenExit).map((r) => r.id)).toEqual(['x2', 'x4']);
  });

  it('places exits in the period by last working day and filters them', () => {
    expect(exitsInPeriod(records, '2026-01', '2026-11', PEOPLE).map((r) => r.id)).toEqual(['x2', 'x3', 'x1']);
    expect(exitsInPeriod(records, '2026-01', '2026-11', PEOPLE, { branchId: 'b2' }).map((r) => r.id)).toEqual(['x1']);
  });

  it('groups by month and reason, leaving out declined exits', () => {
    const inPeriod = exitsInPeriod(records, '2026-03', '2026-10', PEOPLE);
    const months = exitsByMonth(inPeriod, '2026-03', '2026-10');
    expect(months).toHaveLength(8);
    expect(months.find((m) => m.month === '2026-04')).toEqual({ month: '2026-04', resignations: 1, terminations: 0, total: 1 });
    expect(months.find((m) => m.month === '2026-10')).toEqual({ month: '2026-10', resignations: 0, terminations: 1, total: 1 });
    expect(exitsByReason(inPeriod)).toEqual([
      { category: 'misconduct', label: 'Misconduct', count: 1, share: 50 },
      { category: 'resignation', label: 'Resigned', count: 1, share: 50 },
    ]);
  });

  it('works out average headcount (no casuals) and turnover', () => {
    // March: E1, E2, E3 on staff; November: E1, E2
    expect(averageHeadcount(EMPLOYEES, '2026-03', '2026-11')).toEqual({ start: 3, end: 2, average: 2.5 });
    expect(averageHeadcount(EMPLOYEES, '2026-03', '2026-11', { branchId: 'b2' })).toEqual({ start: 1, end: 0, average: 0.5 });
    expect(turnoverRate(1, 2.5)).toBe(40);
    expect(turnoverRate(1, 3)).toBe(33.3);
    expect(turnoverRate(1, 0)).toBeNull();
  });

  it('summarises exits, counting open ones whatever their last day', () => {
    const inPeriod = exitsInPeriod(records, '2026-03', '2026-11', PEOPLE);
    expect(exitSummary(inPeriod, records, { average: 2.5 })).toEqual({ exits: 2, resignations: 1, terminations: 1, open: 2, turnover: 80 });
  });
});
