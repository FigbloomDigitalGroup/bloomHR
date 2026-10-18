// @vitest-environment node
//
// Tanzania payroll (FIG-905 stage 3, migration 20261021000000_tanzania_payroll.sql): Tanzania's statutory rates seeded
// as dated data (in force from 1 July 2023, not before; Kenya's untouched), a company's own Tanzania rate, the
// employee fields, the payslip columns, piece rate payouts for a Tanzania worker holding back the reserve only (no
// Kenyan housing levy) and a Tanzania contractor's withholding tax at Tanzania's rate, and running the migration again.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const PAY = '00000000-0000-0000-0000-00000000f001';

const MIGRATION = join(__dirname, '..', 'migrations', '20261021000000_tanzania_payroll.sql');
const TODAY = `(now() at time zone 'Africa/Nairobi')::date`;
/** day n of last month */
const day = (n: number) => `((date_trunc('month', ${TODAY}) - interval '1 month')::date + ${n - 1})`;

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
type Rates = Record<string, unknown>;
const ratesOn = async (d: string, country: string) =>
  (await read<{ r: Rates }>(PAY, `select statutory_rates_on('${d}', '${country}') r`))[0].r;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${PAY}', 'pay@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${PAY}', 'pay@a.co', 'FINANCE', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values ('FINANCE', array['work-records', 'payroll'], '${A}');
    insert into branches (tenant_id, name, country) values ('${A}', 'Dar es Salaam', 'Tanzania');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", worker_kind, pay_basis, pay_frequency, wht_category,
                           payment_method, "Mobile Number", onboarding_status, "Branch", kra_residency, tenant_id) values
      ('P1', 'Pauline', 'Pay', 'pay@a.co', 'employee', 'salary', 'monthly', null, null, null, 'approved', null, null, '${A}'),
      ('K1', 'Kamau', 'K', 'k1@a.co', 'employee', 'work', 'daily', null, 'M-Pesa', '0712345678', 'approved', null, null, '${A}'),
      ('T1', 'Tumaini', 'T', 't1@a.co', 'employee', 'work', 'daily', null, 'M-Pesa', '0712345679', 'approved', 'Dar es Salaam', null, '${A}'),
      ('TC', 'Tatu', 'C', 'tc@a.co', 'contractor', 'work', 'daily', 'contractual', 'M-Pesa', '0712345680', 'approved', 'Dar es Salaam', null, '${A}'),
      ('TN', 'Neema', 'N', 'tn@a.co', 'contractor', 'work', 'daily', 'contractual', 'M-Pesa', '0712345681', 'approved', 'Dar es Salaam', 'Non-Resident', '${A}');
  `);
  // (the branch is matched by name; set branch_id from it as the app does)
  await db.exec(`update employees set branch_id = (select id from branches where name = 'Dar es Salaam') where "Branch" = 'Dar es Salaam'`);
  await as(PAY, `insert into work_types (name, unit, rate) values ('Crates', 'crate', 100)`);
  for (const emp of ['K1', 'T1', 'TC', 'TN']) {
    await as(PAY, `insert into work_entries (employee_number, work_date, work_type_id, quantity, status)
                   values ('${emp}', ${day(3)}, (select id from work_types where name = 'Crates'), 100, 'submitted')`);
  }
  await db.exec(`update work_entries set status = 'approved' where status <> 'approved'`);
}, 120000);

describe("Tanzania's statutory rates", () => {
  it('are seeded from 1 July 2023 with every code the engine needs', async () => {
    const r = await ratesOn('2026-10-31', 'Tanzania');
    expect(r).toMatchObject({
      nonresident_paye_rate: 0.15, secondary_paye_rate: 0.3, nssf_rate: 0.1, nssf_employer_rate: 0.1, nssf_deductible: 1,
      sdl_rate: 0.035, sdl_min_employees: 10, wcf_rate: 0.005, heslb_rate: 0.15, wht_resident: 0.05, wht_nonresident: 0.15,
    });
    expect(r.paye_bands).toEqual([
      { upto: 270000, rate: 0 }, { upto: 520000, rate: 0.08 }, { upto: 760000, rate: 0.2 }, { upto: 1000000, rate: 0.25 }, { upto: null, rate: 0.3 },
    ]);
    expect(await ratesOn('2023-07-01', 'Tanzania')).toMatchObject({ sdl_rate: 0.035 });
    // not before the date they are seeded from
    expect(await ratesOn('2023-06-30', 'Tanzania')).toEqual({});
  });

  it("leave Kenya's rates as they were", async () => {
    const ke = await ratesOn('2026-10-31', 'Kenya');
    expect(ke.sdl_rate).toBeUndefined();
    expect(ke.nssf_rate).toBe(0.06);
    expect((ke.paye_bands as { upto: number }[])[0].upto).toBe(24000);
  });

  it('every default has its source', async () => {
    const missing = await rows(`select code from statutory_rates where country = 'Tanzania' and tenant_id is null and coalesce(source, '') = ''`);
    expect(missing).toEqual([]);
  });

  it("a company can set its own Tanzania rate from a date (an SDL-exempt employer, the SDL threshold)", async () => {
    await as(PAY, `insert into statutory_rates (tenant_id, country, code, value, effective_from, source) values ('${A}', 'Tanzania', 'sdl_rate', 0, '2026-10-01', 'Exempt: charity ruling')`);
    await as(PAY, `insert into statutory_rates (tenant_id, country, code, value, effective_from) values ('${A}', 'Tanzania', 'sdl_min_employees', 20, '2026-10-01')`);
    expect(await ratesOn('2026-10-31', 'Tanzania')).toMatchObject({ sdl_rate: 0, sdl_min_employees: 20 });
    expect(await ratesOn('2026-09-30', 'Tanzania')).toMatchObject({ sdl_rate: 0.035, sdl_min_employees: 10 });
    await db.exec(`delete from statutory_rates where tenant_id = '${A}' and country = 'Tanzania'`);
  });
});

describe("employees' Tanzania details and payslip columns", () => {
  it('adds the TIN, NSSF (Tanzania) number, HESLB borrower and index number, and secondary employment (defaults off)', async () => {
    const t1 = (await rows<Record<string, unknown>>(`select tz_tin, tz_nssf_number, heslb_borrower, heslb_index_number, secondary_employment from employees where "Employee Number" = 'T1'`))[0];
    expect(t1).toEqual({ tz_tin: null, tz_nssf_number: null, heslb_borrower: false, heslb_index_number: null, secondary_employment: false });
    await as(PAY, `update employees set tz_tin = '123-456-789', tz_nssf_number = '1002 003 004', heslb_borrower = true, heslb_index_number = 's0101/0001/2010' where "Employee Number" = 'T1'`);
    const saved = (await rows<Record<string, unknown>>(`select tz_tin, tz_nssf_number, heslb_borrower, heslb_index_number from employees where "Employee Number" = 'T1'`))[0];
    expect(saved).toEqual({ tz_tin: '123456789', tz_nssf_number: '1002003004', heslb_borrower: true, heslb_index_number: 'S0101/0001/2010' });
  });

  it('checks the TIN is 9 digits and unique in the company', async () => {
    await expect(as(PAY, `update employees set tz_tin = '12345' where "Employee Number" = 'TC'`)).rejects.toThrow(/TIN "12345" should be 9 digits/);
    await expect(as(PAY, `update employees set tz_tin = '123 456 789' where "Employee Number" = 'TC'`)).rejects.toThrow(/already has TIN 123456789/);
    // a Kenyan's KRA PIN is still checked as before
    await expect(as(PAY, `update employees set "Tax PIN" = '123456789' where "Employee Number" = 'K1'`)).rejects.toThrow(/KRA PIN/);
  });

  it("saves a Tanzania payslip's HESLB repayment, employer costs and taxable pay, in TZS", async () => {
    const m = (await rows<{ m: string }>(`select to_char(${day(1)}, 'YYYY-MM') m`))[0].m;
    await as(PAY, `insert into salary_history (employee_id, employee_name, pay_period, gross_pay, net_pay, total_deductions, paye_tax, nssf_deduction,
                     heslb_deduction, nssf_employer, sdl_levy, wcf_levy, taxable_pay, tax_resident, tenant_id)
                   values ('T1', 'Tumaini T', '${m}', 1500000, 892000, 608000, 233000, 150000, 225000, 150000, 52500, 7500, 1350000, true, '${A}')`);
    const slip = (await rows<Record<string, unknown>>(
      `select country, currency, heslb_deduction, nssf_employer, sdl_levy, wcf_levy, taxable_pay, tax_resident, nita_levy from salary_history where employee_id = 'T1'`
    ))[0];
    expect(slip).toEqual({
      country: 'Tanzania', currency: 'TZS', heslb_deduction: '225000.00', nssf_employer: '150000.00', sdl_levy: '52500.00', wcf_levy: '7500.00',
      taxable_pay: '1350000.00', tax_resident: true, nita_levy: '0.00',
    });
    await expect(as(PAY, `update salary_history set sdl_levy = -1 where employee_id = 'T1'`)).rejects.toThrow(/salary_history_tz_amounts/);
    await as(PAY, `delete from salary_history where employee_id = 'T1'`);
  });
});

describe('piece rate payouts for Tanzania workers', () => {
  it("hold back the reserve only (no Kenyan housing levy), and a contractor's WHT at Tanzania's rate", async () => {
    const id = (await read<{ id: string }>(PAY, `select create_work_payout_batch('daily', ${day(1)}, ${day(10)}) id`))[0].id;
    const lines = await rows<{ employee_number: string; gross: string; ahl: string; reserve: string; wht: string; wht_rate: string; net: string; rounding: string }>(
      `select employee_number, gross, ahl, reserve, wht, wht_rate, net, rounding from work_payout_lines where batch_id = '${id}' order by employee_number`
    );
    const by = Object.fromEntries(lines.map((l) => [l.employee_number, l]));
    // Kenya: AHL 1.5% of 10,000 and the 10% reserve, as before
    expect([by.K1.ahl, by.K1.reserve, by.K1.net]).toEqual(['150.00', '1000.00', '8850.00']);
    // Tanzania employee: the reserve only
    expect([by.T1.ahl, by.T1.reserve, by.T1.wht, by.T1.net]).toEqual(['0.00', '1000.00', '0.00', '9000.00']);
    // Tanzania contractors: 5% resident, 15% non-resident (no reserve unless the company holds one back for contractors)
    expect([by.TC.wht_rate, by.TC.wht, by.TC.ahl]).toEqual(['0.0500', '500.00', '0.00']);
    expect([by.TN.wht_rate, by.TN.wht]).toEqual(['0.1500', '1500.00']);
    for (const l of lines) {
      expect(Number(l.net) + Number(l.ahl) + Number(l.reserve) + Number(l.wht) + Number(l.rounding)).toBe(Number(l.gross));
    }
  });
});

describe('running the migration again', () => {
  it('changes nothing', async () => {
    const before = await rows(`select code, value, bands, effective_from from statutory_rates where country = 'Tanzania' order by code, effective_from`);
    const people = await rows(`select "Employee Number", tz_tin, tz_nssf_number, heslb_borrower from employees order by 1`);
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    expect(await rows(`select code, value, bands, effective_from from statutory_rates where country = 'Tanzania' order by code, effective_from`)).toEqual(before);
    expect(await rows(`select "Employee Number", tz_tin, tz_nssf_number, heslb_borrower from employees order by 1`)).toEqual(people);
    expect(before.length).toBe(12);
  });
});
