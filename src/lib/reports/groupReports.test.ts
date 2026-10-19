import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  SUMMARY_SHEET,
  costByBranchDepartment,
  dueDate,
  hrReport,
  inScope,
  monthOf,
  payrollSummary,
  payrollSummaryWorkbook,
  payslipsInScope,
  remittanceSummary,
  scopeOptions,
  sumByCurrency,
  summaryByCurrency,
} from './groupReports';
import { BRANCHES, EMPLOYEES, PAYSLIPS, RATES } from './groupFixtures';

const lines = (scope: Parameters<typeof payslipsInScope>[3] = 'all') => payslipsInScope(PAYSLIPS, EMPLOYEES, BRANCHES, scope, RATES);

describe('sumByCurrency', () => {
  it('keeps one bucket per currency and never adds currencies together', () => {
    const rows = [
      { c: 'TZS', v: 1000 },
      { c: 'KES', v: 10 },
      { c: 'UGX', v: 500 },
      { c: 'KES', v: 5 },
    ];
    const out = sumByCurrency(rows, (r) => r.c, { v: (r) => r.v });
    expect(out).toEqual([
      { currency: 'KES', count: 2, v: 15 },
      { currency: 'TZS', count: 1, v: 1000 },
      { currency: 'UGX', count: 1, v: 500 },
    ]);
    // no bucket holds a sum of two currencies
    expect(out.some((b) => b.v === 1515)).toBe(false);
  });

  it('treats a missing currency as KES (payslips saved before currencies were recorded)', () => {
    expect(sumByCurrency([{ c: '', v: 1 }], (r) => r.c, { v: (r) => r.v })[0].currency).toBe('KES');
  });
});

describe('the country and branch filter', () => {
  it('offers All, each country and each branch', () => {
    expect(scopeOptions(BRANCHES).map((o) => o.label)).toEqual([
      'All countries', 'Kenya', 'Tanzania', 'Uganda', 'Mombasa · Kenya', 'Nairobi HQ · Kenya', 'Dar es Salaam · Tanzania', 'Kampala · Uganda',
    ]);
  });

  it('offers only All for a company with one branch', () => {
    expect(scopeOptions([BRANCHES[0]]).map((o) => o.value)).toEqual(['all']);
  });

  it('matches by country or branch', () => {
    const place = { country: 'Tanzania', branchId: 'b-dar' };
    expect(inScope(place, 'all')).toBe(true);
    expect(inScope(place, 'country:Tanzania')).toBe(true);
    expect(inScope(place, 'country:Kenya')).toBe(false);
    expect(inScope(place, 'branch:b-dar')).toBe(true);
    expect(inScope(place, 'branch:b-nbo')).toBe(false);
  });

  it('filters payslips to a country or a branch', () => {
    expect(lines('country:Kenya').map((l) => l.payslip.employee_id)).toEqual(['K1', 'K2']);
    expect(lines('branch:b-mba').map((l) => l.payslip.employee_id)).toEqual(['K2']);
    expect(lines('country:Uganda').map((l) => l.payslip.employee_id)).toEqual(['U1']);
  });

  it("keeps a payslip in the country that paid it when the person has since moved", () => {
    const moved = EMPLOYEES.map((e) => (e['Employee Number'] === 'T1' ? { ...e, branch_id: 'b-nbo' } : e));
    const ls = payslipsInScope(PAYSLIPS, moved, BRANCHES, 'country:Tanzania', RATES);
    expect(ls.map((l) => [l.payslip.employee_id, l.place.branchName])).toEqual([['T1', 'Moved since']]);
    expect(payslipsInScope(PAYSLIPS, moved, BRANCHES, 'branch:b-nbo', RATES).map((l) => l.payslip.employee_id)).toEqual(['K1']);
  });
});

