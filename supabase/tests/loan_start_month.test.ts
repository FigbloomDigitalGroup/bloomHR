// @vitest-environment node
//
// Starting repayments this month (20261118300000): the earliest pay month is this one until its payroll is approved,
// then the next. Staff may choose it; a month already run is refused, and a loan approved or paid out after its start
// month ran moves to the first open month.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const HR = '00000000-0000-0000-0000-00000000d001';
const S1 = '00000000-0000-0000-0000-00000000d002';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const month = (offset: number) => {
  const d = new Date();
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + offset;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
};
const firstOpen = async () => (await read<{ p: string }>(S1, `select loan_first_open_period() p`))[0].p;
const ask = async (start: string) =>
  (await read<{ id: string }>(S1, `insert into employee_loans (employee_number, principal, months, reason, status, start_period)
                                   values ('E1', 6000, 3, 'rent', 'requested', '${start}') returning id`))[0].id;
const startOf = async (id: string) => (await rows<{ start_period: string }>(`select start_period from employee_loans where id = '${id}'`))[0].start_period;
const decide = (id: string) =>
  as(HR, `select decide_approval(r.id, 'approved', null) from approval_requests r where r.kind = 'loan' and r.record_id = '${id}'`);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${S1}', 's1@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${S1}', 's1@a.co', 'STAFF', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees', 'loans', 'payroll'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Basic Salary", onboarding_status, tenant_id) values
      ('H1', 'Hana', 'Hr', 'hr@a.co', 100000, 'approved', '${A}'), ('E1', 'Esther', 'One', 's1@a.co', 60000, 'approved', '${A}');
    insert into loan_settings (tenant_id, require_signed_form) values ('${A}', false);
  `);
}, 120000);

describe('starting this month', () => {
  it('while this month’s payroll is open, a request can start this month', async () => {
    expect(await firstOpen()).toBe(month(0));
    const id = await ask(month(0));
    expect(await startOf(id)).toBe(month(0));
    await as(S1, `update employee_loans set status = 'cancelled' where id = '${id}'`);
  });

  it('a draft run keeps the month open; an approved one closes it', async () => {
    await db.exec(`insert into payroll_runs (tenant_id, pay_period, status) values ('${A}', '${month(0)}', 'draft')`);
    expect(await firstOpen()).toBe(month(0));
    const waiting = await ask(month(0));
    // approved (payroll's own checks, which want payslips, are not what this tests)
    await db.exec(`set session_replication_role = replica; update payroll_runs set status = 'approved' where pay_period = '${month(0)}'; set session_replication_role = origin;`);
    expect(await firstOpen()).toBe(month(1));
    // approving the request asked before the run moves it to the first open month, the amounts unchanged
    await decide(waiting);
    expect(await startOf(waiting)).toBe(month(1));
    const schedule = await rows<{ period: string; payment: string }>(`select period, payment from employee_loan_instalments where loan_id = '${waiting}' order by instalment_no`);
    expect(schedule.map((r) => r.period)).toEqual([month(1), month(2), month(3)]);
    expect(schedule.map((r) => Number(r.payment)).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(6000);
    // asking for the closed month now is refused, with the earliest month named
    await expect(ask(month(0))).rejects.toThrow(/start from .* at the earliest/);
    expect((await ask(month(1))).length).toBeGreaterThan(0);
  });

  it('HR can’t move a loan into a month already run, but can choose any open one', async () => {
    const id = (await rows<{ id: string }>(`select id from employee_loans where status = 'approved' limit 1`))[0].id;
    await expect(as(HR, `update employee_loans set start_period = '${month(0)}' where id = '${id}'`)).rejects.toThrow(/at the earliest/);
    await as(HR, `update employee_loans set start_period = '${month(2)}' where id = '${id}'`);
    expect(await startOf(id)).toBe(month(2));
  });
});
