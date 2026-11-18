// @vitest-environment node
//
// Fixed loan terms (20261118500000): with 3 months at 20% and 6 months at 25% set, loans are only for 3 or 6 months and
// take that term's rate, whoever enters them. Without fixed terms, loans work as before.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const HR = '00000000-0000-0000-0000-00000000b101';
const S1 = '00000000-0000-0000-0000-00000000b102';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const ask = async (months: number) =>
  (await read<{ id: string }>(S1, `insert into employee_loans (employee_number, principal, months, reason, status)
                                   values ('E1', 30000, ${months}, 'school fees', 'requested') returning id`))[0].id;
const loan = async (id: string) =>
  (await rows<{ annual_rate: string; total_interest: string; monthly_instalment: string; status: string }>(`select * from employee_loans where id = '${id}'`))[0];

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${S1}', 's1@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${S1}', 's1@a.co', 'STAFF', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values ('HR', array['employees', 'loans'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Basic Salary", onboarding_status, tenant_id) values
      ('H1', 'Hana', 'Hr', 'hr@a.co', 100000, 'approved', '${A}'), ('E1', 'Esther', 'One', 's1@a.co', 60000, 'approved', '${A}');
  `);
  await as(HR, `insert into loan_settings (annual_rate, interest_method, min_months, max_months, require_signed_form) values (20, 'upfront', 1, 6, false)`);
}, 120000);

describe('fixed terms', () => {
  it('only a list of whole months, each once, with a rate from 0 to 100', async () => {
    for (const bad of ['{}', '[{"months": 3}]', '[{"months": 3.5, "rate": 20}]', '[{"months": 3, "rate": 120}]', '[{"months": 3, "rate": 20}, {"months": 3, "rate": 25}]']) {
      await expect(as(HR, `update loan_settings set term_rates = '${bad}'`)).rejects.toThrow(/term_rates/);
    }
  });

  it('without them, loans are as before', async () => {
    const id = await ask(4);
    expect(Number((await loan(id)).annual_rate)).toBe(20);
    await as(S1, `update employee_loans set status = 'cancelled' where id = '${id}'`);
  });

  it('with them, only those terms, each at its own rate', async () => {
    await as(HR, `update loan_settings set term_rates = '[{"months": 3, "rate": 20}, {"months": 6, "rate": 25}]'`);
    await expect(ask(4)).rejects.toThrow(/Loans are for 3 or 6 months/);
    const id = await ask(6);
    // 25% of 30,000 taken off up front: 7,500 interest, 5,000 a month
    expect(await loan(id)).toMatchObject({ status: 'requested' });
    expect(Number((await loan(id)).annual_rate)).toBe(25);
    expect(Number((await loan(id)).total_interest)).toBe(7500);
    expect(Number((await loan(id)).monthly_instalment)).toBe(5000);
  });

  it('approval keeps the term’s rate (not the company rate it copies); HR can’t set another term or rate', async () => {
    const [{ id }] = await rows<{ id: string }>(`select id from employee_loans where status = 'requested'`);
    await as(HR, `select decide_approval(r.id, 'approved', null) from approval_requests r where r.kind = 'loan' and r.record_id = '${id}'`);
    expect(await loan(id)).toMatchObject({ status: 'approved' });
    expect(Number((await loan(id)).annual_rate)).toBe(25);
    // approved: its terms are locked for everyone (20261119000000)
    await expect(as(HR, `update employee_loans set months = 3 where id = '${id}'`)).rejects.toThrow(/agreement can't be changed/);
    await expect(as(HR, `update employee_loans set annual_rate = 10 where id = '${id}'`)).rejects.toThrow(/agreement can't be changed/);
  });

  it('on a request, HR may change the term to another fixed one; the rate follows', async () => {
    const id = await ask(6);
    await expect(as(HR, `update employee_loans set months = 5 where id = '${id}'`)).rejects.toThrow(/3 or 6 months/);
    await as(HR, `update employee_loans set annual_rate = 10 where id = '${id}'`);
    expect(Number((await loan(id)).annual_rate)).toBe(25);
    await as(HR, `update employee_loans set months = 3 where id = '${id}'`);
    expect(Number((await loan(id)).annual_rate)).toBe(20);
    expect(await rows(`select 1 from employee_loan_instalments where loan_id = '${id}'`)).toHaveLength(3);
  });
});
