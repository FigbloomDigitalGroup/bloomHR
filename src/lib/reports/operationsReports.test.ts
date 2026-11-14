import { describe, expect, it } from 'vitest';
import {
  type BranchInput,
  NO_BRANCH,
  addCurrencies,
  branchOf,
  branchPerformance,
  branchSheet,
  branchTotals,
  filterSms,
  leaveDaysInMonth,
  payrollLabel,
  shortMessage,
  smsByDay,
  smsByType,
  smsDay,
  smsFailures,
  smsOptions,
  smsOutcome,
  smsRecent,
  smsSheet,
  smsSummary,
  smsTypeLabel,
} from './operationsReports';

// noon UTC, so the local day is the same day in any time zone from UTC-11 to UTC+11
const at = (day: string, hour = 12) => `${day}T${String(hour).padStart(2, '0')}:00:00Z`;

const LOGS = [
  { id: '1', created_at: at('2026-11-02'), status: 'sent', sms_type: 'birthday', cost: 0.8, recipient_phone: '254700000001', message: 'Happy birthday' },
  { id: '2', created_at: at('2026-11-02', 13), status: 'failed', sms_type: 'birthday', cost: null, error_message: 'Invalid number', recipient_phone: '254700000002' },
  { id: '3', created_at: at('2026-11-03'), status: 'delivered', sms_type: null, cost: 0.8, recipient_phone: '254700000003' },
  { id: '4', created_at: at('2026-11-04'), status: null, sms_type: 'payslip_notice', cost: null, error_message: 'Timeout' },
  { id: '5', created_at: at('2026-11-04', 11), status: 'queued', sms_type: 'payslip_notice' },
];

describe('SMS outcome', () => {
  it('reads sent and delivered as taken, failure words as failed, queue words as waiting', () => {
    expect(smsOutcome({ status: 'sent' })).toBe('delivered');
    expect(smsOutcome({ status: 'Delivered' })).toBe('delivered');
    expect(smsOutcome({ status: 'FAILED' })).toBe('failed');
    expect(smsOutcome({ status: 'rejected' })).toBe('failed');
    expect(smsOutcome({ status: 'queued' })).toBe('pending');
  });

  it('treats no status as sent (the default), unless there is an error', () => {
    expect(smsOutcome({ status: null })).toBe('delivered');
    expect(smsOutcome({ status: '', error_message: 'Timeout' })).toBe('failed');
  });
});

describe('SMS grouping', () => {
  it('sums the period', () => {
    expect(smsSummary(LOGS)).toEqual({ total: 5, delivered: 2, failed: 2, pending: 1, failedShare: 40, cost: 1.6 });
  });

  it('has no cost when no message has one', () => {
    expect(smsSummary([{ status: 'sent' }]).cost).toBeNull();
    expect(smsSummary([]).failedShare).toBeNull();
  });

  it('groups by day, oldest first', () => {
    expect(smsByDay(LOGS)).toEqual([
      { day: '2026-11-02', sent: 2, failed: 1 },
      { day: '2026-11-03', sent: 1, failed: 0 },
      { day: '2026-11-04', sent: 2, failed: 1 },
    ]);
  });

  it('groups by type, the most used first, with "General" for no type', () => {
    expect(smsByType(LOGS)).toEqual([
      { type: 'Birthday', count: 2, failed: 1, cost: 0.8 },
      { type: 'Payslip notice', count: 2, failed: 1, cost: null },
      { type: 'General', count: 1, failed: 0, cost: 0.8 },
    ]);
  });

  it('lists failures and recent messages newest first', () => {
    expect(smsFailures(LOGS).map((l) => l.id)).toEqual(['4', '2']);
    expect(smsRecent(LOGS, 2).map((l) => l.id)).toEqual(['4', '5']);
  });

  it('filters by status and type labels', () => {
    expect(smsOptions(LOGS)).toEqual({ statuses: ['Delivered', 'Failed', 'Queued', 'Sent'], types: ['Birthday', 'General', 'Payslip notice'] });
    expect(filterSms(LOGS, { status: 'Sent' }).map((l) => l.id)).toEqual(['1', '4']);
    expect(filterSms(LOGS, { type: 'Birthday', status: 'Failed' }).map((l) => l.id)).toEqual(['2']);
  });

  it('labels, days and cuts', () => {
    expect(smsTypeLabel('BULK_message')).toBe('Bulk message');
    expect(smsDay('not a date')).toBe('');
    expect(shortMessage('a'.repeat(100), 80)).toHaveLength(80);
    expect(shortMessage('short')).toBe('short');
  });

  it('makes a sheet row per message', () => {
    const rows = smsSheet(LOGS);
    expect(rows).toHaveLength(5);
    expect(rows[0][1]).toBe(''); // message 4 has no recipient
    expect(rows.find((r) => r[1] === '254700000001')?.[8]).toBe(0.8);
  });
});

