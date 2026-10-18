import { describe, expect, it } from 'vitest';
import {
  casualRateShortfall, currencyFor, employeeCountry, historyByCountry, minimumInForce, payslipShortfalls, perDayMinimum, periodDay,
  workShortfalls, type EmployeeMinimum, type MinimumWage,
} from './minimumWage';

const ON = { enabled: true, daysPerMonth: 26 };
const KENYA: EmployeeMinimum = { country: 'Kenya', monthly: 15600, currency: 'KES' };

const employees = [
  { 'Employee Number': 'E1', pay_basis: 'salary', worker_kind: 'employee' },
  { 'Employee Number': 'E2', pay_basis: 'salary', worker_kind: 'employee' },
  { 'Employee Number': 'W1', pay_basis: 'work', worker_kind: 'employee' },
  { 'Employee Number': 'W2', pay_basis: 'work', worker_kind: 'employee' },
  { 'Employee Number': 'C1', pay_basis: 'work', worker_kind: 'contractor' },
  { 'Employee Number': 'C2', pay_basis: 'salary', worker_kind: 'contractor' },
];
const slip = (id: string, basic: number, work = 0, jobs = 0, extra: Record<string, unknown> = {}) => ({
  employee_id: id, employee_name: `Person ${id}`, basic_salary: basic, work_pay: work, jobs_pay: jobs, ...extra,
});
const check = (payslips: Record<string, unknown>[], opts: { minimum?: EmployeeMinimum | null; days?: Record<string, number>; settings?: typeof ON } = {}) =>
  payslipShortfalls({
    payslips,
    employees,
    minimumFor: () => (opts.minimum === undefined ? KENYA : opts.minimum),
    workDays: new Map(Object.entries(opts.days ?? {})),
    settings: opts.settings ?? ON,
  });

describe('salaried employees', () => {
  it('warns when basic pay is below the monthly minimum, with the shortfall', () => {
    expect(check([slip('E1', 12000)])).toEqual([
      { employeeNumber: 'E1', name: 'Person E1', country: 'Kenya', currency: 'KES', basis: 'monthly', pay: 12000, minimum: 15600, shortfall: 3600 },
    ]);
  });

  it('does not warn at or above the minimum', () => {
    expect(check([slip('E1', 15600), slip('E2', 40000)])).toEqual([]);
  });

  it('counts any work or jobs that month towards a salaried employee’s pay', () => {
    expect(check([slip('E1', 12000, 2000, 1600)])).toEqual([]);
  });
});

describe('piece rate workers', () => {
  it('compares work and jobs with the per-day minimum x the days they recorded work', () => {
    // 15,600 / 26 = 600 a day; 10 days = 6,000
    expect(perDayMinimum(15600, 26)).toBe(600);
    const [w1] = check([slip('W1', 0, 5000, 500)], { days: { W1: 10 } });
    expect(w1).toMatchObject({ basis: 'per_day', pay: 5500, minimum: 6000, shortfall: 500, days: 10 });
    expect(check([slip('W1', 0, 6000)], { days: { W1: 10 } })).toEqual([]);
  });

  it('uses the days setting for the per-day minimum', () => {
    const [w1] = check([slip('W1', 0, 5000)], { days: { W1: 10 }, settings: { enabled: true, daysPerMonth: 30 } });
    expect(w1).toMatchObject({ minimum: 5200, shortfall: 200 });
  });

  it('skips a worker with no recorded days', () => {
    expect(check([slip('W2', 0, 0, 3000)])).toEqual([]);
  });

  it('flags the workers below on the Workers list from their month of work', () => {
    const below = workShortfalls(
      [
        { employee_number: 'W1', days: 20, work_gross: '10000.00', jobs_gross: '0' },
        { employee_number: 'W2', days: 5, work_gross: '3000.00', jobs_gross: '0' },
        { employee_number: 'C1', days: 20, work_gross: '100.00', jobs_gross: '0' },
      ],
      [{ employee_number: 'W1', worker_kind: 'employee', name: 'Wanjiru' }, { employee_number: 'W2', worker_kind: 'employee' }, { employee_number: 'C1', worker_kind: 'contractor' }],
      () => KENYA,
      ON,
    );
    expect([...below.keys()]).toEqual(['W1']);
    expect(below.get('W1')).toMatchObject({ name: 'Wanjiru', pay: 10000, minimum: 12000, shortfall: 2000, days: 20 });
  });
});

