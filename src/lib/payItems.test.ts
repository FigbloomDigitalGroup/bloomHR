import { describe, expect, it } from 'vitest';
import {
  applyCatalogue,
  casualStanding,
  catalogueFor,
  daysWorkedInMonth,
  deductionLimit,
  itemCovers,
  maxOneOffDeduction,
  monthlyAmount,
  overTwoThirds,
  payItemError,
  workingDaysInMonth,
  type CompanyPayItem,
} from './payItems';
import { lineNet } from './casualPay';
import { MONDAY_TO_FRIDAY } from './workWeek';
import { calculatePayslip, type PayslipContext } from './payslipCalc';

const item = (over: Partial<CompanyPayItem>): CompanyPayItem => ({
  id: over.name ?? 'x',
  name: 'Lunch',
  kind: 'deduction',
  amount_type: 'per_day',
  amount: 100,
  applies_to: 'all',
  scope_id: null,
  employee_numbers: [],
  tax_treatment: 'not_taxable',
  tax_rule_id: null,
  tax_source: null,
  active: true,
  notes: null,
  ...over,
});

const staff = (over: Record<string, unknown> = {}) => ({ 'Employee Number': 'E1', worker_kind: 'employee', 'Basic Salary': 50000, ...over });
const kenya = { country: 'Kenya', basic: 50000, daysWorked: 22 };

describe('who an item covers', () => {
  it('all employees means the monthly payroll, not casuals', () => {
    expect(itemCovers(item({ applies_to: 'all' }), staff())).toBe(true);
    expect(itemCovers(item({ applies_to: 'all' }), staff({ worker_kind: 'casual' }))).toBe(false);
    expect(itemCovers(item({ applies_to: 'casuals' }), staff({ worker_kind: 'casual' }))).toBe(true);
    expect(itemCovers(item({ applies_to: 'casuals' }), staff())).toBe(false);
  });

  it('a department, branch or job group by its id; chosen people by number', () => {
    expect(itemCovers(item({ applies_to: 'department', scope_id: 'd1' }), staff({ department_id: 'd1' }))).toBe(true);
    expect(itemCovers(item({ applies_to: 'department', scope_id: 'd1' }), staff({ department_id: 'd2' }))).toBe(false);
    expect(itemCovers(item({ applies_to: 'branch', scope_id: 'b1' }), staff(), { branchId: 'b1' })).toBe(true);
    expect(itemCovers(item({ applies_to: 'job_group', scope_id: 'g1' }), staff({ job_group_id: 'g1' }))).toBe(true);
    expect(itemCovers(item({ applies_to: 'chosen', employee_numbers: ['E1'] }), staff())).toBe(true);
    expect(itemCovers(item({ applies_to: 'chosen', employee_numbers: ['E1'] }), staff({ 'Employee Number': 'E2' }))).toBe(false);
  });
});

describe('amounts on the monthly payroll', () => {
  it('per day worked, % of basic, or a fixed monthly amount', () => {
    expect(monthlyAmount(item({ amount_type: 'per_day', amount: 100 }), 50000, 21.5)).toBe(2150);
    expect(monthlyAmount(item({ amount_type: 'percent_of_basic', amount: 5 }), 50000, 0)).toBe(2500);
    expect(monthlyAmount(item({ amount_type: 'fixed_monthly', amount: 1500 }), 50000, 0)).toBe(1500);
  });

  it('counts working days by the work week, less days off', () => {
    expect(workingDaysInMonth('2026-10', MONDAY_TO_FRIDAY)).toBe(22);
    expect(workingDaysInMonth('2026-02', MONDAY_TO_FRIDAY)).toBe(20);
    // October 2026 has five Saturdays, each a half day
    expect(workingDaysInMonth('2026-10', [1, 1, 1, 1, 1, 0.5, 0])).toBe(24.5);
    expect(daysWorkedInMonth(22, 3)).toBe(19);
    expect(daysWorkedInMonth(5, 9)).toBe(0);
  });
});