const BRANCHES = [
  { id: 'nbo', name: 'Nairobi', active: true, is_default: true },
  { id: 'msa', name: 'Mombasa', active: true, is_default: false },
  { id: 'old', name: 'Closed', active: false, is_default: false },
];

describe('branch assignment', () => {
  it('uses the own branch, else the default, else no branch', () => {
    expect(branchOf({ branch_id: 'msa' }, BRANCHES)).toBe('msa');
    expect(branchOf({ branch_id: null }, BRANCHES)).toBe('nbo');
    expect(branchOf({ branch_id: 'gone' }, BRANCHES)).toBe('nbo');
    expect(branchOf(undefined, BRANCHES)).toBe('nbo');
    expect(branchOf({ branch_id: null }, BRANCHES.filter((b) => !b.is_default))).toBe(NO_BRANCH);
  });
});

describe('leave proration', () => {
  it('counts a leave inside the month whole', () => {
    expect(leaveDaysInMonth('2026-11-03', '2026-11-07', 5, '2026-11')).toBe(5);
  });

  it('shares days by the calendar days in the month, to the half day', () => {
    // 10 calendar days, 6 in November, 8 leave days: 4.8 -> 5
    expect(leaveDaysInMonth('2026-10-28', '2026-11-06', 8, '2026-11')).toBe(5);
    // 7 of 10 days, 9 leave days: 6.3 -> 6.5
    expect(leaveDaysInMonth('2026-10-29', '2026-11-07', 9, '2026-11')).toBe(6.5);
    expect(leaveDaysInMonth('2026-10-01', '2026-10-05', 5, '2026-11')).toBe(0);
  });

  it('falls back to the start date and the calendar days', () => {
    expect(leaveDaysInMonth('2026-11-10', null, 1, '2026-11')).toBe(1);
    expect(leaveDaysInMonth('2026-11-10', '2026-11-12', null, '2026-11')).toBe(3);
    expect(leaveDaysInMonth('', '2026-11-12', 2, '2026-11')).toBe(0);
  });
});

const EMPLOYEES = [
  { 'Employee Number': 'E1', branch_id: 'nbo', 'Start Date': '2024-01-01', worker_kind: 'employee' },
  { 'Employee Number': 'E2', branch_id: 'msa', 'Start Date': '2026-11-10', worker_kind: 'employee' },
  { 'Employee Number': 'E3', branch_id: 'msa', 'Start Date': '2025-05-01', worker_kind: 'casual' },
  { 'Employee Number': 'E4', branch_id: null, 'Start Date': '2023-01-01' },
  { 'Employee Number': 'E5', branch_id: 'old', 'Start Date': '2020-01-01', 'Termination Date': '2025-01-31' },
  { 'Employee Number': 'E6', branch_id: 'nbo', 'Start Date': '2020-01-01', 'Termination Date': '2026-11-15' },
];

const input = (over: Partial<BranchInput> = {}): BranchInput => ({
  month: '2026-11',
  branches: BRANCHES,
  employees: EMPLOYEES,
  exits: [
    { employee_number: 'E6', last_working_day: '2026-11-15', status: 'completed' },
    { employee_number: 'E1', last_working_day: '2026-11-30', status: 'declined' },
    { employee_number: 'E2', last_working_day: '2026-12-31', status: 'approved' },
  ],
  attendance: [
    { employeeNumber: 'E1', status: 'present', counted: true },
    { employeeNumber: 'E1', status: 'late', counted: true },
    { employeeNumber: 'E1', status: 'absent', counted: true },
    { employeeNumber: 'E1', status: 'off', counted: true },
    { employeeNumber: 'E2', status: 'present', counted: true },
  ],
  leaves: [
    { 'Employee Number': 'E1', 'Start Date': '2026-11-03', 'End Date': '2026-11-04', days: 2, status: 'Approved' },
    { 'Employee Number': 'E4', 'Start Date': '2026-10-28', 'End Date': '2026-11-06', days: 8, status: 'APPROVED' },
    { 'Employee Number': 'E2', 'Start Date': '2026-11-20', 'End Date': '2026-11-21', days: 2, status: 'pending' },
  ],
  overtime: [
    { employee_number: 'E1', work_date: '2026-11-05', hours: 2.5, status: 'approved' },
    { employee_number: 'E1', work_date: '2026-11-06', hours: 1.25, status: 'approved' },
    { employee_number: 'E2', work_date: '2026-11-06', hours: 3, status: 'submitted' },
    { employee_number: 'E2', work_date: '2026-10-30', hours: 3, status: 'approved' },
  ],
  payslips: [
    { employee_id: 'E1', gross_pay: 100000, currency: 'KES' },
    { employee_id: 'E6', gross_pay: 50000.5, currency: 'KES' },
    { employee_id: 'E2', gross_pay: 2000000, currency: 'UGX' },
    { employee_id: 'E2', gross_pay: 10000, currency: null },
  ],
  ...over,
});

