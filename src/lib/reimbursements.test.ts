import { describe, expect, it } from 'vitest';
import {
  afterDeductionsOf,
  parseReimbursement,
  reimbursementColumns,
  reimbursementItemsOf,
  reimbursementNamesFor,
  reimbursementsForPeriod,
  withReimbursement,
  withReimbursements,
} from './reimbursements';
import { runRowFigures, runTotalsByCurrency, statutoryColumnsFor } from './payrollRunColumns';

const types = [
  { id: 'mi', name: 'Mileage', position: 2, active: true },
  { id: 'pd', name: 'Per diem', position: 1, active: true },
  { id: 'fu', name: 'Fuel', position: 3, active: false },
];
const payslip = { employee_id: 'E1', gross_pay: 80000, paye_tax: 12000, nssf_deduction: 2160, nhif_deduction: 2200, housing_levy: 1200, total_deductions: 18560, net_pay: 61440 };

describe('reimbursements', () => {
  it('shows the active columns in order', () => {
    expect(reimbursementColumns(types).map((t) => t.name)).toEqual(['Per diem', 'Mileage']);
  });

  it("gives each employee the month's amounts in column order, leaving out paused columns and other months", () => {
    const rows = [
      { id: '1', employee_number: 'E1', reimbursement_type_id: 'mi', pay_period: '2026-10', amount: 1200 },
      { id: '2', employee_number: 'E1', reimbursement_type_id: 'pd', pay_period: '2026-10', amount: 3000 },
      { id: '3', employee_number: 'E1', reimbursement_type_id: 'fu', pay_period: '2026-10', amount: 900 },
      { id: '4', employee_number: 'E2', reimbursement_type_id: 'pd', pay_period: '2026-09', amount: 500 },
    ];
    const byEmployee = reimbursementsForPeriod(types, rows, '2026-10');
    expect(byEmployee.get('E1')).toEqual([{ name: 'Per diem', amount: 3000 }, { name: 'Mileage', amount: 1200 }]);
    expect(byEmployee.has('E2')).toBe(false);
  });

  it('adds them to net pay after deductions, and can be applied again without counting twice', () => {
    const once = withReimbursements(payslip, [{ name: 'Per diem', amount: 3000 }, { name: 'Mileage', amount: 1200.5 }]);
    expect(once).toMatchObject({ reimbursements: 4200.5, net_pay: 65640.5, gross_pay: 80000, total_deductions: 18560 });
    expect(afterDeductionsOf(once)).toBe(61440);
    const again = withReimbursements(once, [{ name: 'Mileage', amount: 800 }]);
    expect(again).toMatchObject({ reimbursement_items: [{ name: 'Mileage', amount: 800 }], reimbursements: 800, net_pay: 62240 });
    expect(withReimbursements(again, [])).toMatchObject({ reimbursement_items: [], reimbursements: 0, net_pay: 61440 });
  });

  it('sets or clears one column, keeping the others in column order', () => {
    const columns = ['Per diem', 'Mileage'];
    const withMileage = withReimbursement(payslip, 'Mileage', 1500, columns);
    const both = withReimbursement(withMileage, 'Per diem', 2000, columns);
    expect(reimbursementItemsOf(both)).toEqual([{ name: 'Per diem', amount: 2000 }, { name: 'Mileage', amount: 1500 }]);
    expect(both.net_pay).toBe(64940);
    const cleared = withReimbursement(both, 'Mileage', 0, columns);
    expect(reimbursementItemsOf(cleared)).toEqual([{ name: 'Per diem', amount: 2000 }]);
    expect(cleared.net_pay).toBe(63440);
  });

  it('reads what was typed: commas allowed, empty is 0, anything else is refused', () => {
    expect(['1,500', ' 2500.5 ', '', '0', '12.345', '-5', 'abc'].map(parseReimbursement)).toEqual([1500, 2500.5, 0, 0, null, null, null]);
  });

  it('lists a removed column a saved payslip still pays, after the active ones', () => {
    const saved = { reimbursement_items: [{ name: 'Fuel', amount: 900 }, { name: 'Mileage', amount: 100 }] };
    expect(reimbursementNamesFor(['Per diem', 'Mileage'], [saved, {}])).toEqual(['Per diem', 'Mileage', 'Fuel']);
  });
});

describe("the Run tab's columns", () => {
  it('shows SHIF and the housing levy with anyone in Kenya, PAYE and NSSF always', () => {
    expect(statutoryColumnsFor([payslip]).map((c) => c.label)).toEqual(['PAYE', 'NSSF', 'SHIF', 'Housing levy']);
    const tz = { country: 'Tanzania', currency: 'TZS', paye_tax: 50000, nssf_deduction: 80000, total_deductions: 130000 };
    expect(statutoryColumnsFor([tz]).map((c) => c.label)).toEqual(['PAYE', 'NSSF']);
  });

  it('works out basic pay, each deduction, other deductions, gross pay, the reimbursements and net pay', () => {
    const paid = withReimbursements(payslip, [{ name: 'Mileage', amount: 1500 }]);
    const statutory = statutoryColumnsFor([paid]);
    expect(runRowFigures(paid, statutory, ['Per diem', 'Mileage'])).toEqual({
      basic: 80000, deductions: [12000, 2160, 2200, 1200], other: 1000, gross: 61440, reimbursements: [0, 1500], net: 62940,
    });
  });

  it('totals each currency on its own', () => {
    const ke = withReimbursements(payslip, [{ name: 'Mileage', amount: 1500 }]);
    const tz = { country: 'Tanzania', currency: 'TZS', gross_pay: 900000, paye_tax: 50000, nssf_deduction: 90000, total_deductions: 140000, net_pay: 760000 };
    const statutory = statutoryColumnsFor([ke, tz]);
    const totals = runTotalsByCurrency([ke, ke, tz], statutory, ['Mileage']);
    expect(totals.map((t) => [t.currency, t.count, t.figures.basic, t.figures.reimbursements, t.figures.net])).toEqual([
      ['KES', 2, 160000, [3000], 125880],
      ['TZS', 1, 900000, [0], 760000],
    ]);
  });
});
