// @vitest-environment node
//
// The affordability flag (20261120100000): no limit, but a loan whose monthly repayment is over 30% of net pay (or whose
// net pay isn't known) is approved only after HR or finance confirm they checked the borrower can afford it.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const HR = '00000000-0000-0000-0000-00000000aa01';
const FIN = '00000000-0000-0000-0000-00000000aa02';
const S1 = '00000000-0000-0000-0000-00000000aa03';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const ask = async (amount: number, months: number, extra = '') =>
  (await read<{ id: string }>(S1, `insert into employee_loans (employee_number, principal, months, reason, status${extra ? ', stated_net_pay' : ''})
                                   values ('E1', ${amount}, ${months}, 'school fees', 'requested'${extra ? ', ' + extra : ''}) returning id`))[0].id;
const decide = (user: string, id: string) =>
  as(user, `select decide_approval(r.id, 'approved', null) from approval_requests r where r.kind = 'loan' and r.record_id = '${id}'`);
const status = async (id: string) => (await rows<{ status: string }>(`select status from employee_loans where id = '${id}'`))[0].status;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${FIN}', 'fin@a.co'), ('${S1}', 's1@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${FIN}', 'fin@a.co', 'CHECKER', '${A}'), ('${S1}', 's1@a.co', 'STAFF', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees', 'loans'], '${A}'), ('CHECKER', array['payments'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Basic Salary", onboarding_status, tenant_id) values
      ('H1', 'Hana', 'Hr', 'hr@a.co', 100000, 'approved', '${A}'), ('E1', 'Esther', 'One', 's1@a.co', 74784, 'approved', '${A}');
    insert into salary_history (tenant_id, employee_id, pay_period, basic_salary, gross_pay, net_pay)
      values ('${A}', 'E1', '2026-11', 74784, 74784, 84000);
  `);
  // no limits at all; interest off up front; the flag at 30%
  await as(HR, `insert into loan_settings (annual_rate, interest_method, min_months, max_months, require_signed_form, affordability_flag_percent)
                values (20, 'upfront', 1, 6, false, 30)`);
}, 120000);

describe('the affordability flag', () => {
  it('no limit: a large loan can be asked for', async () => {
    const id = await ask(300000, 3);
    expect(await status(id)).toBe('requested');
    await db.exec(`update employee_loans set status = 'cancelled' where id = '${id}'`);
  });

  it('under 30% of net pay: approved as before', async () => {
    // 60,000 over 3 months: 20,000 a month, 23.8% of 84,000
    const id = await ask(60000, 3);
    const [a] = await read<{ share_percent: string; over_flag: boolean }>(HR, `select * from loan_affordability(array['${id}'::uuid])`);
    expect(Number(a.share_percent)).toBe(23.8);
    expect(a.over_flag).toBe(false);
    await decide(HR, id);
    expect(await status(id)).toBe('approved');
  });

  it('over 30%: approval waits for the approver to confirm they checked; finance may confirm, staff may not', async () => {
    // 100,000 over 3 months: 33,333 a month, 39.7% of 84,000
    const id = await ask(100000, 3);
    const [a] = await read<{ over_flag: boolean; share_percent: string }>(HR, `select * from loan_affordability(array['${id}'::uuid])`);
    expect(a.over_flag).toBe(true);
    await expect(decide(HR, id)).rejects.toThrow(/over 30% of the borrower's net pay/);
    await expect(as(S1, `select loan_confirm_affordability('${id}', 'Esther')`)).rejects.toThrow(/Only HR or finance/);
    await as(FIN, `select loan_confirm_affordability('${id}', 'Faith Finance')`);
    await decide(HR, id);
    expect(await status(id)).toBe('approved');
    expect((await read<{ checked_by_name: string }>(HR, `select checked_by_name from loan_affordability(array['${id}'::uuid])`))[0].checked_by_name).toBe('Faith Finance');
  });

  it('net pay unknown counts as flagged; HR setting up a loan confirms it as they set it up', async () => {
    await db.exec(`delete from salary_history where employee_id = 'E1'`);
    await expect(as(HR, `insert into employee_loans (employee_number, principal, months, reason, status) values ('E1', 30000, 3, 'x', 'approved')`))
      .rejects.toThrow(/isn't known/);
    await as(HR, `insert into employee_loans (employee_number, principal, months, reason, status, affordability_checked_by)
                  values ('E1', 30000, 3, 'x', 'approved', '${HR}')`);
    // a staff request can't carry a confirmation
    const id = await read<{ id: string; affordability_checked_by: string | null }>(S1, `insert into employee_loans (employee_number, principal, months, reason, status, affordability_checked_by)
      values ('E1', 30000, 3, 'school fees', 'requested', '${S1}') returning id, affordability_checked_by`);
    expect(id[0].affordability_checked_by).toBeNull();
  });
});