describe('catalogueFor: items as payroll inputs', () => {
  it('a deduction is a deduction line; an allowance an earning, taxed unless confirmed not taxable', () => {
    const e = catalogueFor(
      [
        item({ name: 'Lunch' }),
        item({ name: 'Transport', kind: 'allowance', amount_type: 'fixed_monthly', amount: 3000, tax_treatment: 'taxable' }),
        item({ name: 'Per diem', kind: 'allowance', amount_type: 'fixed_monthly', amount: 2000, tax_treatment: 'not_taxable' }),
        item({ name: 'Bonus pool', kind: 'allowance', amount_type: 'fixed_monthly', amount: 1000, tax_treatment: 'depends' }),
      ],
      staff(),
      kenya,
    );
    expect(e.deductions).toEqual([{ name: 'Lunch', amount: 2200 }]);
    expect(e.earnings).toEqual([
      { name: 'Transport', amount: 3000, taxable: true, pensionable: true },
      { name: 'Per diem', amount: 2000, taxable: false, pensionable: false },
      { name: 'Bonus pool', amount: 1000, taxable: true, pensionable: true },
    ]);
  });

  it('a non-cash benefit goes to the engine benefit figure its rule names; not taxed or outside Kenya it changes nothing', () => {
    const benefits = [
      item({ name: 'Staff meals', kind: 'benefit', amount_type: 'fixed_monthly', amount: 4000, tax_treatment: 'depends', tax_rule_id: 'meals' }),
      item({ name: 'Car benefit', kind: 'benefit', amount_type: 'fixed_monthly', amount: 9000, tax_treatment: 'taxable' }),
      item({ name: 'School fees', kind: 'benefit', amount_type: 'fixed_monthly', amount: 10000, tax_treatment: 'taxable' }),
      item({ name: 'WIBA cover', kind: 'benefit', amount_type: 'fixed_monthly', amount: 500, tax_treatment: 'not_taxable' }),
    ];
    expect(catalogueFor(benefits, staff(), kenya).fields).toEqual({ meals_benefit: 4000, car_benefit: 9000, other_benefits: 10000 });
    expect(catalogueFor(benefits, staff(), { ...kenya, country: 'Uganda' }).fields).toEqual({});
  });

  it('a pension deduction lowers PAYE through the tax details; insurance gets relief and a line', () => {
    const e = catalogueFor(
      [
        item({ name: 'Staff pension', amount_type: 'percent_of_basic', amount: 5, tax_treatment: 'reduces_taxable_pay', tax_rule_id: 'pension' }),
        item({ name: 'Life insurance', amount_type: 'fixed_monthly', amount: 1000, tax_treatment: 'relief', tax_rule_id: 'insurance' }),
      ],
      staff(),
      kenya,
    );
    expect(e.fields).toEqual({ other_pension_contribution: 2500, insurance_premium: 1000 });
    expect(e.deductions).toEqual([{ name: 'Life insurance', amount: 1000 }]);
  });

  it('skips paused items, and an empty catalogue changes nothing', () => {
    const emp = staff();
    const vol = new Map([['E1', [{ name: 'SACCO', amount: 500 }]]]);
    const out = applyCatalogue({ employees: [emp], items: [item({ active: false })], voluntaryByEmployee: vol, earningsByEmployee: new Map(), monthOf: () => kenya });
    expect(out.voluntaryByEmployee.get('E1')).toEqual([{ name: 'SACCO', amount: 500 }]);
    expect(out.employees[0]).toBe(emp);
  });

  it("adds after the employee's own deductions", () => {
    const vol = new Map([['E1', [{ name: 'SACCO', amount: 500 }]]]);
    const out = applyCatalogue({ employees: [staff()], items: [item({})], voluntaryByEmployee: vol, earningsByEmployee: new Map(), monthOf: () => kenya });
    expect(out.voluntaryByEmployee.get('E1')).toEqual([{ name: 'SACCO', amount: 500 }, { name: 'Lunch', amount: 2200 }]);
    expect(vol.get('E1')).toHaveLength(1);
  });
});

