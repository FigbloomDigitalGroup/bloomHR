// @vitest-environment node
//
// Piece rate payouts with Kenyan, Tanzanian and Ugandan workers (FIG-905, create_work_payout_batch in
// 20261021100000_uganda_payroll.sql): a payout is in one currency, never a sum across currencies. Payroll picks the
// country; a payout that would mix currencies is refused; each batch keeps its country and currency; each worker's
// holdbacks follow their own country's rates; and running both migrations again changes nothing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const PAY = '00000000-0000-0000-0000-00000000f201';

const MIGRATIONS = ['20261021000000_tanzania_payroll.sql', '20261021100000_uganda_payroll.sql'].map((f) => join(__dirname, '..', 'migrations', f));
const TODAY = `(now() at time zone 'Africa/Nairobi')::date`;
/** day n of last month */
const day = (n: number) => `((date_trunc('month', ${TODAY}) - interval '1 month')::date + ${n - 1})`;

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const make = async (extra = '') =>
  (await asUser(db, PAY, () => rows<{ id: string }>(`select create_work_payout_batch('daily', ${day(1)}, ${day(10)}${extra}) id`)))[0].id;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${PAY}', 'pay@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${PAY}', 'pay@a.co', 'FINANCE', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values ('FINANCE', array['work-records', 'payroll'], '${A}');
    insert into branches (tenant_id, name, country) values ('${A}', 'Dar es Salaam', 'Tanzania'), ('${A}', 'Kampala', 'Uganda');
    insert into employees ("Employee Number", "First Name", "Last Name", worker_kind, pay_basis, pay_frequency, wht_category, payment_method,
                           "Mobile Number", onboarding_status, "Branch", "Tax PIN", tenant_id) values
      ('K1', 'Kamau', 'K', 'employee', 'work', 'daily', null, 'M-Pesa', '0712345678', 'approved', null, 'A012345678Z', '${A}'),
      ('T1', 'Tumaini', 'T', 'employee', 'work', 'daily', null, 'M-Pesa', '0754123456', 'approved', 'Dar es Salaam', '123-456-789', '${A}'),
      ('TC', 'Tatu', 'C', 'contractor', 'work', 'daily', 'contractual', 'M-Pesa', '0754123457', 'approved', 'Dar es Salaam', '223456789', '${A}'),
      ('U1', 'Wasswa', 'U', 'employee', 'work', 'daily', null, 'Mobile money', '0772123456', 'approved', 'Kampala', '1000123456', '${A}'),
      ('UC', 'Nakato', 'C', 'contractor', 'work', 'daily', 'professional', 'Mobile money', '0772123457', 'approved', 'Kampala', '1000123457', '${A}');
  `);
  await db.exec(`update employees e set branch_id = b.id from branches b where b.tenant_id = e.tenant_id and b.name = e."Branch"`);
  await as(PAY, `insert into work_types (name, unit, rate) values ('Crates', 'crate', 100)`);
  for (const emp of ['K1', 'T1', 'TC', 'U1', 'UC']) {
    await as(PAY, `insert into work_entries (employee_number, work_date, work_type_id, quantity, status)
                   values ('${emp}', ${day(3)}, (select id from work_types where name = 'Crates'), 100, 'submitted')`);
  }
  await db.exec(`update work_entries set status = 'approved' where status <> 'approved'`);
}, 120000);

describe('one currency per payout', () => {
  it('saves each employee with their own country’s tax number in "Tax PIN"', async () => {
    expect(await rows(`select "Employee Number" n, "Tax PIN" t from employees order by 1`)).toEqual([
      { n: 'K1', t: 'A012345678Z' }, { n: 'T1', t: '123456789' }, { n: 'TC', t: '223456789' }, { n: 'U1', t: '1000123456' }, { n: 'UC', t: '1000123457' },
    ]);
  });

  it('refuses a payout for everyone that would mix currencies, and leaves nothing behind', async () => {
    await expect(make()).rejects.toThrow(/would mix KES \(Kenya\) and (TZS \(Tanzania\)|UGX \(Uganda\)): make one payout for each country/);
    // ad hoc: a Tanzanian and a Ugandan picked together
    await expect(asUser(db, PAY, () => db.exec(`select create_work_payout_batch('ad_hoc', ${day(1)}, ${day(10)}, array['T1', 'U1'])`))).rejects.toThrow(/would mix/);
    expect(await rows(`select id from work_payout_batches`)).toEqual([]);
  });

  it("makes one payout per country, each in its currency, with each worker on their own country's rates", async () => {
    const ke = await make(`, null, null, 'Kenya'`);
    const tz = await make(`, null, null, 'Tanzania'`);
    const ug = await make(`, null, null, 'Uganda'`);
    const batches = await rows<{ id: string; country: string; currency: string; worker_count: number; net_total: string }>(
      `select id, country, currency, worker_count, net_total from work_payout_batches order by currency`
    );
    expect(batches.map((b) => [b.id, b.country, b.currency, b.worker_count])).toEqual([[ke, 'Kenya', 'KES', 1], [tz, 'Tanzania', 'TZS', 2], [ug, 'Uganda', 'UGX', 2]]);
    const lines = await rows<{ b: string; n: string; ahl: string; reserve: string; wht_rate: string; wht: string; net: string }>(
      `select batch_id b, employee_number n, ahl, reserve, wht_rate, wht, net from work_payout_lines order by employee_number`
    );
    const by = Object.fromEntries(lines.map((l) => [l.n, l]));
    // every line in a batch is in that batch's country
    expect(lines.filter((l) => l.b === ke).map((l) => l.n)).toEqual(['K1']);
    expect(lines.filter((l) => l.b === tz).map((l) => l.n)).toEqual(['T1', 'TC']);
    expect(lines.filter((l) => l.b === ug).map((l) => l.n)).toEqual(['U1', 'UC']);
    // Kenya: housing levy and reserve; Tanzania and Uganda: the reserve only; contractors at their country's WHT
    expect([by.K1.ahl, by.K1.reserve, by.K1.net]).toEqual(['150.00', '1000.00', '8850.00']);
    expect([by.T1.ahl, by.T1.reserve, by.T1.net]).toEqual(['0.00', '1000.00', '9000.00']);
    expect([by.TC.wht_rate, by.TC.wht]).toEqual(['0.0500', '500.00']);
    expect([by.U1.ahl, by.U1.reserve, by.U1.net]).toEqual(['0.00', '1000.00', '9000.00']);
    expect([by.UC.wht_rate, by.UC.wht]).toEqual(['0.0600', '600.00']);
    // a batch's total is its own currency's lines only
    expect(batches.map((b) => Number(b.net_total))).toEqual([8850, 9000 + 9500, 9000 + 9400]);
  });

  it('a payout for a country with nobody to pay is empty, in that country’s currency', async () => {
    const id = await make(`, null, null, 'Uganda'`);
    expect(await rows(`select country, currency, worker_count from work_payout_batches where id = '${id}'`)).toEqual([{ country: 'Uganda', currency: 'UGX', worker_count: 0 }]);
  });
});

describe('running both migrations again', () => {
  it('changes nothing', async () => {
    const snapshot = () => Promise.all([
      rows(`select id, country, currency, net_total, worker_count from work_payout_batches order by id`),
      rows(`select "Employee Number", "Tax PIN", "NSSF Number" from employees order by 1`),
      rows(`select country, code, effective_from, value, bands from statutory_rates where country in ('Tanzania', 'Uganda') order by 1, 2, 3`),
    ]);
    const before = await snapshot();
    for (const m of MIGRATIONS) await db.exec(readFileSync(m, 'utf8'));
    for (const m of MIGRATIONS) await db.exec(readFileSync(m, 'utf8'));
    expect(await snapshot()).toEqual(before);
    // one create_work_payout_batch, the one with the country
    expect(await rows(`select pg_get_function_identity_arguments(p.oid) a from pg_proc p where p.proname = 'create_work_payout_batch'`)).toEqual([
      { a: 'p_kind text, p_from date, p_to date, p_workers text[], p_notes text, p_country text' },
    ]);
  });
});
