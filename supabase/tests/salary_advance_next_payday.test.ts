// @vitest-environment node
//
// 20261027700000: a salary advance is repaid in full on the next payday (it can't be spread over months), there is no
// limit on the amount, and someone on the salary advance screen applies for a person on their behalf: the database
// records who applied, and the request starts on the company's approval chain for that person like any other.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const STAFF = '00000000-0000-0000-0000-00000000e101'; // E-ME
const HR = '00000000-0000-0000-0000-00000000e102'; // salaryadmin, employee H-1

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) => asUser(db, user, () => rows<T>(sql, params));
const fails = (user: string, sql: string) => as(user, sql).then(
  () => { throw new Error(`expected to fail: ${sql}`); },
  (e) => (e as Error).message,
);
type Advance = { id: string; requested_by: string | null; requested_by_email: string | null };

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${STAFF}', 'me@a.co'), ('${HR}', 'hr@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${STAFF}', 'me@a.co', 'STAFF', '${A}'), ('${HR}', 'hr@a.co', 'HR', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('STAFF', array['dashboard'], '${A}'), ('HR', array['employees', 'salaryadmin'], '${A}');
    insert into employees ("Employee Number", "First Name", "Work Email", "Basic Salary", tenant_id) values
      ('E-ME', 'Me', 'me@a.co', 40000, '${A}'), ('E-AMINA', 'Amina', null, 30000, '${A}'), ('H-1', 'Hana', 'hr@a.co', 90000, '${A}');
  `);
}, 120000);

describe('repaid in full on the next payday', () => {
  it('a new advance cannot be spread over months, by staff or the salary advance screen', async () => {
    expect(await fails(STAFF, `insert into salary_advance ("Employee Number", "Amount Requested", repayment_months, status)
      values ('E-ME', 6000, 3, 'Pending')`)).toMatch(/repaid in full on the next payday/);
    expect(await fails(HR, `insert into salary_advance ("Employee Number", "Amount Requested", repayment_months, status)
      values ('E-AMINA', 6000, 2, 'Pending')`)).toMatch(/repaid in full on the next payday/);
  });

  it('any amount may be asked for: far more than 20% of basic salary', async () => {
    const [a] = await as<Advance>(STAFF, `insert into salary_advance ("Employee Number", "Amount Requested", status)
      values ('E-ME', 100000, 'Pending') returning id, requested_by, requested_by_email`);
    // asked for themselves: nobody applied on their behalf
    expect(a).toMatchObject({ requested_by: null, requested_by_email: null });
  });
});

describe('applying on someone’s behalf', () => {
  let id: string;

  it('the salary advance screen applies for a person: who applied is recorded, and it starts on that person’s chain', async () => {
    [{ id }] = await as<Advance>(HR, `insert into salary_advance ("Employee Number", "Full Name", "Amount Requested", status)
      values ('E-AMINA', 'Amina', 50000, 'Pending') returning id`);
    const [a] = await rows<Advance & { status: string; repayment_months: number }>(
      `select requested_by, requested_by_email, status, repayment_months from salary_advance where id = $1`, [id]);
    expect(a).toEqual({ requested_by: HR, requested_by_email: 'hr@a.co', status: 'Pending', repayment_months: 1 });
    const [req] = await rows<{ status: string; requester_employee_number: string }>(
      `select status, requester_employee_number from approval_requests where kind = 'salary_advance' and record_id = $1`, [id]);
    expect(req).toEqual({ status: 'pending', requester_employee_number: 'E-AMINA' });
  });

  it('and may approve the step it waits on (Approve it now)', async () => {
    const [{ rid }] = await rows<{ rid: string }>(`select id rid from approval_requests where kind = 'salary_advance' and record_id = $1`, [id]);
    expect((await as<{ status: string }>(HR, `select status from decide_approval($1, 'approved', 'Applied for on their behalf')`, [rid]))[0].status)
      .toBe('approved');
    expect((await rows<{ status: string }>(`select status from salary_advance where id = $1`, [id]))[0].status).toBe('approved');
  });

  it('who applied cannot be made up, nor changed afterwards', async () => {
    const [own] = await as<Advance>(STAFF, `insert into salary_advance ("Employee Number", "Amount Requested", status, requested_by, requested_by_email)
      values ('E-ME', 500, 'Pending', '${HR}', 'hr@a.co') returning id, requested_by, requested_by_email`);
    expect(own).toMatchObject({ requested_by: null, requested_by_email: null });

    await as(HR, `update salary_advance set requested_by = null, requested_by_email = 'someone@else.co' where id = $1`, [id]);
    expect((await rows<Advance>(`select requested_by, requested_by_email from salary_advance where id = $1`, [id]))[0])
      .toEqual({ requested_by: HR, requested_by_email: 'hr@a.co' });
  });

  it('staff still cannot apply for someone else', async () => {
    expect(await fails(STAFF, `insert into salary_advance ("Employee Number", "Amount Requested", status)
      values ('E-AMINA', 500, 'Pending')`)).toMatch(/row-level security/);
  });
});
