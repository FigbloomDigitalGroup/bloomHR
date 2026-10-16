// @vitest-environment node
//
// "Also tell" on an approval workflow (FIG-878): the line manager approves, and HR is told when the request is
// finally approved or rejected, without being a step.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const ADMIN = '00000000-0000-0000-0000-00000000f101';
const HR = '00000000-0000-0000-0000-00000000f102';
const MGR = '00000000-0000-0000-0000-00000000f103';
const ME = '00000000-0000-0000-0000-00000000f104';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const run = async (sql: string) => {
  try {
    await db.query(sql);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const apply = async () =>
  (await asUser(db, ME, () => rows<{ id: string }>(
    `insert into leave_application ("Employee Number", name, "Leave Type", "Start Date", "End Date", status)
     values ('E-ME', 'Mia Staff', 'Annual Leave', '2030-11-04', '2030-11-06', 'pending') returning id`)))[0].id;
const decide = async (user: string, leaveId: string, decision: string) => {
  const r = (await rows<{ id: string }>(`select id from approval_requests where record_id = '${leaveId}'`))[0];
  return asUser(db, user, () => run(`select decide_approval('${r.id}', '${decision}', '')`));
};
const told = async (emp: string) =>
  (await rows<{ title: string; message: string }>(
    `select title, message from hr_notifications where employee_number = '${emp}' and notification_type = 'approval_progress' order by id`));
const workflow = async () => (await asUser(db, HR, () => rows<{ w: { notify_roles: string[] } }>(`select approval_workflow('leave') w`)))[0].w;

beforeAll(async () => {
  db = await bootLiveDb();
  for (const [id, email, role, num, first] of [
    [ADMIN, 'adm@a.co', 'ADMIN', 'E-ADM', 'Ada'], [HR, 'hr@a.co', 'HR', 'E-HR', 'Hana'],
    [MGR, 'mgr@a.co', 'STAFF', 'E-MGR', 'Max'], [ME, 'me@a.co', 'STAFF', 'E-ME', 'Mia'],
  ]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id, full_name) values ('${id}', '${email}', '${role}', '${A}', '${first}');
      insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", tenant_id) values ('${num}', '${first}', 'X', '${email}', '${A}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['leaves', 'employees'], '${A}'), ('STAFF', array['dashboard'], '${A}'), ('ADMIN', array['settings'], '${A}');
    update employees set manager_email = 'mgr@a.co' where "Employee Number" = 'E-ME';
    select seed_default_leave_types('${A}');
    update leave_policies set balance_rule = 'none';
  `);
}, 120000);

describe('also tell', () => {
  it('starts empty; settings can choose roles to tell; others cannot', async () => {
    expect((await workflow()).notify_roles).toEqual([]);
    const steps = JSON.stringify([{ approver_type: 'reports_to' }]);
    expect(await asUser(db, HR, () => run(`select save_approval_workflow('leave', '${steps}'::jsonb, true, array['HR'])`)))
      .toMatch(/Only an admin or someone with Settings/);
    expect(await asUser(db, ADMIN, () => run(`select save_approval_workflow('leave', '${steps}'::jsonb, true, array['hr', 'HR'])`))).toBe('');
    expect((await workflow()).notify_roles).toEqual(['HR']);
    expect(await asUser(db, ADMIN, () => run(`select save_approval_workflow('leave', '${steps}'::jsonb, true, array['not a role'])`)))
      .toMatch(/Choose up to 10 roles/);
  });

  it('the line manager approves, and HR is told who approved what', async () => {
    const leave = await apply();
    expect(await told('E-HR')).toEqual([]);
    expect(await decide(MGR, leave, 'approved')).toBe('');
    expect((await rows<{ status: string }>(`select status from leave_application where id = '${leave}'`))[0].status).toBe('approved');
    const n = await told('E-HR');
    expect(n).toHaveLength(1);
    expect(n[0].title).toBe('Leave approved');
    expect(n[0].message).toMatch(/^Mia Staff's Annual Leave application \(3 days, 2030-11-04 to 2030-11-06\) was approved/);
    // the person who asked hears through the usual leave_approved, not this
    expect(await told('E-ME')).toEqual([]);
  });

  it('a rejection is told too', async () => {
    const leave = await apply();
    expect(await decide(MGR, leave, 'rejected')).toBe('');
    expect((await told('E-HR')).at(-1)?.title).toBe('Leave rejected');
  });

  it('requests already on their way keep what they started with', async () => {
    const leave = await apply();
    const steps = JSON.stringify([{ approver_type: 'reports_to' }]);
    await asUser(db, ADMIN, () => db.query(`select save_approval_workflow('leave', '${steps}'::jsonb, true, array[]::text[])`));
    const before = (await told('E-HR')).length;
    expect(await decide(MGR, leave, 'approved')).toBe('');
    expect((await told('E-HR')).length).toBe(before + 1);
    // a new one is not told
    const next = await apply();
    expect(await decide(MGR, next, 'approved')).toBe('');
    expect((await told('E-HR')).length).toBe(before + 1);
  });

  it('saving without roles leaves them as they are (the old screen)', async () => {
    const steps = JSON.stringify([{ approver_type: 'reports_to' }]);
    await asUser(db, ADMIN, () => db.query(`select save_approval_workflow('leave', '${steps}'::jsonb, true, array['HR'])`));
    await asUser(db, ADMIN, () => db.query(`select save_approval_workflow('leave', '${steps}'::jsonb, true)`));
    expect((await workflow()).notify_roles).toEqual(['HR']);
  });
});