describe('the payroll summary', () => {
  const countries = payrollSummary(lines());

  it('gives each country its own currency and statutory lines', () => {
    expect(countries.map((c) => [c.country, c.currency, c.headcount])).toEqual([['Kenya', 'KES', 2], ['Tanzania', 'TZS', 1], ['Uganda', 'UGX', 1]]);
    const [ke, tz, ug] = countries;
    expect(ke.gross).toBe(150000);
    expect(ke.statutory).toEqual([
      { label: 'PAYE', amount: 26000 }, { label: 'NSSF', amount: 7320 }, { label: 'SHIF', amount: 4125 }, { label: 'Housing levy', amount: 2250 },
    ]);
    expect(ke.employerCosts).toEqual([
      { label: 'NSSF (employer)', amount: 7320 }, { label: 'Housing levy (employer)', amount: 2250 }, { label: 'NITA levy', amount: 100 },
    ]);
    expect([ke.loans, ke.otherDeductions, ke.totalDeductions, ke.net, ke.totalCost]).toEqual([1000, 0, 40695, 109305, 159670]);
    expect(tz.statutory.map((l) => l.label)).toEqual(['PAYE', 'NSSF', 'HESLB loan repayment']);
    expect(tz.employerCosts.map((l) => [l.label, l.amount])).toEqual([['NSSF (employer)', 200000], ['SDL (skills levy)', 70000], ['WCF (workers compensation)', 10000]]);
    expect(ug.statutory.map((l) => [l.label, l.amount])).toEqual([['PAYE', 330750], ['NSSF', 75000], ['Local service tax', 25000]]);
    expect(ug.employerCosts).toEqual([{ label: 'NSSF (employer)', amount: 150000 }]);
  });

  it('adds up per currency, never across', () => {
    const byCurrency = summaryByCurrency(countries);
    expect(byCurrency.map((c) => [c.currency, c.net])).toEqual([['KES', 109305], ['TZS', 1500000], ['UGX', 1069250]]);
    expect(byCurrency.map((c) => c.countries)).toEqual([['Kenya'], ['Tanzania'], ['Uganda']]);
  });
});

describe('statutory remittances', () => {
  const [ke, tz, ug] = remittanceSummary(lines(), '2026-10');

  it("lists what Kenya owes KRA, NSSF, SHA and NITA, with due dates", () => {
    expect(ke.items.map((i) => [i.authority, i.label, i.amount, i.due])).toEqual([
      ['KRA', 'PAYE', 26000, '2026-11-09'],
      ['KRA', 'Housing levy (AHL)', 4500, null],
      ['NSSF Kenya', 'NSSF', 14640, '2026-11-09'],
      ['SHA', 'SHIF', 4125, '2026-11-09'],
      ['NITA', 'NITA training levy', 100, null],
    ]);
    expect(ke.items[2]).toMatchObject({ employee: 7320, employer: 7320 });
    expect(ke.total).toBe(49365);
  });

  it("uses Tanzania's own days and authorities", () => {
    expect(tz.currency).toBe('TZS');
    expect(tz.items.map((i) => [i.authority, i.amount, i.due])).toEqual([
      ['TRA', 300000, '2026-11-07'],
      ['TRA', 70000, '2026-11-07'],
      ['NSSF Tanzania', 400000, '2026-11-30'],
      ['WCF', 10000, '2026-11-30'],
      ['HESLB', 0, '2026-11-15'],
    ]);
  });

  it('lists URA, NSSF Uganda and LST for Uganda', () => {
    expect(ug.items.map((i) => [i.authority, i.amount])).toEqual([['URA', 330750], ['NSSF Uganda', 225000], ['Local government', 25000]]);
  });

  it('works out due dates in the month after the pay period', () => {
    expect(dueDate('2026-12', 9)).toBe('2027-01-09');
    expect(dueDate('2027-01', 'end')).toBe('2027-02-28');
    expect(dueDate('nonsense', 9)).toBeNull();
  });
});

describe('cost by branch and department', () => {
  it('groups by currency, each with its own total', () => {
    const groups = costByBranchDepartment(lines(), EMPLOYEES);
    expect(groups.map((g) => g.currency)).toEqual(['KES', 'TZS', 'UGX']);
    expect(groups[0].rows.map((r) => [r.branch, r.department, r.totalCost])).toEqual([
      ['Mombasa', 'Operations', 53800],
      ['Nairobi HQ', 'Finance', 105870],
    ]);
    expect(groups[0].total).toMatchObject({ currency: 'KES', headcount: 2, totalCost: 159670 });
    expect(groups[1].total.totalCost).toBe(2280000);
  });
});

