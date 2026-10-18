// @vitest-environment node
//
// One payroll run for every country, approved and filed per country (FIG-905 stage 2, migration
// 20261020900000_payroll_countries.sql): each payslip's country and currency (from the employee's branch), currency
// mismatches refused, the run's countries approved / reopened / paid on their own (approving Kenya settles Kenya's
// workers only, locks Kenya's payslips and month, and lets Kenya's staff see theirs), the run's status following its
// countries, the old way of approving the whole run, statutory rates by country, and running the migration again.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const PAY = '00000000-0000-0000-0000-00000000f001';
const SK = '00000000-0000-0000-0000-00000000f002'; // staff in Kenya (K2)
const ST = '00000000-0000-0000-0000-00000000f003'; // staff in Tanzania (T2)

const MIGRATION = join(__dirname, '..', 'migrations', '20261020900000_payroll_countries.sql');
const TODAY = `(now() at time zone 'Africa/Nairobi')::date`;
/** day n of last month (the month paid, M) */
const day = (n: number) => `((date_trunc('month', ${TODAY}) - interval '1 month')::date + ${n - 1})`;

let db: PGlite;
let m: string;
let runId: string;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const status = async (country: string) =>
  (await rows<{ status: string }>(`select status from payroll_run_countries where run_id = '${runId}' and country = '${country}'`))[0]?.status;
const runStatus = async (period = m) => (await rows<{ status: string }>(`select status from payroll_runs where tenant_id = '${A}' and pay_period = '${period}'`))[0]?.status;
const setCountry = (country: string, s: string) => as(PAY, `update payroll_run_countries set status = '${s}' where run_id = '${runId}' and country = '${country}'`);
const settled = async (emp: string) =>
  (await rows<{ settled_pay_period: string | null }>(`select settled_pay_period from work_entries where employee_number = '${emp}'`)).map((r) => r.settled_pay_period);
const payslip = (emp: string, period: string, extra = '') =>
  `insert into salary_history (employee_id, employee_name, pay_period, gross_pay, net_pay, tenant_id${extra ? ', ' + extra.split('=')[0] : ''})
   values ('${emp}', '${emp}', '${period}', 1000, 1000, '${A}'${extra ? ', ' + extra.split('=')[1] : ''})`;

beforeAll(async () => {
  db = await bootLiveDb();
  m = (await rows<{ m: string }>(`select to_char(${day(1)}, 'YYYY-MM') m`))[0].m;
  await db.exec(`
    insert into auth.users (id, email) values ('${PAY}', 'pay@a.co'), ('${SK}', 'k2@a.co'), ('${ST}', 't2@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${PAY}', 'pay@a.co', 'FINANCE', '${A}'), ('${SK}', 'k2@a.co', 'STAFF', '${A}'), ('${ST}', 't2@a.co', 'STAFF', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('FINANCE', array['work-records', 'payroll'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into branches (tenant_id, name, country) values ('${A}', 'Dar es Salaam', 'Tanzania');
    insert into employees ("Employee Number", "First Name", "Work Email", worker_kind, pay_basis, pay_frequency, onboarding_status, "Branch", tenant_id) values
      ('K1', 'Kamau', 'k1@a.co', 'employee', 'work', 'daily', 'approved', null, '${A}'),
      ('K2', 'Kerubo', 'k2@a.co', 'employee', 'salary', 'monthly', 'approved', null, '${A}'),
      ('T1', 'Tumaini', 't1@a.co', 'employee', 'work', 'daily', 'approved', 'Dar es Salaam', '${A}'),
      ('T2', 'Tatu', 't2@a.co', 'employee', 'salary', 'monthly', 'approved', 'Dar es Salaam', '${A}');
  `);
  await as(PAY, `insert into work_types (name, unit, rate) values ('Crates', 'crate', 50)`);
  for (const [emp, d] of [['K1', 3], ['T1', 4]] as const) {
    await as(PAY, `insert into work_entries (employee_number, work_date, work_type_id, quantity, status)
                   values ('${emp}', ${day(d)}, (select id from work_types where name = 'Crates'), 100, 'submitted')`);
  }
  await db.exec(`update work_entries set status = 'approved' where status <> 'approved'`);
}, 120000);

