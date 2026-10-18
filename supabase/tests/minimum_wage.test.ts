// @vitest-environment node
//
// Piece rate stage 6 (FIG-812): the minimum wage check's data. One monthly amount per country, entered by each
// company: who may read and write it, the right amount for a date (effective dating), the currency by country, the
// country from the company, per-day minimums, the month's work days, company isolation, running the migration again.
// Migration 20261020400000.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const PAY = '00000000-0000-0000-0000-00000000f001';
const HR = '00000000-0000-0000-0000-00000000f002';
const WORK = '00000000-0000-0000-0000-00000000f003';
const STAFF = '00000000-0000-0000-0000-00000000f004';
const OTHER = '00000000-0000-0000-0000-00000000f005';

const MIGRATION = join(__dirname, '..', 'migrations', '20261020400000_minimum_wage.sql');

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const one = async <T = Record<string, unknown>>(user: string, sql: string) => (await read<T>(user, sql))[0];

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co') on conflict do nothing;
    insert into auth.users (id, email) values ('${PAY}', 'pay@a.co'), ('${HR}', 'hr@a.co'), ('${WORK}', 'work@a.co'),
      ('${STAFF}', 'staff@a.co'), ('${OTHER}', 'x@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${PAY}', 'pay@a.co', 'FINANCE', '${A}'), ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${WORK}', 'work@a.co', 'SITE', '${A}'),
      ('${STAFF}', 'staff@a.co', 'STAFF', '${A}'), ('${OTHER}', 'x@b.co', 'FINANCE', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('FINANCE', array['payroll'], '${A}'), ('HR', array['employees'], '${A}'), ('SITE', array['work-records'], '${A}'),
      ('STAFF', array['dashboard'], '${A}'), ('FINANCE', array['payroll'], '${B}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", worker_kind, pay_basis, pay_frequency, tenant_id) values
      ('E1', 'Esther', 'Salary', 'e1@a.co', 'employee', 'salary', 'monthly', '${A}'),
      ('W1', 'Wanjiru', 'Work', 'w1@a.co', 'employee', 'work', 'daily', '${A}'),
      ('X1', 'Xena', 'Other', 'x1@b.co', 'employee', 'salary', 'monthly', '${B}');
    insert into company_profile (tenant_id, company_name) values ('${A}', 'A Co'), ('${B}', 'Other Co')
      on conflict (tenant_id) do nothing;
  `);
}, 120000);

describe('access', () => {
  it('payroll and HR add amounts; people who run work read them; other staff see nothing', async () => {
    await as(PAY, `insert into minimum_wages (country, monthly_amount, effective_from, notes) values ('Kenya', 15000, '2024-11-01', 'Wage order 2024')`);
    await as(HR, `insert into minimum_wages (country, monthly_amount, effective_from) values ('Kenya', 16000, '2026-05-01')`);
    await expect(as(WORK, `insert into minimum_wages (country, monthly_amount, effective_from) values ('Kenya', 1, '2026-01-01')`)).rejects.toThrow();
    await expect(as(STAFF, `insert into minimum_wages (country, monthly_amount, effective_from) values ('Kenya', 1, '2026-01-01')`)).rejects.toThrow();
    expect(await read(WORK, `select * from minimum_wages`)).toHaveLength(2);
    expect(await read(STAFF, `select * from minimum_wages`)).toHaveLength(0);
    await expect(read(STAFF, `select minimum_wage_settings()`)).rejects.toThrow(/Only payroll and HR/);
    // updates and deletes are payroll's and HR's only
    await as(WORK, `update minimum_wages set monthly_amount = 1`);
    expect((await rows<{ n: number }>(`select count(*)::int n from minimum_wages where monthly_amount = 1`))[0].n).toBe(0);
  });

  it('fills the currency from the country and refuses a second amount on the same day', async () => {
    await as(PAY, `insert into minimum_wages (country, monthly_amount, effective_from) values (' Tanzania ', 250000, '2026-01-01')`);
    await as(PAY, `insert into minimum_wages (country, monthly_amount, effective_from) values ('Uganda', 130000, '2026-01-01')`);
    const list = await read<{ country: string; currency: string }>(PAY, `select country, currency from minimum_wages order by country, effective_from`);
    expect(list).toEqual([
      { country: 'Kenya', currency: 'KES' }, { country: 'Kenya', currency: 'KES' },
      { country: 'Tanzania', currency: 'TZS' }, { country: 'Uganda', currency: 'UGX' },
    ]);
    await expect(as(PAY, `insert into minimum_wages (country, monthly_amount, effective_from) values ('kenya', 17000, '2026-05-01')`)).rejects.toThrow();
    await expect(as(PAY, `insert into minimum_wages (country, monthly_amount, effective_from) values ('Kenya', 0, '2026-06-01')`)).rejects.toThrow();
  });
});

describe('effective dating', () => {
  it('uses the latest amount that took effect on or before the day', async () => {
    const at = async (day: string) => (await one<{ s: { monthly_amount: number | null } }>(PAY, `select minimum_wage_settings('${day}') s`)).s.monthly_amount;
    expect(await at('2024-10-31')).toBeNull();
    expect(await at('2024-11-01')).toBe(15000);
    expect(await at('2026-04-30')).toBe(15000);
    expect(await at('2026-05-31')).toBe(16000);
  });

  it('works out the per-day minimum from the days setting (26 by default)', async () => {
    const s = (await one<{ s: Record<string, unknown> }>(PAY, `select minimum_wage_settings('2026-05-31') s`)).s;
    expect(s).toMatchObject({ enabled: true, days_per_month: 26, country: 'Kenya', currency: 'KES', per_day: 615.38, effective_from: '2026-05-01' });
    await as(PAY, `insert into company_payroll_settings (minimum_wage_days) values (20)
                   on conflict (tenant_id) do update set minimum_wage_days = 20`);
    expect((await one<{ s: { per_day: number } }>(PAY, `select minimum_wage_settings('2026-05-31') s`)).s.per_day).toBe(800);
    await expect(as(PAY, `update company_payroll_settings set minimum_wage_days = 0`)).rejects.toThrow();
    await as(PAY, `update company_payroll_settings set minimum_wage_days = 26`);
  });
});

describe('country from the company', () => {
  it('uses Kenya when the company has no country, and the company country when it has one', async () => {
    expect(await rows(`select employee_country('${A}', 'E1') c`)).toEqual([{ c: 'Kenya' }]);
    // a company with no profile yet
    expect(await rows(`select employee_country('00000000-0000-0000-0000-0000000000c3', 'E1') c`)).toEqual([{ c: 'Kenya' }]);
    const kenya = await read<{ employee_number: string; country: string; monthly_amount: string; per_day: string }>(PAY,
      `select * from employee_minimum_wages('2026-06-30') order by employee_number`);
    expect(kenya.map((r) => [r.employee_number, r.country, r.monthly_amount, r.per_day])).toEqual([
      ['E1', 'Kenya', '16000.00', '615.38'], ['W1', 'Kenya', '16000.00', '615.38'],
    ]);
    await db.exec(`update company_profile set country = 'Uganda' where tenant_id = '${A}'`);
    const uganda = await read<{ country: string; monthly_amount: string; currency: string }>(PAY, `select * from employee_minimum_wages('2026-06-30')`);
    expect(uganda[0]).toMatchObject({ country: 'Uganda', monthly_amount: '130000.00', currency: 'UGX' });
    await db.exec(`update company_profile set country = 'Rwanda' where tenant_id = '${A}'`);
    // no amount for the country: nulls, so nothing is warned about
    const none = await read<{ monthly_amount: string | null; currency: string }>(PAY, `select * from employee_minimum_wages('2026-06-30')`);
    expect(none[0]).toMatchObject({ monthly_amount: null, currency: 'RWF' });
    await db.exec(`update company_profile set country = 'Kenya' where tenant_id = '${A}'`);
  });
});

describe('country from the branch (FIG-905)', () => {
  it("an employee in a Tanzania branch gets Tanzania's amount; the rest keep the company's", async () => {
    await db.exec(`insert into branches (tenant_id, name, country) values ('${A}', 'Dar es Salaam', 'Tanzania')`);
    await db.exec(`update employees set branch_id = (select id from branches where tenant_id = '${A}' and name = 'Dar es Salaam')
                   where "Employee Number" = 'W1'`);
    const list = await read<{ employee_number: string; country: string; monthly_amount: string; currency: string }>(PAY,
      `select * from employee_minimum_wages('2026-06-30') order by employee_number`);
    expect(list.map((r) => [r.employee_number, r.country, r.monthly_amount, r.currency])).toEqual([
      ['E1', 'Kenya', '16000.00', 'KES'], ['W1', 'Tanzania', '250000.00', 'TZS'],
    ]);
    await db.exec(`update employees set branch_id = null, "Branch" = null where "Employee Number" = 'W1'`);
  });
});

describe("the month's work days", () => {
  it('counts distinct days with approved work, and the month of approved work and jobs', async () => {
    await as(PAY, `insert into work_types (name, unit, rate) values ('Crates', 'crate', 50)`);
    const crates = `(select id from work_types where name = 'Crates' and tenant_id = '${A}')`;
    await db.exec(`
      alter table work_entries disable trigger user;
      insert into work_entries (tenant_id, employee_number, work_date, work_type_id, quantity, rate, status, source) values
        ('${A}', 'W1', '2026-05-04', ${crates}, 100, 50, 'approved', 'payroll'),
        ('${A}', 'W1', '2026-05-04', ${crates}, 20, 50, 'approved', 'payroll'),
        ('${A}', 'W1', '2026-05-05', ${crates}, 100, 50, 'approved', 'payroll'),
        ('${A}', 'W1', '2026-05-06', ${crates}, 100, 50, 'submitted', 'payroll'),
        ('${A}', 'W1', '2026-06-01', ${crates}, 100, 50, 'approved', 'payroll');
      alter table work_entries enable trigger user;
    `);
    const may = await read<{ employee_number: string; days: number; work_gross: string; jobs_gross: string }>(PAY,
      `select * from minimum_wage_work_month('2026-05-15')`);
    expect(may).toEqual([{ employee_number: 'W1', days: 2, work_gross: '11000.00', jobs_gross: '0' }]);
  });
});

describe('company isolation', () => {
  it("another company sees none of our amounts or employees, and its own settings", async () => {
    expect(await read(OTHER, `select * from minimum_wages`)).toHaveLength(0);
    const theirs = await read<{ employee_number: string; monthly_amount: string | null }>(OTHER, `select * from employee_minimum_wages('2026-06-30')`);
    expect(theirs).toEqual([expect.objectContaining({ employee_number: 'X1', monthly_amount: null })]);
    expect(await read(OTHER, `select * from minimum_wage_work_month('2026-05-15')`)).toHaveLength(0);
    await as(OTHER, `insert into minimum_wages (country, monthly_amount, effective_from) values ('Kenya', 99999, '2020-01-01')`);
    expect((await one<{ s: { monthly_amount: number } }>(PAY, `select minimum_wage_settings('2026-05-31') s`)).s.monthly_amount).toBe(16000);
    await expect(as(OTHER, `insert into minimum_wages (tenant_id, country, monthly_amount, effective_from) values ('${A}', 'Kenya', 1, '2020-01-01')`)).rejects.toThrow();
  });
});

describe('the migration', () => {
  it('runs again safely, keeping the amounts and settings', async () => {
    const before = await rows(`select country, monthly_amount, currency, effective_from from minimum_wages order by 1, 4, 2`);
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    await db.exec('reset search_path');
    expect(await rows(`select country, monthly_amount, currency, effective_from from minimum_wages order by 1, 4, 2`)).toEqual(before);
    const s = (await one<{ s: Record<string, unknown> }>(PAY, `select minimum_wage_settings('2026-05-31') s`)).s;
    expect(s).toMatchObject({ enabled: true, days_per_month: 26, monthly_amount: 16000 });
    const triggers = await rows<{ tgname: string }>(`select tgname from pg_trigger where tgrelid = 'public.minimum_wages'::regclass and not tgisinternal order by 1`);
    expect(triggers.map((t) => t.tgname)).toEqual(['audit_minimum_wages', 'minimum_wages_fill']);
  });
});
