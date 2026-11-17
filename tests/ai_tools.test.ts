// @vitest-environment node
//
// The HR assistant's tools (ai_tools.js) read with the service key, which bypasses row-level security, so these tests
// check that every read is pinned to the caller's company, that bank details never reach the model, that the "what if"
// gives the payroll engine's own figures, and that generated/statutoryCalc.js is the current statutoryCalc.ts.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { statutoryFor } from '../src/lib/statutoryCalc';
import { KENYA_RATES } from '../src/lib/payroll/countries/kenyaFixtures';

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  queries: [] as { table: string; filters: [string, string, unknown][] }[],
}));

// a small fake of the Supabase query builder: eq / is filters, order, range and limit, then await
vi.mock('../admin_routes.js', () => {
  const from = (table: string) => {
    const filters: [string, string, unknown][] = [];
    let order: { col: string; asc: boolean } | null = null;
    let slice: [number, number] | null = null;
    db.queries.push({ table, filters });
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (k: string, v: unknown) => (filters.push(['eq', k, v]), b),
      is: (k: string, v: unknown) => (filters.push(['is', k, v]), b),
      order: (col: string, o?: { ascending?: boolean }) => ((order = { col, asc: o?.ascending !== false }), b),
      range: (a: number, z: number) => ((slice = [a, z + 1]), b),
      limit: (n: number) => ((slice = [0, n]), b),
      then: (resolve: (v: unknown) => void) => {
        let rows = (db.tables[table] ?? []).filter((r) => filters.every(([, k, v]) => (r[k] ?? null) === v));
        if (order) {
          const { col, asc } = order;
          rows = [...rows].sort((x, y) => String(x[col]).localeCompare(String(y[col])) * (asc ? 1 : -1));
        }
        if (slice) rows = rows.slice(...slice);
        resolve({ data: rows, error: null });
      },
    };
    return b;
  };
  return { admin: { from } };
});
vi.mock('../authz.js', () => ({
  callerHasModule: async (caller: { modules: string[] }, wanted: string[]) => wanted.some((m) => caller.modules.includes(m)),
}));

// @ts-expect-error plain JavaScript server module
const tools = await import('../ai_tools.js');
// @ts-expect-error plain JavaScript build script
const build = await import('../scripts/build-server-lib.mjs');

const caller = { tenantId: 't-a', modules: ['payroll'] };
const run = async (name: string, args: unknown) => JSON.parse(await tools.runTool(caller, name, JSON.stringify(args)));

const rateRows = (tenant: string | null, rates: Record<string, unknown>) =>
  Object.entries(rates).map(([code, v]) => ({
    tenant_id: tenant, country: 'Kenya', code, effective_from: '2024-01-01', effective_to: null,
    value: Array.isArray(v) ? null : v, bands: Array.isArray(v) ? v : null,
  }));

beforeEach(() => {
  db.queries = [];
  db.tables = {
    employees: [
      { tenant_id: 't-a', 'Employee Number': 'A-001', 'First Name': 'Jane', 'Last Name': 'Wanjiru', 'Job Title': 'Accountant', 'Employee Type': 'Permanent', 'ID Number': 12345678 },
      { tenant_id: 't-a', 'Employee Number': 'A-002', 'First Name': 'Peter', 'Last Name': 'Otieno', 'Employee Type': 'Casual' },
      { tenant_id: 't-b', 'Employee Number': 'B-001', 'First Name': 'Jane', 'Last Name': 'Elsewhere' },
    ],
    salary_history: [
      { tenant_id: 't-a', employee_id: 'A-001', pay_period: '2026-09', gross_pay: 80000, net_pay: 60000, paye_tax: 12000, bank_name: 'KCB', account_number: '0011223344' },
      { tenant_id: 't-a', employee_id: 'A-001', pay_period: '2026-10', gross_pay: 85000, net_pay: 63000, paye_tax: 13000, bank_name: 'KCB', account_number: '0011223344' },
      { tenant_id: 't-b', employee_id: 'A-001', pay_period: '2026-10', gross_pay: 1, net_pay: 1, paye_tax: 0 },
    ],
    statutory_rates: [...rateRows(null, KENYA_RATES), ...rateRows('t-b', { personal_relief: 999999 })],
  };
});

describe('who may use the tools', () => {
  it('needs the Payroll module', async () => {
    expect(await tools.callerMayUseTools(caller)).toBe(true);
    expect(await tools.callerMayUseTools({ tenantId: 't-a', modules: ['ai-assistant'] })).toBe(false);
  });
});

describe('find_employees', () => {
  it("finds the caller's own company's employees only, without ID numbers or pay", async () => {
    const { matches } = await run('find_employees', { query: 'jane' });
    expect(matches).toEqual([expect.objectContaining({ employee_number: 'A-001', name: 'Jane Wanjiru', job_title: 'Accountant', employee_type: 'Permanent' })]);
    expect(JSON.stringify(matches)).not.toContain('12345678');
    expect(db.queries.every((q) => q.filters.some(([, k, v]) => k === 'tenant_id' && v === 't-a'))).toBe(true);
  });

  it('asks for more than one letter', async () => {
    expect((await run('find_employees', { query: 'j' })).error).toMatch(/2 letters/);
  });
});

