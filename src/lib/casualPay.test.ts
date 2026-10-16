import { describe, expect, it } from 'vitest';
import {
  addDays, casualBankFile, casualMpesaFile, casualRowsFromSheet, dayAmount, dayTotals, daysFromSheet, isCasual, limitStatus,
  lineNet, onBooks, portionFrom, runReference, runTotal, weekDays, weekStart, type CasualPayLine,
} from './casualPay';
import { BANK_HEADERS, MPESA_HEADERS } from './payrollExports';
import { isPayrollReady } from './onboardingValidation';

const line = (patch: Partial<CasualPayLine>): CasualPayLine => ({
  id: 'l', run_id: 'r', employee_number: 'MCL-000001', worker_name: 'Wanjiku Mwangi', full_days: 0, half_days: 0, daily_rate: 800,
  days_amount: 0, additions: 0, deductions: 0, adjustment_note: null, net_pay: 0, payment_method: 'M-Pesa', phone: '0712345678',
  bank: null, bank_branch: null, bank_code: null, branch_code: null, account_name: null, account_number: null, payroll_number: 'PR-00009',
  ...patch,
});

describe('what days pay', () => {
  it('a full day is the rate, a half day half of it to the cent, absent nothing', () => {
    expect(dayAmount('full', 800)).toBe(800);
    expect(dayAmount('half', '755')).toBe(377.5);
    expect(dayAmount('half', 333.33)).toBe(166.67);
    expect(dayAmount('absent', 800)).toBe(0);
  });

  it('adds up a week, each day at its own rate', () => {
    expect(dayTotals([
      { portion: 'full', daily_rate: 800 }, { portion: 'half', daily_rate: 800 }, { portion: 'absent', daily_rate: 800 },
      { portion: 'full', daily_rate: '900' },
    ])).toEqual({ full: 2, half: 1, absent: 1, amount: 2100 });
  });

  it('a line is days plus additions less deductions, never below nothing; a run adds the lines', () => {
    expect(lineNet({ days_amount: 2000, additions: 500, deductions: 100 })).toBe(2400);
    expect(lineNet({ days_amount: '100', additions: '0', deductions: '500' })).toBe(0);
    expect(runTotal([{ days_amount: 2000, additions: 500, deductions: 100 }, { days_amount: 600, additions: 0, deductions: 0 }])).toBe(3000);
  });
});