describe('HR numbers', () => {
  const hr = (scope: Parameters<typeof hrReport>[0]['scope'] = 'all') =>
    hrReport({
      month: '2026-10', employees: EMPLOYEES, branches: BRANCHES, scope,
      exits: [{ employee_number: 'K9', last_working_day: '2026-10-31', status: 'completed' }, { employee_number: 'T1', last_working_day: '2026-10-20', status: 'cancelled' }],
      leaves: [{ 'Employee Number': 'T1', 'Start Date': '2026-10-12', days: 3, status: 'Approved' }, { 'Employee Number': 'K1', 'Start Date': '2026-09-12', days: 9, status: 'Approved' }],
      absences: [{ employee_number: 'U1', start_date: '2026-10-02', days: 1, status: 'recorded' }],
      casualDays: [
        { employee_number: 'U1', work_date: '2026-10-01', portion: 'full' },
        { employee_number: 'U1', work_date: '2026-10-02', portion: 'half' },
        { employee_number: 'U1', work_date: '2026-10-03', portion: 'absent' },
      ],
    });

  it('adds up headcount across countries, with each country and branch', () => {
    const r = hr();
    expect(r.headcount.total).toBe(4);
    expect(r.headcount.byCountry).toEqual([
      { country: 'Kenya', count: 2, branches: [{ name: 'Mombasa', count: 1 }, { name: 'Nairobi HQ', count: 1 }] },
      { country: 'Tanzania', count: 1, branches: [{ name: 'Dar es Salaam', count: 1 }] },
      { country: 'Uganda', count: 1, branches: [{ name: 'Kampala', count: 1 }] },
    ]);
    const m = Object.fromEntries(r.metrics.map((x) => [x.key, x.breakdown.total]));
    expect(m).toEqual({ joiners: 1, leavers: 1, leave: 3, absence: 1, 'casual-days': 1.5, casuals: 1, 'piece-rate': 1 });
    expect(r.turnover.total).toBe(25);
    expect(r.turnover.byCountry).toEqual([{ country: 'Kenya', percent: 50 }, { country: 'Tanzania', percent: 0 }, { country: 'Uganda', percent: 0 }]);
  });

  it('narrows to a country or branch', () => {
    expect(hr('country:Kenya').headcount.total).toBe(2);
    expect(hr('branch:b-kla').metrics.find((x) => x.key === 'casual-days')?.breakdown.total).toBe(1.5);
    expect(hr('country:Tanzania').metrics.find((x) => x.key === 'leave')?.breakdown.total).toBe(3);
  });

  it('reads months from the date formats the app keeps', () => {
    expect([monthOf('2026-10-05'), monthOf('05/10/2026'), monthOf(''), monthOf('nope')]).toEqual(['2026-10', '2026-10', '', '']);
  });
});

describe('the Excel workbook', () => {
  it('has one sheet per country and the summary by currency, with no total across currencies', () => {
    const book = XLSX.read(payrollSummaryWorkbook(payrollSummary(lines()), '2026-10'), { type: 'array' });
    expect(book.SheetNames).toEqual(['Kenya (KES)', 'Tanzania (TZS)', 'Uganda (UGX)', SUMMARY_SHEET]);
    const summary = XLSX.utils.sheet_to_json<(string | number)[]>(book.Sheets[SUMMARY_SHEET], { header: 1 });
    expect(summary[1][0]).toMatch(/Totals are shown per currency/);
    const data = summary.slice(4);
    expect(data.map((r) => [r[0], r[8]])).toEqual([['KES', 109305], ['TZS', 1500000], ['UGX', 1069250]]);
    const kenya = XLSX.utils.sheet_to_json<(string | number)[]>(book.Sheets['Kenya (KES)'], { header: 1 });
    expect(kenya.find((r) => r[0] === 'Net pay')?.[1]).toBe(109305);
    expect(kenya.find((r) => r[0] === 'K1')).toBeTruthy();
  });
});
