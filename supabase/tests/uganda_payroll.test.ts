// @vitest-environment node
//
// Uganda payroll (FIG-905 stage 4, migration 20261021100000_uganda_payroll.sql): Uganda's dated statutory rates (the
// 2026 PAYE bands from 1 July 2026, the bands before, NSSF, LST), the employee details by country (a URA TIN in
// "Tax PIN", NSSF Uganda numbers, the NIN, no SHA number), LST paid per employee per financial year, the LST
// collection setting, payouts holding back the reserve only for Ugandan workers (one currency per payout), and running
// the migration again.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const PAY = '00000000-0000-0000-0000-00000000f101';
const STAFF = '00000000-0000-0000-0000-00000000f102';

const MIGRATION = join(__dirname, '..', 'migrations', '20261021100000_uganda_payroll.sql');
const TODAY = `(now() at time zone 'Africa/Nairobi')::date`;
/** day n of last month */
const day = (n: number) => `((date_trunc('month', ${TODAY}) - interval '1 month')::date + ${n - 1})`;

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const ugRates = (onDay: string) => read<{ r: Record<string, unknown> }>(PAY, `select statutory_rates_on('${onDay}', 'Uganda') r`).then((x) => x[0].r);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${PAY}', 'pay@a.co'), ('${STAFF}', 'staff@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${PAY}', 'pay@a.co', 'FINANCE', '${A}'), ('${STAFF}', 'staff@a.co', 'STAFF', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values ('FINANCE', array['work-records', 'payroll', 'employees'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into branches (tenant_id, name, country) values ('${A}', 'Kampala', 'Uganda');
  `);
}, 120000);

describe("Uganda's statutory rates", () => {
  it('has the 2026 resident PAYE bands from 1 July 2026, and the bands before for earlier months', async () => {
    const now = await ugRates('2026-10-31');
    expect(now.paye_bands).toEqual([
      { upto: 335000, rate: 0 },
      { upto: 410000, rate: 0.2 },
      { upto: 485000, rate: 0.25 },
      { upto: null, rate: 0.3 },
    ]);
    const before = await ugRates('2026-06-30');
    expect(before.paye_bands).toEqual([
      { upto: 235000, rate: 0 },
      { upto: 335000, rate: 0.1 },
      { upto: 410000, rate: 0.2 },
      { upto: null, rate: 0.3 },
    ]);
    expect(now.paye_bands_non_resident).toEqual([{ upto: 335000, rate: 0.1 }, { upto: 410000, rate: 0.2 }, { upto: null, rate: 0.3 }]);
    expect(now).toMatchObject({
      paye_surcharge_threshold: 10000000, paye_surcharge_rate: 0.1, nssf_rate: 0.05, nssf_employer_rate: 0.1, nssf_deductible: 0,
      lst_deductible: 1, lst_first_month: 7, lst_months: 4, wht_contractual: 0.06, wht_professional: 0.06,
    });
    expect((now.lst_bands as { upto: number | null; amount: number }[]).map((b) => [b.upto, b.amount])).toEqual([
      [100000, 0], [200000, 5000], [300000, 10000], [400000, 20000], [500000, 30000], [600000, 40000], [700000, 60000],
      [800000, 70000], [900000, 80000], [1000000, 90000], [null, 100000],
    ]);
  });

  it("are Uganda's own: Kenya's rates are unchanged and have none of them", async () => {
    const ke = await read<{ r: Record<string, unknown> }>(PAY, `select statutory_rates_on('2026-10-31', 'Kenya') r`).then((x) => x[0].r);
    expect(ke.nssf_rate).toBe(0.06);
    expect(ke.lst_bands).toBeUndefined();
    expect((ke.paye_bands as unknown[]).length).toBe(5);
  });

  it('a company can give itself its own Uganda rate from a date', async () => {
    await as(PAY, `insert into statutory_rates (tenant_id, country, code, value, effective_from, source) values ('${A}', 'Uganda', 'nssf_employer_rate', 0.12, '2026-11-01', 'Company scheme')`);
    expect((await ugRates('2026-11-30')).nssf_employer_rate).toBe(0.12);
    expect((await ugRates('2026-10-31')).nssf_employer_rate).toBe(0.1);
    await db.exec(`delete from statutory_rates where tenant_id = '${A}' and code = 'nssf_employer_rate'`);
  });
});

describe('employee details in Uganda', () => {
  it('takes a URA TIN, an NSSF Uganda number and a NIN for staff in a Ugandan branch', async () => {
    await as(PAY, `insert into employees ("Employee Number", "First Name", "Last Name", "Branch", "Tax PIN", "NSSF Number", "Type of Identification", "ID Number", kra_residency)
                   values ('UG1', 'Akello', 'Grace', 'Kampala', '1000123456', 'NS12345678', 'National ID', 'CF90012345ABCD', 'Non-Resident')`);
    const e = (await rows<Record<string, unknown>>(`select "Tax PIN", "NSSF Number", "ID Number", kra_residency, lst_exempt from employees where "Employee Number" = 'UG1'`))[0];
    expect(e).toEqual({ 'Tax PIN': '1000123456', 'NSSF Number': 'NS12345678', 'ID Number': 'CF90012345ABCD', kra_residency: 'Non-Resident', lst_exempt: false });
  });

  it('refuses a KRA PIN in Uganda and a TIN in Kenya, naming the right number', async () => {
    await expect(as(PAY, `update employees set "Tax PIN" = 'A012345678Z' where "Employee Number" = 'UG1'`)).rejects.toThrow(/TIN "A012345678Z" should be 10 digits/);
    await expect(as(PAY, `insert into employees ("Employee Number", "First Name", "Tax PIN") values ('KE1', 'Kamau', '1000123457')`)).rejects.toThrow(
      /KRA PIN "1000123457" should look like A123456789B/
    );
    await as(PAY, `insert into employees ("Employee Number", "First Name", "Tax PIN", "NSSF Number") values ('KE1', 'Kamau', 'A012345678Z', '123456789')`);
    await expect(as(PAY, `update employees set "NSSF Number" = 'NS1' where "Employee Number" = 'UG1'`)).rejects.toThrow(/should be 6 to 15 letters and digits/);
  });

  it('asks a Ugandan employee for a TIN and no SHA number when onboarding', async () => {
    await as(PAY, `insert into employees ("Employee Number", "First Name", "Branch") values ('UG2', 'Okello', 'Kampala')`);
    const m = (await rows<{ m: string[] }>(`select onboarding_missing_details(e, 'employee') m from employees e where "Employee Number" = 'UG2'`))[0].m;
    expect(m).toContain('TIN');
    expect(m).toContain('NSSF number');
    expect(m).not.toContain('KRA PIN');
    expect(m).not.toContain('SHA number');
    const ke = (await rows<{ m: string[] }>(`select onboarding_missing_details(e, 'employee') m from employees e where "Employee Number" = 'KE1'`))[0].m;
    expect(ke).toContain('SHA number');
    expect(ke).not.toContain('TIN');
  });

  it('marks someone exempt from LST', async () => {
    await as(PAY, `update employees set lst_exempt = true where "Employee Number" = 'UG2'`);
    expect((await rows<{ x: boolean }>(`select lst_exempt x from employees where "Employee Number" = 'UG2'`))[0].x).toBe(true);
  });
});

describe('LST paid per employee per financial year', () => {
  const slip = (period: string, lst: number, emp = 'UG1') =>
    `insert into salary_history (employee_id, employee_name, pay_period, gross_pay, net_pay, lst_deduction, employer_nssf, taxable_pay, tenant_id)
     values ('${emp}', '${emp}', '${period}', 1500000, 1000000, ${lst}, 150000, 1475000, '${A}')`;

  it("adds up the year's other payslips and what was paid elsewhere, never the month being worked out", async () => {
    await db.exec(`update employees set onboarding_status = 'approved' where "Employee Number" in ('UG1', 'UG2')`);
    await as(PAY, `${slip('2026-06', 25000)}; ${slip('2026-07', 25000)}; ${slip('2026-08', 25000)}; ${slip('2026-09', 25000)}`);
    const got = (await rows<{ country: string; currency: string }>(`select country, currency from salary_history where employee_id = 'UG1' and pay_period = '2026-07'`))[0];
    expect(got).toEqual({ country: 'Uganda', currency: 'UGX' });
    const paid = (period: string) => read<{ employee_number: string; paid: string }>(PAY, `select * from lst_paid_this_year('${period}') order by 1`);
    // October: July to September (June is last financial year)
    expect(await paid('2026-10')).toEqual([{ employee_number: 'UG1', paid: '75000.00' }]);
    // working September out again doesn't count September
    expect(await paid('2026-09')).toEqual([{ employee_number: 'UG1', paid: '50000.00' }]);
    // June is in 2025/26
    expect(await paid('2026-06')).toEqual([]);
    // LST paid with another employer this year
    await as(PAY, `insert into lst_years (employee_number, fy_start, paid_elsewhere, note) values ('UG2', 2026, 40000, 'Paid with previous employer')`);
    expect(await paid('2026-10')).toEqual([
      { employee_number: 'UG1', paid: '75000.00' },
      { employee_number: 'UG2', paid: '40000.00' },
    ]);
    // one row per employee per year
    await expect(as(PAY, `insert into lst_years (employee_number, fy_start, paid_elsewhere) values ('UG2', 2026, 1)`)).rejects.toThrow(/duplicate key/);
  });

  it('is payroll-only', async () => {
    await expect(read(STAFF, `select * from lst_paid_this_year('2026-10')`)).rejects.toThrow(/Only payroll/);
    expect(await read(STAFF, `select * from lst_years`)).toEqual([]);
  });

  it('works out the financial year a period is in', async () => {
    const r = await rows<{ a: number; b: number; c: number }>(`select ug_fy_start('2026-07') a, ug_fy_start('2027-06') b, ug_fy_start('2026-06') c`);
    expect(r[0]).toEqual({ a: 2026, b: 2026, c: 2025 });
  });
});

describe('the LST collection setting', () => {
  it('is four instalments by default, or a lump sum', async () => {
    await as(PAY, `insert into company_payroll_settings (tenant_id) values ('${A}') on conflict (tenant_id) do nothing`);
    expect((await read<{ c: string }>(PAY, `select lst_collection c from company_payroll_settings`))[0].c).toBe('instalments');
    await as(PAY, `update company_payroll_settings set lst_collection = 'lump_sum'`);
    expect((await read<{ c: string }>(PAY, `select lst_collection c from company_payroll_settings`))[0].c).toBe('lump_sum');
    await expect(as(PAY, `update company_payroll_settings set lst_collection = 'monthly'`)).rejects.toThrow(/lst_collection_check/);
  });
});

describe('piece rate payouts in Uganda', () => {
  it('hold back the reserve only (no housing levy) for a Ugandan worker, and the levy for a Kenyan one', async () => {
    await db.exec(`
      insert into employees ("Employee Number", "First Name", "Branch", worker_kind, pay_basis, pay_frequency, onboarding_status, "Tax PIN", tenant_id) values
        ('UW1', 'Wasswa', 'Kampala', 'employee', 'work', 'daily', 'approved', '1000999999', '${A}'),
        ('KW1', 'Wanjiku', null, 'employee', 'work', 'daily', 'approved', 'A099999999Z', '${A}');
    `);
    await as(PAY, `insert into work_types (name, unit, rate) values ('Bags', 'bag', 1000)`);
    for (const emp of ['UW1', 'KW1']) {
      await as(PAY, `insert into work_entries (employee_number, work_date, work_type_id, quantity, status)
                     values ('${emp}', ${day(2)}, (select id from work_types where name = 'Bags'), 100, 'submitted')`);
    }
    await db.exec(`update work_entries set status = 'approved' where status <> 'approved'`);
    // one currency per payout: Kenyan and Ugandan workers together are refused, so payroll makes one per country
    await expect(as(PAY, `select create_work_payout_batch('daily', ${day(1)}, ${day(3)})`)).rejects.toThrow(/would mix KES \(Kenya\) and UGX \(Uganda\)/);
    await as(PAY, `select create_work_payout_batch('daily', ${day(1)}, ${day(3)}, null, null, 'Uganda')`);
    await as(PAY, `select create_work_payout_batch('daily', ${day(1)}, ${day(3)}, null, null, 'Kenya')`);
    expect(await rows(`select country, currency, worker_count from work_payout_batches order by currency`)).toEqual([
      { country: 'Kenya', currency: 'KES', worker_count: 1 },
      { country: 'Uganda', currency: 'UGX', worker_count: 1 },
    ]);
    const lines = await rows<{ employee_number: string; gross: string; ahl: string; reserve: string; net: string }>(
      `select employee_number, gross, ahl, reserve, net from work_payout_lines order by employee_number`
    );
    expect(lines.map((l) => [l.employee_number, Number(l.gross), Number(l.ahl), Number(l.reserve), Number(l.net)])).toEqual([
      ['KW1', 100000, 1500, 10000, 88500],
      ['UW1', 100000, 0, 10000, 90000],
    ]);
  });
});

describe('running the migration again', () => {
  it('changes nothing', async () => {
    const rates = await rows(`select code, value, bands, effective_from, effective_to from statutory_rates where country = 'Uganda' order by code, effective_from`);
    const years = await rows(`select employee_number, fy_start, paid_elsewhere from lst_years order by 1`);
    const settings = await rows(`select lst_collection from company_payroll_settings`);
    const batches = await rows(`select id, country, currency, net_total from work_payout_batches order by id`);
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    expect(await rows(`select id, country, currency, net_total from work_payout_batches order by id`)).toEqual(batches);
    expect(await rows(`select code, value, bands, effective_from, effective_to from statutory_rates where country = 'Uganda' order by code, effective_from`)).toEqual(rates);
    expect(rates.length).toBe(14);
    expect(await rows(`select employee_number, fy_start, paid_elsewhere from lst_years order by 1`)).toEqual(years);
    expect(await rows(`select lst_collection from company_payroll_settings`)).toEqual(settings);
  });
});
