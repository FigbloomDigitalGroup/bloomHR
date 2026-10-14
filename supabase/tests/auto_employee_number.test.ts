// @vitest-environment node
//
// Employee numbers come from the system (20261014600000): a new employee added without one gets the company's next
// number (MCL-000001, ...), and the bulk upload never takes a new person's number from the sheet. Existing employees
// are found by their number or their work email.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const HR = '00000000-0000-0000-0000-00000000e801';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
type Saved = { row_no: number; employee_number: string | null; outcome: string; work_email: string | null; error_message: string | null };
const save = (batch: unknown[]) => asUser(db, HR, () => rows<Saved>(`select * from save_employees_batch($1::jsonb)`, [JSON.stringify(batch)]));
const numbers = async (email: string) =>
  (await rows<{ e: string; p: string }>(`select "Employee Number" e, "Payroll Number" p from employees where "Work Email" = $1`, [email]))[0];

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${HR}', 'hr@a.co', 'HR', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values ('HR', array['dashboard', 'employees'], '${A}');
  `);
}, 120000);

describe('employee numbers from the system', () => {
  it('a new employee without a number gets the next MCL number, in order; the payroll number is separate', async () => {
    await asUser(db, HR, () => db.exec(`insert into employees ("First Name", "Last Name", "Work Email") values ('Ann', 'One', 'ann@a.co')`));
    await asUser(db, HR, () => db.exec(`insert into employees ("First Name", "Last Name", "Work Email") values ('Ben', 'One', 'ben@a.co')`));
    const ann = await numbers('ann@a.co');
    const ben = await numbers('ben@a.co');
    expect(ann.e).toMatch(/^MCL-\d{6}$/);
    expect(Number(ben.e.slice(4))).toBe(Number(ann.e.slice(4)) + 1);
    expect(ann.p).toMatch(/^PR-\d{5}$/);
  });

  it('a typed number is still kept when someone adds an employee one at a time', async () => {
    await asUser(db, HR, () => db.exec(`insert into employees ("Employee Number", "First Name", "Work Email") values ('HAND-1', 'Hand', 'hand@a.co')`));
    expect((await numbers('hand@a.co')).e).toBe('HAND-1');
  });

  it('skips a number that an older employee already has', async () => {
    const next = Number((await numbers('ben@a.co')).e.slice(4)) + 1;
    const taken = `MCL-${String(next).padStart(6, '0')}`;
    await asUser(db, HR, () => db.exec(`insert into employees ("Employee Number", "First Name", "Work Email") values ('${taken}', 'Typed', 'typed@a.co')`));
    await asUser(db, HR, () => db.exec(`insert into employees ("First Name", "Work Email") values ('Bea', 'bea@a.co')`));
    const bea = await numbers('bea@a.co');
    expect(bea.e).toMatch(/^MCL-\d{6}$/);
    expect(bea.e).not.toBe(taken);
  });

  it("uses the company's own prefix when it sets one", async () => {
    await db.exec(`insert into company_payroll_settings (tenant_id, employee_number_prefix) values ('${A}', 'FIG') on conflict (tenant_id) do update set employee_number_prefix = 'FIG'`);
    await asUser(db, HR, () => db.exec(`insert into employees ("First Name", "Work Email") values ('Fay', 'fay@a.co')`));
    expect((await numbers('fay@a.co')).e).toMatch(/^FIG-\d{6}$/);
    await db.exec(`update company_payroll_settings set employee_number_prefix = 'MCL' where tenant_id = '${A}'`);
    await expect(db.exec(`update company_payroll_settings set employee_number_prefix = 'bad prefix' where tenant_id = '${A}'`)).rejects.toThrow(/check/);
  });
});

describe('bulk upload with just names and work emails', () => {
  it('adds them with numbers from the system, ignoring numbers typed for new people', async () => {
    const result = await save([
      { row: 2, data: { 'First Name': 'Cy', 'Last Name': 'Two', 'Work Email': 'cy@a.co' } },
      { row: 3, data: { 'Employee Number': 'emp 7 (typo)', 'First Name': 'Di', 'Last Name': 'Three', 'Work Email': 'di@a.co' } },
    ]);
    expect(result.map((r) => r.outcome)).toEqual(['created', 'created']);
    for (const r of result) expect(r.employee_number).toMatch(/^MCL-\d{6}$/);
    expect(result[0].employee_number).not.toBe(result[1].employee_number);
    expect(await rows(`select 1 from employees where "Employee Number" = 'emp 7 (typo)'`)).toHaveLength(0);
  });

  it('a row with the work email of someone already there updates them (any case), without a number', async () => {
    const before = await numbers('cy@a.co');
    const [r] = await save([{ row: 2, data: { 'First Name': 'Cyrus', 'Last Name': 'Two', 'Work Email': 'CY@a.co', 'Job Title': 'Driver' } }]);
    expect(r).toMatchObject({ outcome: 'updated', employee_number: before.e });
    expect(await rows(`select "First Name", "Job Title" from employees where "Employee Number" = $1`, [before.e])).toEqual([{ 'First Name': 'Cyrus', 'Job Title': 'Driver' }]);
    expect(await rows(`select 1 from employees where lower("Work Email") = 'cy@a.co'`)).toHaveLength(1);
  });

  it('an existing employee number still finds that employee', async () => {
    const [r] = await save([{ row: 2, data: { 'Employee Number': 'HAND-1', 'Job Title': 'Clerk' } }]);
    expect(r).toMatchObject({ outcome: 'updated', employee_number: 'HAND-1', work_email: 'hand@a.co' });
  });
});
