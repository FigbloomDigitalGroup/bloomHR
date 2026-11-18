// @vitest-environment node
//
// The monthly repayment at most a third of basic salary (20261119300000): with interest off up front, a 3-month loan
// is up to the basic salary and a 6-month one up to twice it. Staff requests above it are refused; HR isn't held to it.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const HR = '00000000-0000-0000-0000-00000000a901';
const S1 = '00000000-0000-0000-0000-00000000a902';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const ask = (amount: number, months: number) =>
  read<{ id: string }>(S1, `insert into employee_loans (employee_number, principal, months, reason, status)
                            values ('E1', ${amount}, ${months}, 'school fees', 'requested') returning id`);
const cancelAll = () => db.exec(`update employee_loans set status = 'cancelled' where status = 'requested'`);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${S1}', 's1@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${S1}', 's1@a.co', 'STAFF', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values ('HR', array['employees', 'loans'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Basic Salary", onboarding_status, tenant_id) values
      ('H1', 'Hana', 'Hr', 'hr@a.co', 100000, 'approved', '${A}'), ('E1', 'Esther', 'One', 's1@a.co', 74784, 'approved', '${A}');
  `);
  await as(HR, `insert into loan_settings (annual_rate, interest_method, min_months, max_months, require_signed_form, term_rates, max_instalment_divisor)
                values (20, 'upfront', 3, 6, false, '[{"months": 3, "rate": 20}, {"months": 6, "rate": 25}]', 3)`);
}, 120000);

describe('a third of basic salary a month', () => {
  it('3 months: up to the basic salary (74,784), not a shilling more', async () => {
    await ask(74784, 3);
    await cancelAll();
    await expect(ask(75000, 3)).rejects.toThrow(/at most KES 24,928.00 \(your basic salary divided by 3\): over 3 months you can borrow up to KES 74,784.00/);
  });

  it('6 months: up to twice the basic salary (149,568)', async () => {
    await ask(149568, 6);
    await cancelAll();
    await expect(ask(150000, 6)).rejects.toThrow(/borrow up to KES 149,568.00/);
  });

  it('HR setting up a loan isn’t held to it; without the setting there is no such limit', async () => {
    await as(HR, `insert into employee_loans (employee_number, principal, months, reason, status) values ('E1', 200000, 6, 'agreed', 'approved')`);
    await as(HR, `update loan_settings set max_instalment_divisor = null`);
    await ask(150000, 6);
  });
});