describe('casual workers', () => {
  it("compares the daily rate with the per-day minimum", () => {
    expect(casualRateShortfall(500, KENYA, ON)).toBe(100);
    expect(casualRateShortfall('600', KENYA, ON)).toBeNull();
    expect(casualRateShortfall(800, KENYA, ON)).toBeNull();
    expect(casualRateShortfall('', KENYA, ON)).toBeNull();
  });

  it('skips casuals on the monthly payroll check (they have their own pay runs)', () => {
    expect(check([slip('X1', 100, 0, 0, { worker_kind: 'casual' })])).toEqual([]);
  });
});

describe('no amount, check off', () => {
  it('warns about nothing when no amount is set for the country', () => {
    expect(check([slip('E1', 100)], { minimum: null })).toEqual([]);
    expect(check([slip('E1', 100)], { minimum: { country: 'Rwanda', monthly: null, currency: 'RWF' } })).toEqual([]);
    expect(casualRateShortfall(1, { country: 'Kenya', monthly: null, currency: 'KES' }, ON)).toBeNull();
  });

  it('warns about nothing with the check off', () => {
    expect(check([slip('E1', 100)], { settings: { enabled: false, daysPerMonth: 26 } })).toEqual([]);
    expect(casualRateShortfall(1, KENYA, { enabled: false, daysPerMonth: 26 })).toBeNull();
  });
});

describe('contractors', () => {
  it('are not checked, salaried or paid by work', () => {
    expect(check([slip('C1', 0, 100), slip('C2', 100)], { days: { C1: 20 } })).toEqual([]);
    // the payslip's own worker_kind counts too
    expect(check([slip('E1', 100, 0, 0, { worker_kind: 'contractor' })])).toEqual([]);
  });
});

describe('effective dates', () => {
  const rows: MinimumWage[] = [
    { id: '1', country: 'Kenya', monthly_amount: 15201, currency: 'KES', effective_from: '2024-11-01' },
    { id: '2', country: 'Kenya', monthly_amount: 16000, currency: 'KES', effective_from: '2026-05-01' },
    { id: '3', country: 'Uganda', monthly_amount: 130000, currency: 'UGX', effective_from: '2026-01-01' },
  ];

  it('uses the latest amount in force on the day, by country', () => {
    expect(minimumInForce(rows, 'Kenya', '2024-10-31')).toBeNull();
    expect(minimumInForce(rows, 'Kenya', '2024-11-01')?.id).toBe('1');
    expect(minimumInForce(rows, 'kenya ', '2026-04-30')?.id).toBe('1');
    expect(minimumInForce(rows, 'Kenya', '2026-05-01')?.id).toBe('2');
    expect(minimumInForce(rows, 'Uganda', '2026-05-01')?.id).toBe('3');
    expect(minimumInForce(rows, 'Tanzania', '2026-05-01')).toBeNull();
  });

  it("reads the month's minimum on its last day", () => {
    expect(periodDay('2026-04')).toBe('2026-04-30');
    expect(periodDay('2026-02')).toBe('2026-02-28');
    expect(periodDay('2026-12')).toBe('2026-12-31');
  });

  it('groups the history by country, latest first', () => {
    expect(historyByCountry(rows).map((g) => [g.country, g.rows.map((r) => r.id)])).toEqual([['Kenya', ['2', '1']], ['Uganda', ['3']]]);
  });
});

describe('country and currency', () => {
  it("an employee's country is the company's, Kenya when not set", () => {
    expect(employeeCountry(null)).toBe('Kenya');
    expect(employeeCountry('  ')).toBe('Kenya');
    expect(employeeCountry('Tanzania')).toBe('Tanzania');
  });

  it('defaults the currency by country', () => {
    expect(currencyFor('Kenya')).toBe('KES');
    expect(currencyFor('tanzania')).toBe('TZS');
    expect(currencyFor('Uganda')).toBe('UGX');
    expect(currencyFor('Elsewhere')).toBe('KES');
  });
});
