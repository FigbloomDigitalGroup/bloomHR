import { describe, expect, it } from 'vitest';
import {
  ADVANCE,
  WELFARE,
  byDeduction,
  byEmployee,
  currencyEntries,
  deductionEntries,
  deductionSheet,
  deductionSummary,
  defaultMonth,
  defaultRange,
  filterPayslips,
  latestPeriod,
  monthTrend,
  payslipDeductions,
  runStatus,
  salaryLines,
  salarySheet,
  salarySummary,
  salaryTotals,
  standingDeductions,
} from './payrollReports';

const DEPARTMENTS = [
  { id: 'd-ops', name: 'Operations' },
  { id: 'd-fin', name: 'Finance' },
];

const EMPLOYEES = [
  { 'Employee Number': 'E1', 'First Name': 'Amina', 'Last Name': 'Otieno', branch_id: 'b-nbo', department_id: 'd-ops', 'Job Group': 'B' },
  { 'Employee Number': 'E2', 'First Name': 'Brian', 'Last Name': 'Kamau', branch_id: 'b-mba', department_id: 'd-fin', 'Job Group': 'C' },
  { 'Employee Number': 'U1', 'First Name': 'Grace', 'Last Name': 'Nakato', branch_id: 'b-kla', department_id: 'd-ops', 'Job Group': 'A' },
];

const slip = (over: Record<string, unknown>) => ({
  pay_period: '2026-10',
  currency: 'KES',
  basic_salary: 0,
  house_allowance: 0,
  transport_allowance: 0,
  medical_allowance: 0,
  other_allowances: 0,
  overtime_pay: 0,
  work_pay: 0,
  jobs_pay: 0,
  gross_pay: 0,
  paye_tax: 0,
  nhif_deduction: 0,
  nssf_deduction: 0,
  housing_levy: 0,
  loan_deduction: 0,
  advance_deduction: 0,
  welfare_deduction: 0,
  other_deductions: 0,
  deduction_items: [],
  net_pay: 0,
  ...over,
});

const PAYSLIPS = [
  slip({
    employee_id: 'E2',
    employee_name: 'Brian Kamau',
    basic_salary: 50000,
    house_allowance: 5000,
    transport_allowance: 2000,
    medical_allowance: 1000,
    other_allowances: 500,
    overtime_pay: 1500,
    work_pay: 300,
    jobs_pay: 200,
    gross_pay: 60500,
    paye_tax: 9000,
    nhif_deduction: 1663.75,
    nssf_deduction: 2160,
    housing_levy: 907.5,
    loan_deduction: 3000,
    advance_deduction: 2000,
    welfare_deduction: 200,
    other_deductions: 1000,
    deduction_items: [
      { name: 'Loan repayment: Emergency', amount: 3000, loan_id: 'L1' },
      { name: 'SACCO', amount: 1000 },
    ],
    net_pay: 40568.75,
    payment_method: 'Bank',
  }),
  slip({ employee_id: 'E1', employee_name: 'Amina Otieno', basic_salary: 30000, gross_pay: 30000, paye_tax: 2000, nssf_deduction: 1800, net_pay: 26200, deduction_items: [{ name: 'SACCO', amount: 500 }], other_deductions: 500 }),
  slip({ employee_id: 'U1', employee_name: 'Grace Nakato', currency: 'UGX', basic_salary: 1000000, gross_pay: 1000000, paye_tax: 100000, net_pay: 900000, advance_deduction: 50000 }),
];

describe('months', () => {
  it('finds the latest pay period, ignoring bad values', () => {
    expect(latestPeriod(['2026-09', '2026-10', null, 'junk', '2026-13'])).toBe('2026-10');
    expect(latestPeriod([])).toBeNull();
  });

  it('opens on the latest month with payslips, else last month', () => {
    expect(defaultMonth('2026-10', new Date(2026, 10, 14))).toBe('2026-10');
    expect(defaultMonth(null, new Date(2026, 10, 14))).toBe('2026-10');
    expect(defaultMonth(null, new Date(2026, 0, 5))).toBe('2025-12');
  });

  it('opens the deductions report on the three months up to the latest', () => {
    expect(defaultRange('2026-02', new Date(2026, 10, 14))).toEqual({ from: '2025-12', to: '2026-02' });
    expect(defaultRange(null, new Date(2026, 10, 14))).toEqual({ from: '2026-08', to: '2026-10' });
  });
});

