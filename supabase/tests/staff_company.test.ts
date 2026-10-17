// @vitest-environment node
//
// The staff portal's Company area (20261018800000): my_approval_chain shows an employee who their leave will go to
// before they apply, the way approval_advance would walk the company's workflow; company_directory gives the
// organogram only safe columns, for the caller's company only.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const U = {
  ADMIN: '00000000-0000-0000-0000-00000000c801',
  HR: '00000000-0000-0000-0000-00000000c802',
  LEA: '00000000-0000-0000-0000-00000000c803',
  MGR: '00000000-0000-0000-0000-00000000c804',
  ME: '00000000-0000-0000-0000-00000000c805',
  SOLO: '00000000-0000-0000-0000-00000000c806',
  GONE: '00000000-0000-0000-0000-00000000c807',
  B_STAFF: '00000000-0000-0000-0000-00000000c808',
};
// [user, email, role, tenant, employee number, first, last]
const PEOPLE: [string, string, string, string, string, string, string][] = [
  [U.ADMIN, 'adm@a.co', 'ADMIN', A, 'E-ADM', 'Ada', 'Admin'],
  [U.HR, 'hr@a.co', 'HR', A, 'E-HR', 'Hana', 'Hr'],
  [U.LEA, 'lea@a.co', 'STAFF', A, 'E-LEA', 'Lea', 'Approver'],
  [U.MGR, 'mgr@a.co', 'STAFF', A, 'E-MGR', 'Max', 'Manager'],
  [U.ME, 'me@a.co', 'STAFF', A, 'E-ME', 'Mia', 'Staff'],
  [U.SOLO, 'solo@a.co', 'STAFF', A, 'E-SOLO', 'Sol', 'Alone'],
  [U.GONE, 'gone@a.co', 'STAFF', A, 'E-GONE', 'Gil', 'Gone'],
  [U.B_STAFF, 'staff@b.co', 'STAFF', B, 'E-B1', 'Bea', 'Other'],
];

interface Step { position: number; label: string; approver_type: string; who: string | null; reason?: string }
interface Chain { kind: string; has_employee_record: boolean; steps: Step[]; skipped: Step[]; also_told: string[]; admin_fallback: boolean }

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const chainFor = async (user: string, kind = 'leave') =>
  (await asUser(db, user, () => rows<{ c: Chain }>(`select my_approval_chain('${kind}') c`)))[0].c;