describe('branch performance', () => {
  const rows = branchPerformance(input());
  const nbo = rows.find((r) => r.id === 'nbo')!;
  const msa = rows.find((r) => r.id === 'msa')!;

  it('shows active branches only, in order (a closed branch with only former staff is left out)', () => {
    expect(rows.map((r) => r.name)).toEqual(['Nairobi', 'Mombasa']);
  });

  it('counts staff, casual workers, new hires and exits; no branch goes to the default', () => {
    expect(nbo).toMatchObject({ headcount: 3, casual: 0, newHires: 0, exits: 1 });
    expect(msa).toMatchObject({ headcount: 1, casual: 1, newHires: 1, exits: 0 });
  });

  it('works out attendance and punctuality per branch', () => {
    expect(nbo.attendance).toEqual({ attended: 2, working: 3, rate: 67 });
    expect(nbo.punctuality).toEqual({ onTime: 1, arrivals: 2, share: 50 });
    expect(msa.attendance?.rate).toBe(100);
  });

  it('adds prorated approved leave and approved overtime in the month', () => {
    expect(nbo.leaveDays).toBe(7); // 2 + 5 (E4, no branch, under the default)
    expect(msa.leaveDays).toBe(0);
    expect(nbo.overtimeHours).toBe(3.75);
    expect(msa.overtimeHours).toBe(0);
  });

  it('sums payroll per currency', () => {
    expect(nbo.payroll).toEqual({ KES: 150000.5 });
    expect(msa.payroll).toEqual({ UGX: 2000000, KES: 10000 });
  });

  it('puts staff under "No branch" when there is no default branch', () => {
    const out = branchPerformance(input({ branches: BRANCHES.map((b) => ({ ...b, is_default: false })) }));
    const none = out.find((r) => r.id === NO_BRANCH)!;
    expect(none.name).toBe('No branch');
    expect(none.headcount).toBe(1);
    expect(none.leaveDays).toBe(5);
    expect(out[out.length - 1].id).toBe(NO_BRANCH);
  });

  it('shows a branch with no staff as zeros', () => {
    const out = branchPerformance(input({ employees: [], exits: [], attendance: [], leaves: [], overtime: [], payslips: [] }));
    expect(out.map((r) => r.name)).toEqual(['Nairobi', 'Mombasa']);
    expect(out[1]).toMatchObject({ headcount: 0, exits: 0, leaveDays: 0, overtimeHours: 0, payroll: {} });
    expect(out[1].attendance?.rate).toBeNull();
  });

  it('leaves attendance and payroll unknown when they could not be read', () => {
    const out = branchPerformance(input({ attendance: null, payslips: null }));
    expect(out.every((r) => r.attendance === null && r.payroll === null)).toBe(true);
    expect(payrollLabel(out[0].payroll)).toBe('—');
  });
});

describe('the totals row', () => {
  it('adds the counts and works the rates out from all days', () => {
    const rows = branchPerformance(input());
    const t = branchTotals(rows);
    expect(t).toMatchObject({ name: 'Total', headcount: 4, casual: 1, newHires: 1, exits: 1, leaveDays: 7, overtimeHours: 3.75 });
    expect(t.attendance).toEqual({ attended: 3, working: 4, rate: 75 });
    expect(t.punctuality).toEqual({ onTime: 2, arrivals: 3, share: 67 });
    expect(t.payroll).toEqual({ KES: 160000.5, UGX: 2000000 });
    const sheet = branchSheet(rows, t);
    expect(sheet).toHaveLength(3);
    expect(sheet[2].slice(0, 7)).toEqual(['Total', 4, 1, 1, 1, '75%', '67%']);
  });

  it('keeps unknowns unknown', () => {
    const t = branchTotals(branchPerformance(input({ attendance: null, payslips: null })));
    expect(t.attendance).toBeNull();
    expect(t.payroll).toBeNull();
  });

  it('adds currencies apart', () => {
    expect(addCurrencies([{ KES: 1 }, { KES: 2, UGX: 5 }])).toEqual({ KES: 3, UGX: 5 });
  });
});