describe('filters', () => {
  it('filters payslips by branch, department and search', () => {
    const ids = (f: Parameters<typeof filterPayslips>[2]) => filterPayslips(PAYSLIPS, EMPLOYEES, f).map((p) => p.employee_id);
    expect(ids({})).toEqual(['E2', 'E1', 'U1']);
    expect(ids({ branchId: 'b-mba' })).toEqual(['E2']);
    expect(ids({ departmentId: 'd-ops' })).toEqual(['E1', 'U1']);
    expect(ids({ search: 'grace' })).toEqual(['U1']);
    expect(ids({ search: 'e1' })).toEqual(['E1']);
  });

  it('finds a payslip of someone no longer in the staff list by its own name, but not by branch', () => {
    const gone = [slip({ employee_id: 'X9', employee_name: 'Old Timer' })];
    expect(filterPayslips(gone, EMPLOYEES, { search: 'timer' })).toHaveLength(1);
    expect(filterPayslips(gone, EMPLOYEES, { branchId: 'b-nbo' })).toHaveLength(0);
  });
});

describe('Staff salary', () => {
  const lines = salaryLines(PAYSLIPS, EMPLOYEES, DEPARTMENTS);

  it('builds one row per payslip, by employee number, with the grouped columns', () => {
    expect(lines.map((l) => l.employeeNumber)).toEqual(['E1', 'E2', 'U1']);
    const brian = lines[1];
    expect(brian).toMatchObject({
      name: 'Brian Kamau',
      department: 'Finance',
      jobGroup: 'C',
      basic: 50000,
      allowances: 8500,
      overtime: 2000,
      gross: 60500,
      paye: 9000,
      shif: 1663.75,
      nssf: 2160,
      housingLevy: 907.5,
      otherDeductions: 6200, // loan 3000 + advance 2000 + welfare 200 + other 1000
      net: 40568.75,
      paymentMethod: 'Bank',
    });
  });

  it('totals per currency, never adding currencies together', () => {
    const totals = salaryTotals(lines);
    expect(totals.map((t) => [t.currency, t.count, t.gross, t.net])).toEqual([
      ['KES', 2, 90500, 66768.75],
      ['UGX', 1, 1000000, 900000],
    ]);
  });

  it('summarises staff paid, gross, net and statutory per currency', () => {
    const s = salarySummary(lines);
    expect(s.staff).toBe(3);
    expect(s.gross).toEqual({ KES: 90500, UGX: 1000000 });
    expect(s.statutory).toEqual({ KES: 9000 + 1663.75 + 2160 + 907.5 + 2000 + 1800, UGX: 100000 });
    expect(currencyEntries({ UGX: 1, KES: 2 }).map(([c]) => c)).toEqual(['KES', 'UGX']);
  });

  it('gives the payroll status of the month, the furthest along', () => {
    const runs = [
      { pay_period: '2026-10', status: 'approved' },
      { pay_period: '2026-09', status: 'paid' },
    ];
    expect(runStatus(runs, '2026-10')).toBe('approved');
    expect(runStatus(runs, '2026-09')).toBe('paid');
    expect(runStatus(runs, '2026-08')).toBeNull();
  });

  it('shows the last months with staff, gross and net per currency', () => {
    const trend = monthTrend([...PAYSLIPS, slip({ employee_id: 'E1', pay_period: '2026-09', gross_pay: 29000, net_pay: 25000 })], ['2026-09', '2026-10']);
    expect(trend).toEqual([
      { month: '2026-09', staff: 1, gross: { KES: 29000 }, net: { KES: 25000 } },
      { month: '2026-10', staff: 3, gross: { KES: 90500, UGX: 1000000 }, net: { KES: 66768.75, UGX: 900000 } },
    ]);
  });

  it('downloads the same columns as the table', () => {
    const sheet = salarySheet(lines);
    expect(sheet.headers[0]).toBe('Employee no.');
    expect(sheet.headers.at(-1)).toBe('Payment method');
    expect(sheet.rows).toHaveLength(3);
    expect(sheet.rows[0]).toHaveLength(sheet.headers.length);
  });
});

