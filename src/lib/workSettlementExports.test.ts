// @vitest-environment node
//
// The month-end settlement in the files payroll downloads (FIG-812 stage 5): the KRA withholding tax report for
// contractors, contractors kept off the P10, SHA and NSSF returns, and the payroll register's settlement columns.
import { describe, expect, it } from 'vitest';
import { nssfFile, p10File, returnsReadiness, shaFile, whtFile, WHT_HEADERS } from './payrollExports';
import { REGISTER_COLUMNS, WORK_REGISTER_COLUMNS, registerFigures } from './payrollPdf';

const employees = [
  { 'Employee Number': 'E1', 'First Name': 'Amina', 'Last Name': 'Wanjiru', 'Tax PIN': 'A012345678Z', worker_kind: 'employee' },
  { 'Employee Number': 'C1', 'First Name': 'Chege', 'Last Name': 'Contract', 'Tax PIN': 'A098765432B', 'Payroll Number': 'PR-7', worker_kind: 'contractor', wht_category: 'contractual' },
  { 'Employee Number': 'C2', 'First Name': 'Grace', 'Last Name': 'Consult', worker_kind: 'contractor', wht_category: 'professional' },
];
const payslips = [
  { employee_id: 'E1', gross_pay: 30000, paye_tax: 731.25, nhif_deduction: 825, nssf_deduction: 1800, housing_levy: 450, net_pay: 26193.75, worker_kind: 'employee' },
  { employee_id: 'C1', gross_pay: 10000, wht_rate: 0.03, wht_tax: 300, wht_withheld: 150, net_pay: 4850, worker_kind: 'contractor', work_settlement: true },
  { employee_id: 'C2', gross_pay: 8000, wht_rate: 0.05, wht_tax: 400, wht_withheld: 0, net_pay: 7600, worker_kind: 'contractor', work_settlement: true },
];

describe('the WHT report', () => {
  it('one row per contractor for the month: PIN, gross, rate and tax, split by when it was withheld', () => {
    const f = whtFile(payslips, employees, '2026-10');
    expect(f.headers).toBe(WHT_HEADERS);
    expect(f.rows).toEqual([
      ['A098765432B', 'Chege Contract', 'C1', '2026-10', 'Contractual fees', '10000.00', '3.00', '300.00', '150.00', '150.00'],
      ['', 'Grace Consult', 'C2', '2026-10', 'Professional / management fees', '8000.00', '5.00', '400.00', '0.00', '400.00'],
    ]);
    expect(f.problems).toEqual([{ name: 'Grace Consult', employeeNumber: 'C2', missing: ['KRA PIN'] }]);
  });
});

describe('the statutory returns', () => {
  it('leave contractors out of the P10, SHA and NSSF returns', () => {
    for (const f of [p10File(payslips, employees, {}), shaFile(payslips, employees), nssfFile(payslips, employees)]) expect(f.rows).toHaveLength(1);
    const ready = returnsReadiness(employees);
    expect([...ready.p10, ...ready.sha, ...ready.nssf].map((p) => p.employeeNumber)).not.toContain('C1');
  });
});

// the register's columns in finance's names (lib/payrollPdf): Basic salary, Basic pay, and Gross pay (after deductions)
// just before Net pay
const inFinanceNames = (columns: readonly string[]) => {
  const renamed = columns.map((c) => (c === 'Basic' ? 'Basic salary' : c === 'Gross pay' ? 'Basic pay' : c));
  const at = renamed.indexOf('Net pay');
  return [...renamed.slice(0, at), 'Gross pay', ...renamed.slice(at)];
};

describe('the payroll register', () => {
  it('keeps its columns when no one is paid for work', () => {
    expect(registerFigures([payslips[0]]).columns).toEqual(inFinanceNames(REGISTER_COLUMNS));
  });

  it('adds work, WHT, paid during the month and arrears when someone is', () => {
    const work = { employee_id: 'W1', basic_salary: 0, gross_pay: 30000, work_pay: 25000, jobs_pay: 5000, paye_tax: 731.25, nhif_deduction: 825,
      nssf_deduction: 1800, housing_levy: 450, total_deductions: 3806.25, paid_out: 17700, arrears_brought_forward: 100,
      arrears_carried_forward: 0, net_pay: 8393.75, work_settlement: true };
    const { columns, lines, totals } = registerFigures([work, payslips[1]]);
    expect(columns).toEqual(inFinanceNames(WORK_REGISTER_COLUMNS));
    expect(lines[0].amounts).toEqual([0, 0, 0, 30000, 0, 30000, 731.25, 825, 1800, 450, 0, 0, 17700, 100, 0, 8393.75, 8393.75, 0]);
    // the contractor: WHT in its own column, not in other deductions
    expect(lines[1].amounts[10]).toBe(300);
    expect(lines[1].amounts[11]).toBe(0);
    expect(totals).toHaveLength(WORK_REGISTER_COLUMNS.length + 1 - 3);
  });
});
