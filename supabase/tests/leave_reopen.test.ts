// @vitest-environment node
//
// Operations' final say on leave: Operations as the chain's last step, and sending approved leave back to pending
// (with a reason, before it starts), which refunds the days and starts the chain again.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const ADMIN = '00000000-0000-0000-0000-00000000f201';
const HR = '00000000-0000-0000-0000-00000000f202';
const OPS = '00000000-0000-0000-0000-00000000f203';
const MGR = '00000000-0000-0000-0000-00000000f204';
const ME = '00000000-0000-0000-0000-00000000f205';

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
const apply = async (start = '2030-11-04', end = '2030-11-06') =>
  (await asUser(db, ME, () => rows<{ id: string }>(
    `insert into leave_application ("Employee Number", name, "Leave Type", "Start Date", "End Date", status)
     values ('E-ME', 'Mia Staff', 'Annual Leave', '${start}', '${end}', 'pending') returning id`)))[0].id;
const request = async (leave: string) =>
  (await rows<{ id: string; status: string; current_step: number }>(
    `select id, status, current_step from approval_requests where record_id = '${leave}'`))[0];
const decide = async (user: string, leave: string, decision: string) => {
  const r = await request(leave);
  return asUser(db, user, () => run(`select decide_approval('${r.id}', '${decision}', '')`));
};
const reversals = async () =>
  Number((await rows<{ n: number }>(`select count(*)::int n from leave_balance_adjustments where change_type = 'approval_reversal'`))[0].n);
const approveAll = async (leave: string) => {
  for (const who of [MGR, HR, OPS]) expect(await decide(who, leave, 'approved')).toBe('');
};
const reopen = (user: string, leave: string, reason: string) =>
  asUser(db, user, () => run(`select reopen_leave('${leave}', '${reason}')`));
const leaveStatus = async (leave: string) =>
  (await rows<{ status: string }>(`select status from leave_application where id = '${leave}'`))[0].status;
const chain = async (user: string, leave: string) =>
  (await asUser(db, user, () => rows<{ status: string; can_reopen: boolean; reopened: { comment: string } | null; steps: { status: string }[] }>(
    `select status, can_reopen, reopened, steps from approval_chains('leave', array['${leave}']::uuid[])`)))[0];