/** Replaces company A's leave workflow (as the database owner: the settings screen is tested elsewhere). */
const setWorkflow = async (steps: Record<string, unknown>[], notify: string[] = []) => {
  const w = (await rows<{ id: string }>(`select id from approval_workflows where tenant_id = '${A}' and kind = 'leave'`))[0];
  await db.exec(`delete from approval_steps where workflow_id = '${w.id}'`);
  let i = 0;
  for (const s of steps) {
    i += 1;
    const v = (k: string) => (s[k] == null ? 'null' : `'${s[k]}'`);
    await db.exec(`insert into approval_steps (tenant_id, workflow_id, position, label, approver_type, approver_role,
      approver_employee_id, skip_if_requester) values ('${A}', '${w.id}', ${i}, ${v('label')}, '${s.approver_type}',
      ${v('approver_role')}, ${v('approver_employee_id')}, ${s.skip_if_requester === false ? 'false' : 'true'})`);
  }
  await db.exec(`update approval_workflows set notify_roles = array[${notify.map((r) => `'${r}'`).join(',')}]::text[] where id = '${w.id}'`);
};
const DEFAULT = [{ approver_type: 'leave_approver' }, { approver_type: 'role', approver_role: 'HR' }];

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  for (const [id, email, role, tenant, number, first, last] of PEOPLE) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id, full_name) values ('${id}', '${email}', '${role}', '${tenant}', '${first} ${last}');
      insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", tenant_id, "Job Title", "Work Mobile",
        "Date of Birth", "Status")
      values ('${number}', '${first}', '${last}', '${email}', '${tenant}', 'Title ${first}', '0700000000', '1990-01-01',
        '${number === 'E-GONE' ? 'Terminated' : 'Active'}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['leaves', 'employees'], '${A}'), ('STAFF', array['dashboard'], '${A}'), ('ADMIN', array['settings'], '${A}'),
      ('STAFF', array['dashboard'], '${B}');
    update employees set "Leave Approver" = 'Lea Approver', manager_email = 'mgr@a.co' where "Employee Number" = 'E-ME';
    insert into departments (tenant_id, name) values ('${A}', 'Finance');
    update employees set department_id = (select id from departments where tenant_id = '${A}' and name = 'Finance'),
      reports_to_id = (select id from employees where "Employee Number" = 'E-MGR')
    where "Employee Number" = 'E-ME';
  `);
}, 120000);

describe('my_approval_chain', () => {
  it("today's default: the Leave Approver, then HR", async () => {
    await setWorkflow(DEFAULT);
    const c = await chainFor(U.ME);
    expect(c.has_employee_record).toBe(true);
    expect(c.steps.map((s) => [s.label, s.who])).toEqual([['Leave approver', 'Lea Approver'], ['HR', 'HR']]);
    expect(c.skipped).toEqual([]);
    expect(c.admin_fallback).toBe(false);
    expect(c.also_told).toEqual([]);
  });

  it('no Leave Approver set: that step is passed over and it goes straight to HR', async () => {
    const c = await chainFor(U.SOLO);
    expect(c.steps.map((s) => s.label)).toEqual(['HR']);
    expect(c.skipped).toEqual([expect.objectContaining({ label: 'Leave approver', reason: 'no approver' })]);
  });

  it('the Leave Approver asking for their own leave skips themselves', async () => {
    await db.exec(`update employees set "Leave Approver" = 'Lea Approver' where "Employee Number" = 'E-LEA'`);
    const c = await chainFor(U.LEA);
    expect(c.steps.map((s) => s.label)).toEqual(['HR']);
    expect(c.skipped[0].reason).toBe('requester');
    await db.exec(`update employees set "Leave Approver" = null where "Employee Number" = 'E-LEA'`);
  });

  it('line manager, then HR, with HR also told', async () => {
    await setWorkflow([{ approver_type: 'reports_to' }, { approver_type: 'role', approver_role: 'HR' }], ['HR']);
    const c = await chainFor(U.ME);
    expect(c.steps.map((s) => [s.label, s.who])).toEqual([['Line manager', 'Max Manager'], ['HR', 'HR']]);
    expect(c.also_told).toEqual(['HR']);
  });

  it('a named person with a custom label, and nobody anywhere falls back to an admin', async () => {
    const cto = (await rows<{ id: string }>(`select id from employees where "Employee Number" = 'E-HR'`))[0].id;
    await setWorkflow([{ approver_type: 'person', approver_employee_id: cto, label: 'People lead' }]);
    expect((await chainFor(U.ME)).steps.map((s) => [s.label, s.who])).toEqual([['People lead', 'Hana Hr']]);

    // the person themselves asking: skipped, and with nothing left it goes to an admin as approval_advance does
    const own = await chainFor(U.HR);
    expect(own.skipped[0].reason).toBe('requester');
    expect(own.admin_fallback).toBe(true);
    expect(own.steps).toEqual([expect.objectContaining({ label: 'Admin', approver_type: 'role' })]);

    await setWorkflow([{ approver_type: 'reports_to' }]);
    const solo = await chainFor(U.SOLO);
    expect(solo.admin_fallback).toBe(true);
    expect(solo.skipped[0]).toEqual(expect.objectContaining({ label: 'Line manager', reason: 'no approver' }));
  });

  it('matches what a real application then does', async () => {
    await setWorkflow(DEFAULT);
    await db.exec(`select seed_default_leave_types('${A}'); update leave_policies set balance_rule = 'none';`);
    const preview = await chainFor(U.SOLO);
    const id = (await asUser(db, U.SOLO, () => rows<{ id: string }>(
      `insert into leave_application ("Employee Number", name, "Leave Type", "Start Date", "End Date", status)
       values ('E-SOLO', 'Sol Alone', 'Annual Leave', '2030-11-04', '2030-11-06', 'pending') returning id`)))[0].id;
    const r = (await rows<{ current_step: number; steps: { approver_role: string }[] }>(
      `select current_step, steps from approval_requests where record_id = '${id}'`))[0];
    expect(preview.steps[0].position).toBe(r.current_step);
    expect(r.steps[r.current_step - 1].approver_role).toBe('HR');
  });

  it('another company sees its own workflow; anon and unknown kinds are refused', async () => {
    const c = await chainFor(U.B_STAFF);
    expect(c.steps.map((s) => s.label)).toEqual(['HR']);
    expect(c.skipped.map((s) => s.label)).toEqual(['Leave approver']);
    await expect(asAnon(db, () => db.query(`select my_approval_chain('leave')`))).rejects.toThrow(/permission denied/);
    await expect(chainFor(U.ME, 'payroll')).rejects.toThrow(/Unknown kind/);
  });
});

describe('company_directory', () => {
  it('returns only the safe columns, for current employees of the caller company', async () => {
    const res = await asUser(db, U.ME, () => db.query<Record<string, unknown>>('select * from company_directory()'));
    expect(res.fields.map((f) => f.name)).toEqual([
      'id', 'employee_number', 'first_name', 'middle_name', 'last_name', 'job_title', 'department_id', 'department',
      'reports_to_id', 'photo',
    ]);
    const numbers = res.rows.map((r) => r.employee_number);
    expect(numbers).toContain('E-ME');
    expect(numbers).not.toContain('E-GONE');
    expect(numbers).not.toContain('E-B1');
    const me = res.rows.find((r) => r.employee_number === 'E-ME')!;
    expect(me.department).toBe('Finance');
    expect(me.reports_to_id).toBeTruthy();
    expect(JSON.stringify(res.rows)).not.toMatch(/0700000000|1990-01-01|@a\.co/);
  });

  it('the other company sees only its own people; anon nothing', async () => {
    const b = await asUser(db, U.B_STAFF, () => rows<{ employee_number: string }>('select employee_number from company_directory()'));
    expect(b.map((r) => r.employee_number)).toEqual(['E-B1']);
    await expect(asAnon(db, () => db.query('select * from company_directory()'))).rejects.toThrow(/permission denied/);
  });
});