describe('the catalogue in the payroll calculation', () => {
  const ctx = (over: Partial<PayslipContext>): PayslipContext => ({
    period: '2026-10',
    rates: {
      paye_bands: [{ upto: 24000, rate: 0.1 }, { upto: 32333, rate: 0.25 }, { upto: null, rate: 0.3 }],
      personal_relief: 2400,
      shif_rate: 0.0275,
      nssf_rate: 0.06,
      nssf_upper_limit: 72000,
      ahl_rate: 0.015,
      per_diem_rate: 0,
      meals_exempt_limit: 5000,
      pension_deduction_cap: 30000,
    },
    overrideStatutoryChecks: true,
    voluntaryByEmployee: new Map(),
    payrollLoans: [],
    earningsByEmployee: new Map(),
    leaveByEmployee: new Map(),
    leaveBasis: 'basic_30',
    absenceByEmployee: new Map(),
    leavePayouts: new Map(),
    overtimeMonth: undefined,
    advanceFor: () => 0,
    ...over,
  });

  const run = (items: CompanyPayItem[]) => {
    const out = applyCatalogue({ employees: [staff()], items, voluntaryByEmployee: new Map(), earningsByEmployee: new Map(), monthOf: () => kenya });
    return calculatePayslip(out.employees[0], ctx({ voluntaryByEmployee: out.voluntaryByEmployee, earningsByEmployee: out.earningsByEmployee }));
  };

  it('a lunch deduction comes off net pay after tax, on its own line', () => {
    const before = run([]);
    const after = run([item({ name: 'Lunch' })]);
    expect(after.paye_tax).toBe(before.paye_tax);
    expect(after.deduction_items).toEqual([{ name: 'Lunch', amount: 2200 }]);
    expect(Math.round((before.net_pay - after.net_pay) * 100) / 100).toBe(2200);
  });

  it('a taxable allowance raises gross and PAYE; a meals benefit under its limit changes nothing', () => {
    const before = run([]);
    const allowance = run([item({ name: 'Transport', kind: 'allowance', amount_type: 'fixed_monthly', amount: 3000, tax_treatment: 'taxable' })]);
    expect(allowance.gross_pay).toBe(before.gross_pay + 3000);
    expect(allowance.paye_tax).toBeGreaterThan(before.paye_tax);
    const meals = run([item({ name: 'Staff meals', kind: 'benefit', amount_type: 'fixed_monthly', amount: 4000, tax_treatment: 'depends', tax_rule_id: 'meals' })]);
    expect(meals.paye_tax).toBe(before.paye_tax);
    expect(meals.net_pay).toBe(before.net_pay);
  });

  it('a pension item lowers PAYE and shows as the pension deduction', () => {
    const before = run([]);
    const pension = run([item({ name: 'Staff pension', amount_type: 'percent_of_basic', amount: 5, tax_treatment: 'reduces_taxable_pay', tax_rule_id: 'pension' })]);
    expect(pension.paye_tax).toBeLessThan(before.paye_tax);
    expect(pension.deduction_items).toEqual([{ name: 'Pension contribution', amount: 2500 }]);
  });

  it('flags payslips over two-thirds', () => {
    expect(
      overTwoThirds([
        { employee_id: 'E1', employee_name: 'A', gross_pay: 300, total_deductions: 201 },
        { employee_id: 'E2', gross_pay: 300, total_deductions: 200 },
      ]),
    ).toEqual([{ employeeNumber: 'E1', name: 'A', gross: 300, deductions: 201 }]);
  });
});