beforeAll(async () => {
  db = await bootLiveDb();
  for (const [id, email, role, num, first] of [
    [ADMIN, 'adm@a.co', 'ADMIN', 'E-ADM', 'Ada'], [HR, 'hr@a.co', 'HR', 'E-HR', 'Hana'],
    [OPS, 'coo@a.co', 'OPERATIONS', 'E-OPS', 'Otis'], [MGR, 'mgr@a.co', 'STAFF', 'E-MGR', 'Max'],
    [ME, 'me@a.co', 'STAFF', 'E-ME', 'Mia'],
  ]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id, full_name) values ('${id}', '${email}', '${role}', '${A}', '${first}');
      insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", tenant_id) values ('${num}', '${first}', 'X', '${email}', '${A}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['leaves', 'employees'], '${A}'), ('OPERATIONS', array['leaves', 'reopen-leave'], '${A}'),
      ('STAFF', array['dashboard'], '${A}'), ('ADMIN', array['settings'], '${A}');
    update employees set manager_email = 'mgr@a.co' where "Employee Number" = 'E-ME';
    select seed_default_leave_types('${A}');
  `);
  // the COO's chain: line manager, then HR, then Operations last
  const steps = JSON.stringify([
    { approver_type: 'reports_to' }, { approver_type: 'role', approver_role: 'HR' }, { approver_type: 'role', approver_role: 'OPERATIONS' },
  ]);
  await asUser(db, ADMIN, () => db.query(`select save_approval_workflow('leave', '${steps}'::jsonb, true, array[]::text[])`));
}, 120000);

describe('Operations as the last step', () => {
  it('leave stays pending until Operations approves', async () => {
    const leave = await apply();
    expect(await decide(MGR, leave, 'approved')).toBe('');
    expect(await decide(HR, leave, 'approved')).toBe('');
    expect(await leaveStatus(leave)).toBe('pending');
    expect((await request(leave)).current_step).toBe(3);
    expect(await decide(OPS, leave, 'approved')).toBe('');
    expect(await leaveStatus(leave)).toBe('approved');
  });

  it('Operations can turn it down after the others approved', async () => {
    const leave = await apply();
    expect(await decide(MGR, leave, 'approved')).toBe('');
    expect(await decide(HR, leave, 'approved')).toBe('');
    expect(await decide(OPS, leave, 'rejected')).toBe('');
    expect(await leaveStatus(leave)).toBe('rejected');
  });
});

describe('reopening approved leave', () => {
  it('Operations sends it back to pending: the days come back, the chain starts again, the employee is told why', async () => {
    const leave = await apply();
    await approveAll(leave);
    expect((await chain(OPS, leave)).can_reopen).toBe(true);
    expect((await chain(HR, leave)).can_reopen).toBe(false);

    const before = await reversals();
    expect(await reopen(OPS, leave, 'Stock take that week')).toBe('');
    expect(await leaveStatus(leave)).toBe('pending');
    const r = await request(leave);
    expect(r.status).toBe('pending');
    expect(r.current_step).toBe(1);
    expect(await reversals()).toBe(before + 1);

    const c = await chain(OPS, leave);
    expect(c.reopened?.comment).toBe('Stock take that week');
    // the old approvals don't show as this round's
    expect(c.steps.map((s) => s.status)).toEqual(['current', 'upcoming', 'upcoming']);

    const n = await rows<{ title: string; message: string }>(
      `select title, message from hr_notifications where employee_number = 'E-ME' and notification_type = 'leave_reopened'`);
    expect(n).toHaveLength(1);
    expect(n[0].message).toMatch(/sent back to pending by Otis X/);
    expect(n[0].message).toMatch(/Stock take that week/);

    // and it goes through the whole chain again
    await approveAll(leave);
    expect(await leaveStatus(leave)).toBe('approved');
  });

  it('needs a reason', async () => {
    const leave = await apply();
    await approveAll(leave);
    expect(await reopen(OPS, leave, '  ')).toMatch(/Give a reason/);
    expect(await leaveStatus(leave)).toBe('approved');
  });

  it('only Operations or an admin', async () => {
    const leave = await apply();
    await approveAll(leave);
    expect(await reopen(HR, leave, 'no')).toMatch(/Only Operations/);
    expect(await reopen(MGR, leave, 'no')).toMatch(/Only Operations/);
    expect(await reopen(ADMIN, leave, 'Clash with audit')).toBe('');
  });

  it('a company can give the power to another role', async () => {
    const leave = await apply();
    await approveAll(leave);
    await db.exec(`update role_permissions set permissions = permissions || array['reopen-leave'] where role_name = 'HR' and tenant_id = '${A}'`);
    expect(await reopen(HR, leave, 'Busy week')).toBe('');
    await db.exec(`update role_permissions set permissions = array_remove(permissions, 'reopen-leave') where role_name = 'HR' and tenant_id = '${A}'`);
  });

  it('Operations is given the module once by the migration', async () => {
    expect(await rows(`select 1 from permissions where module_id = 'reopen-leave'`)).toHaveLength(1);
  });

  it('not once the leave has started', async () => {
    const leave = await apply('2020-01-06', '2020-01-07');
    await approveAll(leave);
    expect(await reopen(OPS, leave, 'too late')).toMatch(/already started/);
    expect((await chain(OPS, leave)).can_reopen).toBe(false);
  });

  it('only approved leave', async () => {
    const leave = await apply();
    expect(await reopen(OPS, leave, 'still pending')).toMatch(/Only approved leave/);
    expect(await decide(MGR, leave, 'rejected')).toBe('');
    expect(await reopen(OPS, leave, 'was rejected')).toMatch(/Only approved leave/);
  });
});

describe('decided leave is guarded too', () => {
  it('a direct update cannot undo an approval', async () => {
    const leave = await apply();
    await approveAll(leave);
    expect(await asUser(db, OPS, () => run(`update leave_application set status = 'pending' where id = '${leave}'`)))
      .toMatch(/has been approved/);
    expect(await asUser(db, HR, () => run(`update leave_application set status = 'rejected' where id = '${leave}'`)))
      .toMatch(/has been approved/);
    expect(await leaveStatus(leave)).toBe('approved');
  });
});
