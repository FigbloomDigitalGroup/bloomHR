import { describe, expect, it } from 'vitest';
import { deductionsForPeriod, parseDeductionSheet, parsePeriod, payslipDeductionLines, totalOf, type EmployeeDeduction } from './voluntaryDeductions';

const types = [
  { id: 'sacco', name: 'SACCO', active: true },
  { id: 'welfare', name: 'Welfare', active: true },
  { id: 'gym', name: 'Gym', active: false },
];
const d = (employee_number: string, deduction_type_id: string, amount: number, start_period: string | null = null, end_period: string | null = null): EmployeeDeduction =>
  ({ id: `${employee_number}-${deduction_type_id}`, employee_number, deduction_type_id, amount, start_period, end_period, notes: null });

describe('deductionsForPeriod', () => {
  const all = [
    d('E1', 'welfare', 300),
    d('E1', 'sacco', 2000, '2026-10'),
    d('E2', 'sacco', 1500, '2026-01', '2026-09'),
    d('E2', 'gym', 1000),
  ];

  it('takes each deduction from its first month to its last, in the order of the type list', () => {
    expect(deductionsForPeriod(types, all, '2026-10').get('E1')).toEqual([
      { name: 'SACCO', amount: 2000 },
      { name: 'Welfare', amount: 300 },
    ]);
    expect(deductionsForPeriod(types, all, '2026-09').get('E1')).toEqual([{ name: 'Welfare', amount: 300 }]);
    expect(deductionsForPeriod(types, all, '2026-09').get('E2')).toEqual([{ name: 'SACCO', amount: 1500 }]);
  });

  it('stops after the last month, and skips paused types', () => {
    expect(deductionsForPeriod(types, all, '2026-10').get('E2')).toBeUndefined();
  });

  it('totals the lines', () => {
    expect(totalOf(deductionsForPeriod(types, all, '2026-10').get('E1')!)).toBe(2300);
  });
});

describe('parsePeriod', () => {
  it.each([
    ['2026-10', '2026-10'],
    ['2026/3', '2026-03'],
    ['2026-10-01', '2026-10'],
    ['10/2026', '2026-10'],
    ['Oct 2026', '2026-10'],
    ['October 2026', '2026-10'],
    ['Oct-26', '2026-10'],
    ['', null],
    ['2026-13', undefined],
    ['soon', undefined],
  ])('%s -> %s', (input, expected) => {
    expect(parsePeriod(input)).toBe(expected);
  });
});

describe('parseDeductionSheet', () => {
  const employees = new Set(['E1', 'E2']);

  it('reads rows with any column case and amounts written like money', () => {
    const { valid, errors } = parseDeductionSheet(
      [{ 'employee number': 'E1', DEDUCTION: 'SACCO', Amount: 'KSh 2,000', From: '2026-10', Until: '' }],
      employees
    );
    expect(errors).toEqual([]);
    expect(valid).toEqual([{ employee_number: 'E1', deduction: 'SACCO', amount: 2000, start_period: '2026-10', end_period: null }]);
  });

  it('skips blank lines and explains every problem on a row, numbered as in Excel', () => {
    const { valid, errors } = parseDeductionSheet(
      [
        { 'Employee Number': '', Deduction: '', Amount: '' },
        { 'Employee Number': 'E9', Deduction: '', Amount: '-5', From: 'soon', Until: '' },
        { 'Employee Number': 'E2', Deduction: 'Loan', Amount: '500', From: '2026-12', Until: '2026-10' },
      ],
      employees
    );
    expect(valid).toEqual([]);
    expect(errors).toEqual([
      'Row 3: no employee with number E9, no deduction name, amount should be a number above 0, "From" should be a month like 2026-10',
      'Row 4: "Until" is before "From"',
    ]);
  });
});

describe('payslipDeductionLines', () => {
  it('shows the itemised deductions', () => {
    expect(payslipDeductionLines({ deduction_items: [{ name: 'SACCO', amount: 2000 }], other_deductions: 2000 })).toEqual([
      { name: 'SACCO', amount: 2000 },
    ]);
  });

  it('shows the loan / welfare / other amounts of a payslip saved before itemising', () => {
    expect(payslipDeductionLines({ deduction_items: [], loan_deduction: 0, welfare_deduction: '300', other_deductions: null })).toEqual([
      { name: 'Welfare', amount: 300 },
    ]);
  });
});