describe('Staff other deductions', () => {
  it('counts each item under its name, plus advance and welfare, without double counting loan or other totals', () => {
    const lines = payslipDeductions(PAYSLIPS[0]);
    expect(lines).toEqual([
      { name: 'Loan repayment: Emergency', amount: 3000 },
      { name: 'SACCO', amount: 1000 },
      { name: ADVANCE, amount: 2000 },
      { name: WELFARE, amount: 200 },
    ]);
    // 6200 = loan 3000 + other 1000 + advance 2000 + welfare 200, not 3000 + 1000 counted twice
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(6200);
  });

  it('falls back to the loan and other totals for payslips saved before items', () => {
    expect(payslipDeductions(slip({ loan_deduction: 1200, other_deductions: 300 }))).toEqual([
      { name: 'Loan repayment', amount: 1200 },
      { name: 'Other deductions', amount: 300 },
    ]);
  });

  const months = ['2026-09', '2026-10'];
  const payslips = [...PAYSLIPS, slip({ employee_id: 'E1', pay_period: '2026-09', deduction_items: [{ name: 'SACCO', amount: 500 }] })];
  const entries = deductionEntries(payslips, EMPLOYEES, DEPARTMENTS);

  it('summarises totals per currency, staff, kinds and advances', () => {
    expect(deductionSummary(entries)).toEqual({
      total: { KES: 7200, UGX: 50000 },
      staff: 3,
      kinds: 4,
      advances: { KES: 2000, UGX: 50000 },
    });
  });

  it('groups by deduction with staff, total and each month', () => {
    const rows = byDeduction(entries, months);
    const sacco = rows.find((r) => r.kind === 'SACCO')!;
    expect(sacco).toEqual({ kind: 'SACCO', staff: 2, total: { KES: 2000 }, byMonth: { '2026-09': { KES: 500 }, '2026-10': { KES: 1500 } } });
    const advance = rows.find((r) => r.kind === ADVANCE)!;
    expect(advance.total).toEqual({ KES: 2000, UGX: 50000 });
    expect(advance.staff).toBe(2);
  });

  it('groups by employee with a column per kind', () => {
    const table = byEmployee(entries);
    expect(table.kinds).toHaveLength(4);
    expect(table.rows.map((r) => [r.employeeNumber, r.currency, r.total])).toEqual([
      ['E1', 'KES', 1000],
      ['E2', 'KES', 6200],
      ['U1', 'UGX', 50000],
    ]);
    expect(table.rows[0]).toMatchObject({ name: 'Amina Otieno', department: 'Operations', amounts: { SACCO: 1000 } });
    const sheet = deductionSheet(table);
    expect(sheet.headers).toEqual(['Employee no.', 'Name', 'Department', 'Currency', ...table.kinds, 'Total']);
    expect(sheet.rows[0]).toHaveLength(sheet.headers.length);
  });

  it('lists the standing deductions still running, for the filtered staff', () => {
    const types = [
      { id: 't1', name: 'SACCO', active: true },
      { id: 't2', name: 'Insurance', active: false },
    ];
    const deductions = [
      { employee_number: 'E1', deduction_type_id: 't1', amount: 500, start_period: '2026-01', end_period: null, notes: '' },
      { employee_number: 'E2', deduction_type_id: 't2', amount: 800, start_period: null, end_period: '2026-12', notes: 'Cover' },
      { employee_number: 'E2', deduction_type_id: 't1', amount: 300, start_period: null, end_period: '2026-05', notes: '' },
      { employee_number: 'U1', deduction_type_id: 't1', amount: 20000, start_period: null, end_period: null, notes: '' },
    ];
    const currency = (b?: string) => (b === 'b-kla' ? 'UGX' : 'KES');
    const all = standingDeductions(deductions, types, EMPLOYEES, DEPARTMENTS, {}, '2026-10', currency);
    expect(all.map((d) => [d.employeeNumber, d.kind, d.amount, d.currency, d.paused])).toEqual([
      ['E1', 'SACCO', 500, 'KES', false],
      ['E2', 'Insurance', 800, 'KES', true],
      ['U1', 'SACCO', 20000, 'UGX', false],
    ]);
    expect(standingDeductions(deductions, types, EMPLOYEES, DEPARTMENTS, { departmentId: 'd-fin' }, '2026-10', currency).map((d) => d.name)).toEqual(['Brian Kamau']);
  });
});