describe('casual pay-run lines', () => {
  const line = { employee_number: 'C1', full_days: 5, half_days: 2, days_amount: 6000 };

  it('lunch per day worked counts half days as half', () => {
    const s = casualStanding(line, [item({ applies_to: 'casuals', amount: 100 })], true);
    expect(s.deductions).toBe(600);
    expect(s.items).toEqual([{ name: 'Lunch', kind: 'deduction', amount: 600, full: 600 }]);
    expect(lineNet({ days_amount: 6000, additions: 0, deductions: 0, standing_deductions: s.deductions, standing_additions: s.additions })).toBe(5400);
  });

  it('applies chosen workers, allowances first, fixed once per run and % of the days pay', () => {
    const s = casualStanding(
      line,
      [
        item({ name: 'Tools', applies_to: 'chosen', employee_numbers: ['C1'], amount_type: 'fixed_monthly', amount: 250 }),
        item({ name: 'Transport', kind: 'allowance', applies_to: 'casuals', amount: 50 }),
        item({ name: 'Welfare', applies_to: 'casuals', amount_type: 'percent_of_basic', amount: 2 }),
        item({ name: 'Other worker', applies_to: 'chosen', employee_numbers: ['C2'], amount: 999 }),
        item({ name: 'Monthly staff only', applies_to: 'all', amount: 999 }),
        item({ name: 'Meals benefit', kind: 'benefit', applies_to: 'casuals', amount: 999 }),
      ],
      true,
    );
    expect(s.items.map((i) => [i.name, i.amount])).toEqual([
      ['Transport', 300],
      ['Tools', 250],
      ['Welfare', 120],
    ]);
    expect(s.additions).toBe(300);
    expect(s.deductions).toBe(370);
  });

  it('keeps deductions within two-thirds of the pay with the cap on, and within the pay with it off', () => {
    const big = [item({ name: 'A', applies_to: 'casuals', amount: 700 }), item({ name: 'B', applies_to: 'casuals', amount: 500 })];
    const small = { ...line, full_days: 1, half_days: 0, days_amount: 1000 };
    expect(casualStanding(small, big, true).items).toEqual([
      { name: 'A', kind: 'deduction', amount: 666.67, full: 700 },
      { name: 'B', kind: 'deduction', amount: 0, full: 500 },
    ]);
    const off = casualStanding(small, big, false);
    expect(off.deductions).toBe(1000);
    expect(lineNet({ days_amount: 1000, additions: 0, deductions: 0, standing_deductions: off.deductions })).toBe(0);
    expect(deductionLimit(1000, true)).toBe(666.67);
  });

  it('gives nothing to a line with no days worked', () => {
    expect(casualStanding({ ...line, full_days: 0, half_days: 0, days_amount: 0 }, [item({ applies_to: 'casuals', amount_type: 'fixed_monthly' })], true).items).toEqual([]);
  });

  it('limits the one-off deduction to what is left under the limit', () => {
    const l = { days_amount: 6000, standing_additions: 0, standing_deductions: 600 };
    expect(maxOneOffDeduction(l, 0, true)).toBe(3400);
    expect(maxOneOffDeduction(l, 300, true)).toBe(3600);
    expect(maxOneOffDeduction(l, 0, false)).toBe(5400);
  });
});

describe('payItemError', () => {
  const ok = {
    name: 'Lunch',
    kind: 'deduction' as const,
    amount_type: 'per_day' as const,
    amount: 100,
    applies_to: 'casuals' as const,
    scope_id: null,
    employee_numbers: [],
    tax_treatment: 'not_taxable' as const,
  };
  it('needs a name, an amount, a scope and a confirmed treatment', () => {
    expect(payItemError(ok)).toBeNull();
    expect(payItemError({ ...ok, name: 'x' })).toMatch(/name/);
    expect(payItemError({ ...ok, amount: -1 })).toMatch(/amount/);
    expect(payItemError({ ...ok, amount_type: 'percent_of_basic', amount: 120 })).toMatch(/100/);
    expect(payItemError({ ...ok, applies_to: 'branch' })).toMatch(/Choose/);
    expect(payItemError({ ...ok, applies_to: 'chosen' })).toMatch(/person/);
    expect(payItemError({ ...ok, tax_treatment: undefined })).toMatch(/taxed/);
  });
});