describe('get_payslips', () => {
  it("returns the caller's company's payslips, newest first, never the bank details", async () => {
    const { payslips } = await run('get_payslips', { employee_number: 'A-001' });
    expect(payslips.map((p: { pay_period: string }) => p.pay_period)).toEqual(['2026-10', '2026-09']);
    expect(payslips[0]).toMatchObject({ gross_pay: 85000, net_pay: 63000, paye_tax: 13000 });
    expect(JSON.stringify(payslips)).not.toMatch(/KCB|0011223344/);
    expect(payslips.some((p: { gross_pay: number }) => p.gross_pay === 1)).toBe(false); // the other company's
  });

  it("works out a Kenyan payslip's employer NSSF and housing levy shares from the month's rates, as payroll does", async () => {
    db.tables.salary_history.push({ tenant_id: 't-a', employee_id: 'A-002', pay_period: '2026-10', country: 'Kenya', nssf_deduction: 3121.56, housing_levy: 780.39, employer_nssf: 0 });
    const [slip] = (await run('get_payslips', { employee_number: 'A-002' })).payslips;
    expect(slip.employer_nssf).toBe(3121.56); // not the 0 saved on the row
    expect(slip.employer_housing_levy).toBe(780.39);
    db.tables.statutory_rates.push(...rateRows('t-a', { nssf_employer_rate: 0.12 }));
    expect((await run('get_payslips', { employee_number: 'A-002' })).payslips[0].employer_nssf).toBe(6243.12);
    expect(tools.kenyaEmployerShare(100, {}, 'nssf_rate', 'nssf_employer_rate')).toBe(100); // no rates: matches
  });

  it('gives one pay period when asked, and checks its format', async () => {
    expect((await run('get_payslips', { employee_number: 'A-001', pay_period: '2026-09' })).payslips).toHaveLength(1);
    expect((await run('get_payslips', { employee_number: 'A-001', pay_period: 'Sept' })).error).toMatch(/YYYY-MM/);
    expect((await run('get_payslips', { employee_number: 'A-404' })).payslips).toEqual([]);
  });
});

describe('calculate_kenya_pay', () => {
  it("gives the payroll engine's own figures, with the default rates (not another company's)", async () => {
    const out = await run('calculate_kenya_pay', { pay_period: '2026-10', gross_pay: 100000, pension: 5000, insurance_premium: 2000, voluntary_deductions: 10000 });
    const engine = statutoryFor({ cashPay: 100000, nonTaxableCashPay: 0, benefits: { car: 0, housing: 0, meals: 0, nonCash: 0, other: 0 }, pension: 5000, prmf: 0, mortgageInterest: 0, insurancePremium: 2000, isPwd: false }, KENYA_RATES);
    expect(out).toMatchObject(engine);
    expect(out.personalRelief).toBe(2400);
    const statutory = engine.nssf + engine.shif + engine.ahl + engine.paye;
    expect(out.net_pay).toBeCloseTo(100000 - statutory - 10000, 2);
    expect(out.within_two_thirds_limit).toBe(true);
  });

  it("uses the company's own rate where it has one", async () => {
    db.tables.statutory_rates.push(...rateRows('t-a', { personal_relief: 3000 }));
    expect((await run('calculate_kenya_pay', { pay_period: '2026-10', gross_pay: 100000 })).personalRelief).toBe(3000);
  });

  it('flags deductions over two-thirds of pay (Employment Act s.19(3))', async () => {
    expect((await run('calculate_kenya_pay', { pay_period: '2026-10', gross_pay: 30000, voluntary_deductions: 20000 })).within_two_thirds_limit).toBe(false);
  });

  it('says so when the month has no PAYE bands, and rejects bad input', async () => {
    db.tables.statutory_rates = [];
    expect((await run('calculate_kenya_pay', { pay_period: '2026-10', gross_pay: 1000 })).error).toMatch(/PAYE bands/);
    expect((await run('calculate_kenya_pay', { gross_pay: 0 })).error).toMatch(/gross_pay/);
  });
});

describe('runTool', () => {
  it('never throws: unknown tools and bad arguments come back as errors for the model', async () => {
    expect(JSON.parse(await tools.runTool(caller, 'delete_everything', '{}')).error).toMatch(/Unknown tool/);
    expect(JSON.parse(await tools.runTool(caller, 'get_payslips', '{not json')).error).toMatch(/not valid JSON/);
  });
});

describe('generated/statutoryCalc.js', () => {
  it('is up to date with src/lib/statutoryCalc.ts (run `npm run build:server-lib`)', () => {
    expect(readFileSync(build.OUTPUT, 'utf8').replace(/\r\n/g, '\n')).toBe(build.buildStatutoryCalc());
  });
});