describe("each payslip's country and currency", () => {
  it("comes from the employee's branch when not given", async () => {
    await as(PAY, `${payslip('K1', m, "work_pay=5000")}; ${payslip('K2', m)}; ${payslip('T1', m, "work_pay=5000")}; ${payslip('T2', m)}`);
    const got = await rows<{ employee_id: string; country: string; currency: string; nita_levy: string }>(
      `select employee_id, country, currency, nita_levy from salary_history where pay_period = '${m}' order by employee_id`
    );
    expect(got.map((r) => `${r.employee_id}:${r.country}:${r.currency}`)).toEqual(['K1:Kenya:KES', 'K2:Kenya:KES', 'T1:Tanzania:TZS', 'T2:Tanzania:TZS']);
    // the NITA levy is Kenya's only
    expect(got.map((r) => Number(r.nita_levy))).toEqual([50, 50, 0, 0]);
    runId = (await rows<{ id: string }>(`select id from payroll_runs where tenant_id = '${A}' and pay_period = '${m}'`))[0].id;
  });

  it('refuses a payslip in another currency than its country, and two currencies for one country in a month', async () => {
    await expect(as(PAY, `update salary_history set currency = 'TZS' where employee_id = 'K1' and pay_period = '${m}'`)).rejects.toThrow(
      /Kenya payslips are in KES, not TZS/
    );
    await expect(as(PAY, payslip('T9', m, "country,currency='Burundi','USD'"))).rejects.toThrow(/./); // T9 is not an employee
    await db.exec(`insert into employees ("Employee Number", "First Name", onboarding_status, tenant_id) values ('B1', 'Bo', 'approved', '${A}'), ('B2', 'Bi', 'approved', '${A}')`);
    await as(PAY, payslip('B1', '2030-01', "country,currency='Burundi','BIF'"));
    await expect(as(PAY, payslip('B2', '2030-01', "country,currency='Burundi','USD'"))).rejects.toThrow(/Burundi payslips for 2030-01 are in BIF; this one is in USD/);
    await as(PAY, `delete from salary_history where pay_period = '2030-01'`);
    expect(await rows(`select * from payroll_runs where pay_period = '2030-01' and tenant_id = '${A}'`)).toHaveLength(1);
    expect(await rows(`select * from payroll_run_countries c join payroll_runs r on r.id = c.run_id where r.pay_period = '2030-01'`)).toHaveLength(0);
  });

  it("the run is one per month, with a draft row per country", async () => {
    expect(await status('Kenya')).toBe('draft');
    expect(await status('Tanzania')).toBe('draft');
    expect(await runStatus()).toBe('draft');
  });
});