describe('dates', () => {
  it('weeks start on Monday', () => {
    expect(weekStart('2026-10-16')).toBe('2026-10-12'); // a Friday
    expect(weekStart('2026-10-18')).toBe('2026-10-12'); // a Sunday
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
    expect(weekDays('2026-10-12')).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('a casual is on the books from their start to their last day', () => {
    const c = { start_date: '2026-10-05', finished_on: '2026-10-20' };
    expect(onBooks(c, '2026-10-04')).toBe(false);
    expect(onBooks(c, '2026-10-05')).toBe(true);
    expect(onBooks(c, '2026-10-20')).toBe(true);
    expect(onBooks(c, '2026-10-21')).toBe(false);
    expect(onBooks({ start_date: null, finished_on: null }, '2026-01-01')).toBe(true);
  });
});

describe('days in a row (Employment Act s.37)', () => {
  it('is over past the limit, near within 5 days of it', () => {
    expect(limitStatus(31, 30)).toBe('over');
    expect(limitStatus(30, 30)).toBe('near');
    expect(limitStatus(26, 30)).toBe('near');
    expect(limitStatus(25, 30)).toBe('ok');
  });
});

describe('casuals and the monthly payroll', () => {
  it('a casual is never payroll-ready, even approved', () => {
    expect(isCasual({ worker_kind: 'casual' })).toBe(true);
    expect(isCasual({ worker_kind: 'employee' })).toBe(false);
    expect(isPayrollReady({ onboarding_status: 'approved', worker_kind: 'casual' })).toBe(false);
    expect(isPayrollReady({ onboarding_status: 'approved', worker_kind: 'employee' })).toBe(true);
  });
});

describe('spreadsheets', () => {
  it('reads a casuals sheet, whatever the header case; bank when an account is given; empty rows dropped', () => {
    expect(casualRowsFromSheet([
      { 'first name': 'Wanjiku', 'Last Name': 'Mwangi', Phone: '0712345678', 'Daily Rate': 800, 'Start Date': '2026-10-01' },
      { 'First Name': 'Kamau', 'Last Name': 'Njoroge', 'Daily Rate': '600', Bank: 'KCB', 'Account Number': '1100223344' },
      { 'First Name': '', 'Last Name': '' },
    ])).toEqual([
      expect.objectContaining({ first_name: 'Wanjiku', last_name: 'Mwangi', phone: '0712345678', daily_rate: '800', payment_method: 'M-Pesa' }),
      expect.objectContaining({ first_name: 'Kamau', payment_method: 'Bank Transfer', bank: 'KCB', account_number: '1100223344' }),
    ]);
  });

  it('reads Full / Half / Absent however it is written', () => {
    expect(['F', 'full day', '1'].map(portionFrom)).toEqual(['full', 'full', 'full']);
    expect(['H', 'Half', '0.5'].map(portionFrom)).toEqual(['half', 'half', 'half']);
    expect(['A', 'absent', '0'].map(portionFrom)).toEqual(['absent', 'absent', 'absent']);
    expect(portionFrom('maybe')).toBeNull();
  });

  it('matches days to casuals by employee number or ID number and reports each bad row', () => {
    const casuals = [{ employee_number: 'MCL-000001', id_number: '23456789' }];
    const { days, problems } = daysFromSheet([
      { 'Employee Number': 'mcl-000001', Date: '2026-10-12', Day: 'Full' },
      { 'ID Number': '23456789', Date: '2026-10-13', Day: 'H' },
      { 'Employee Number': 'MCL-999999', Date: '2026-10-13', Day: 'F' },
      { 'Employee Number': 'MCL-000001', Date: '13/10/2026', Day: 'F' },
      { 'Employee Number': 'MCL-000001', Date: '2026-10-14', Day: '?' },
      {},
    ], casuals);
    expect(days).toEqual([
      { employee_number: 'MCL-000001', work_date: '2026-10-12', portion: 'full' },
      { employee_number: 'MCL-000001', work_date: '2026-10-13', portion: 'half' },
    ]);
    expect(problems).toEqual([
      { row: 4, problem: 'No casual worker MCL-999999' },
      { row: 5, problem: 'The date "13/10/2026" should look like 2026-10-16' },
      { row: 6, problem: 'Say Full, Half or Absent' },
    ]);
  });
});

describe('payout files', () => {
  const run = { period_start: '2026-10-12', period_end: '2026-10-18' };
  const lines = [
    line({ days_amount: 2000, additions: 500, deductions: 100 }),
    line({ employee_number: 'MCL-000002', worker_name: 'No Phone', phone: '12', days_amount: 800 }),
    line({ employee_number: 'MCL-000003', worker_name: 'Nothing Due', days_amount: 0 }),
    line({ employee_number: 'MCL-000004', worker_name: 'Kamau Njoroge', payment_method: 'Bank Transfer', bank: 'KCB', bank_code: '01',
      bank_branch: 'Thika', branch_code: '123', account_number: '1100223344', days_amount: 600, payroll_number: 'PR-00010' }),
  ];

  it('M-Pesa: the monthly payroll columns, with 2547 numbers and a casual pay reference; nobody owed nothing', () => {
    const f = casualMpesaFile(lines, run);
    expect(f.headers).toBe(MPESA_HEADERS);
    expect(f.rows).toEqual([
      ['254712345678', 'Wanjiku Mwangi', '2400.00', 'Casual pay 2026-10-12 to 2026-10-18', 'PR-00009'],
      ['', 'No Phone', '800.00', 'Casual pay 2026-10-12 to 2026-10-18', 'PR-00009'],
    ]);
    expect(f.problems).toEqual([{ name: 'No Phone', employeeNumber: 'MCL-000002', missing: ['M-Pesa number'] }]);
  });

  it('bank: the monthly payroll columns; the name stands in for a missing account name', () => {
    const f = casualBankFile(lines, run);
    expect(f.headers).toBe(BANK_HEADERS);
    expect(f.rows).toEqual([
      ['PR-00010', 'Kamau Njoroge', 'KCB', '01', 'Thika', '123', 'Kamau Njoroge', '1100223344', '600.00', 'Casual pay 2026-10-12 to 2026-10-18'],
    ]);
    expect(f.problems).toEqual([]);
    expect(casualBankFile([line({ payment_method: 'Bank Transfer', days_amount: 5 })], run).problems[0].missing).toEqual(['Bank', 'Account number']);
  });

  it('a one-day run says the day', () => {
    expect(runReference({ period_start: '2026-10-16', period_end: '2026-10-16' })).toBe('Casual pay 2026-10-16');
  });
});