describe('approving one country', () => {
  it("approving Kenya settles Kenya's workers only, and locks Kenya's payslips and month only", async () => {
    await setCountry('Kenya', 'approved');
    expect(await status('Kenya')).toBe('approved');
    expect(await runStatus()).toBe('draft'); // Tanzania is still a draft
    expect(await settled('K1')).toEqual([m]);
    expect(await settled('T1')).toEqual([null]);
    await expect(as(PAY, `update salary_history set net_pay = 5 where employee_id = 'K2' and pay_period = '${m}'`)).rejects.toThrow(
      /Payroll for .* in Kenya is approved.*Reopen it first/
    );
    await as(PAY, `update salary_history set net_pay = 5 where employee_id = 'T2' and pay_period = '${m}'`);
    const closed = await rows<{ k: boolean; t: boolean; whole: boolean }>(
      `select pay_month_closed('${A}', ${day(2)}, 'K1') k, pay_month_closed('${A}', ${day(2)}, 'T1') t, pay_month_closed('${A}', ${day(2)}) whole`
    );
    expect(closed[0]).toEqual({ k: true, t: false, whole: false });
    // Tanzania's worker can still record work in the month; Kenya's can't
    await as(PAY, `insert into work_entries (employee_number, work_date, work_type_id, quantity) values ('T1', ${day(5)}, (select id from work_types where name = 'Crates'), 1)`);
    await expect(
      as(PAY, `insert into work_entries (employee_number, work_date, work_type_id, quantity) values ('K1', ${day(5)}, (select id from work_types where name = 'Crates'), 1)`)
    ).rejects.toThrow(/is approved/);
    await db.exec(`delete from work_entries where employee_number = 'T1' and quantity = 1`);
  });

  it("Kenya's staff see their payslip; Tanzania's don't until Tanzania is approved", async () => {
    expect(await read(SK, `select employee_id from salary_history`)).toEqual([{ employee_id: 'K2' }]);
    expect(await read(ST, `select employee_id from salary_history`)).toEqual([]);
  });

  it('one Approve approves several countries; the run then follows them', async () => {
    const changed = await read<{ c: string[] }>(PAY, `select set_payroll_countries_status('${runId}', array['Kenya', 'Tanzania'], 'approved') c`);
    expect(changed[0].c).toEqual(['Tanzania']); // Kenya was already approved
    expect(await runStatus()).toBe('approved');
    expect(await settled('T1')).toEqual([m]);
    expect(await read(ST, `select employee_id from salary_history`)).toEqual([{ employee_id: 'T2' }]);
    expect((await rows<{ approved_at: string | null }>(`select approved_at from payroll_runs where id = '${runId}'`))[0].approved_at).not.toBeNull();
  });

  it("reopening Tanzania undoes Tanzania's settlement only; Kenya stays locked", async () => {
    await setCountry('Tanzania', 'draft');
    expect(await runStatus()).toBe('draft');
    expect(await settled('T1')).toEqual([null]);
    expect(await settled('K1')).toEqual([m]);
    expect(await read(ST, `select employee_id from salary_history`)).toEqual([]);
    expect(await read(SK, `select employee_id from salary_history`)).toEqual([{ employee_id: 'K2' }]);
    await expect(as(PAY, `delete from payroll_runs where id = '${runId}'`)).rejects.toThrow(/Kenya is approved so it can't be deleted/);
  });

  it('pays per country; the run is paid when every country is', async () => {
    await as(PAY, `select set_payroll_countries_status('${runId}', array['Tanzania'], 'approved')`);
    await setCountry('Kenya', 'paid');
    expect(await runStatus()).toBe('approved');
    await setCountry('Tanzania', 'paid');
    expect(await runStatus()).toBe('paid');
    await expect(setCountry('Kenya', 'draft')).rejects.toThrow(/in Kenya can't go from paid to draft/);
  });

  it('only payroll changes a country, and nobody adds or removes one by hand', async () => {
    await expect(read(SK, `select set_payroll_countries_status('${runId}', array['Kenya'], 'draft')`)).rejects.toThrow(/Only payroll/);
    await expect(as(PAY, `insert into payroll_run_countries (run_id, country) values ('${runId}', 'Uganda')`)).rejects.toThrow(/permission denied|row-level security/);
  });
});

describe('approving the whole run the old way', () => {
  it('approves, reopens and pays every country that can', async () => {
    const next = '2030-02';
    await as(PAY, `${payslip('K2', next)}; ${payslip('T2', next)}`);
    await as(PAY, `update payroll_runs set status = 'approved' where pay_period = '${next}'`);
    const countries = await rows<{ country: string; status: string }>(
      `select c.country, c.status from payroll_run_countries c join payroll_runs r on r.id = c.run_id where r.pay_period = '${next}' order by 1`
    );
    expect(countries).toEqual([{ country: 'Kenya', status: 'approved' }, { country: 'Tanzania', status: 'approved' }]);
    await as(PAY, `update payroll_runs set status = 'draft' where pay_period = '${next}'`);
    expect(await runStatus(next)).toBe('draft');
    expect(
      (await rows<{ n: number }>(`select count(*)::int n from payroll_run_countries c join payroll_runs r on r.id = c.run_id where r.pay_period = '${next}' and c.status = 'draft'`))[0].n
    ).toBe(2);
    // a new country's payslip in an approved month starts that country as a draft: the run is a draft again
    await as(PAY, `update payroll_runs set status = 'approved' where pay_period = '${next}'`);
    await db.exec(`insert into branches (tenant_id, name, country) values ('${A}', 'Kampala', 'Uganda');
                   insert into employees ("Employee Number", "First Name", onboarding_status, "Branch", tenant_id) values ('U1', 'Ura', 'approved', 'Kampala', '${A}')`);
    await as(PAY, payslip('U1', next));
    expect(await runStatus(next)).toBe('draft');
    // and the Kenya and Tanzania payslips stay locked
    await expect(as(PAY, `update salary_history set net_pay = 1 where employee_id = 'K2' and pay_period = '${next}'`)).rejects.toThrow(/Reopen it first/);
    // rows are never removed by hand
    await expect(as(PAY, `delete from payroll_run_countries where country = 'Kenya'`)).rejects.toThrow(/permission denied/);
  });
});

describe('statutory rates by country', () => {
  it("each country's rates are its own", async () => {
    await db.exec(`insert into statutory_rates (tenant_id, code, value, effective_from, source, country)
                   values (null, 'sdl_rate', 0.035, '2024-07-01', 'Tanzania SDL (test)', 'tanzania')`);
    const r = await read<{ ke: Record<string, unknown>; tz: Record<string, unknown>; def: Record<string, unknown> }>(
      PAY,
      `select statutory_rates_on('2026-10-31', 'Kenya') ke, statutory_rates_on('2026-10-31', 'Tanzania') tz, statutory_rates_on('2026-10-31') def`
    );
    expect(r[0].tz).toEqual({ sdl_rate: 0.035 });
    expect(r[0].ke.paye_bands).toBeTruthy();
    expect(r[0].ke.sdl_rate).toBeUndefined();
    expect(r[0].def).toEqual(r[0].ke);
    expect((await rows(`select country from statutory_rates where code = 'sdl_rate'`))[0]).toEqual({ country: 'Tanzania' });
  });

  it("a company's rate for one country doesn't clash with another country's", async () => {
    await as(PAY, `insert into statutory_rates (tenant_id, code, value, effective_from, country) values ('${A}', 'nita_levy', 60, '2026-01-01', 'Kenya')`);
    await as(PAY, `insert into statutory_rates (tenant_id, code, value, effective_from, country) values ('${A}', 'nita_levy', 70, '2026-01-01', 'Tanzania')`);
    await expect(as(PAY, `insert into statutory_rates (tenant_id, code, value, effective_from, country) values ('${A}', 'nita_levy', 80, '2026-06-01', 'Kenya')`)).rejects.toThrow(
      /already has a rate/
    );
    const r = await rows<{ ke: string; tz: string }>(
      `select statutory_rate_for('${A}', 'nita_levy', '2026-10-31') ke, statutory_rate_for('${A}', 'nita_levy', '2026-10-31', 'Tanzania') tz`
    );
    expect(r[0]).toEqual({ ke: '60', tz: '70' });
  });
});

describe('running the migration again', () => {
  it('changes nothing', async () => {
    const before = await rows(`select run_id, country, status, approved_at from payroll_run_countries order by run_id, country`);
    const slips = await rows(`select id, country, currency from salary_history order by id`);
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    expect(await rows(`select run_id, country, status, approved_at from payroll_run_countries order by run_id, country`)).toEqual(before);
    expect(await rows(`select id, country, currency from salary_history order by id`)).toEqual(slips);
    expect(await runStatus()).toBe('paid');
  });
});
