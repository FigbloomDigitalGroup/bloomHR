// @vitest-environment node
//
// Approval workflows (20261015800000, FIG-829): every company starts with today's leave chain (the Leave Approver
// recommends, then HR approves); a company can set its own ordered steps; only the current step's approver decides,
// in order; a rejection ends it; a step whose approver is the person asking is skipped; one company never sees or
// decides another's; pending applications made before are put on the chain at the step they reached.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootDb, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const U = {
  ADMIN: '00000000-0000-0000-0000-00000000e801',
  HR: '00000000-0000-0000-0000-00000000e802',
  LA: '00000000-0000-0000-0000-00000000e803', // Lea Approver, the Leave Approver of the staff
  MGR: '00000000-0000-0000-0000-00000000e804', // the staff's line manager (manager_email)
  CTO: '00000000-0000-0000-0000-00000000e805',
  ME: '00000000-0000-0000-0000-00000000e806',
  SOLO: '00000000-0000-0000-0000-00000000e807', // has no Leave Approver and no manager
  OTHER: '00000000-0000-0000-0000-00000000e808',
  B_ADMIN: '00000000-0000-0000-0000-00000000e809',
};
// [user, email, role, tenant, employee number, first, last]
const PEOPLE: [string, string, string, string, string, string, string][] = [
  [U.ADMIN, 'adm@a.co', 'ADMIN', A, 'E-ADM', 'Ada', 'Admin'],
  [U.HR, 'hr@a.co', 'HR', A, 'E-HR', 'Hana', 'Hr'],
  [U.LA, 'lea@a.co', 'STAFF', A, 'E-LA', 'Lea', 'Approver'],
  [U.MGR, 'mgr@a.co', 'STAFF', A, 'E-MGR', 'Max', 'Manager'],
  [U.CTO, 'cto@a.co', 'STAFF', A, 'E-CTO', 'Chris', 'Cto'],
  [U.ME, 'me@a.co', 'STAFF', A, 'E-ME', 'Mia', 'Staff'],
  [U.SOLO, 'solo@a.co', 'STAFF', A, 'E-SOLO', 'Sol', 'Alone'],
  [U.OTHER, 'other@a.co', 'STAFF', A, 'E-OTHER', 'Otto', 'Other'],
  [U.B_ADMIN, 'adm@b.co', 'ADMIN', B, 'E-BADM', 'Bea', 'Admin'],
];

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
const apply = async (user: string, employee: string, type = 'Annual Leave') =>
  (await asUser(db, user, () => rows<{ id: string }>(
    `insert into leave_application ("Employee Number", name, "Leave Type", "Start Date", "End Date", days, status)
     values ('${employee}', 'Applicant ${employee}', '${type}', '2026-11-02', '2026-11-04', 3, 'pending') returning id`)))[0].id;
const request = async (leave: string) =>
  (await rows<{ id: string; status: string; current_step: number; steps: unknown[] }>(
    `select id, status, current_step, steps from approval_requests where record_id = '${leave}'`))[0];
const leave = async (id: string) =>
  (await rows<Record<string, unknown>>(`select status, recstatus, notes, recommendation_notes from leave_application where id = '${id}'`))[0];
const decide = async (user: string, leaveId: string, decision: string, comment = '') => {
  const r = await request(leaveId);
  return asUser(db, user, () => run(`select decide_approval('${r.id}', '${decision}', '${comment}')`));
};
const chain = async (user: string, leaveId: string) =>
  (await asUser(db, user, () => rows<{ status: string; can_approve: boolean; can_reject: boolean; steps: Record<string, unknown>[] }>(
    `select * from approval_chains('leave', array['${leaveId}']::uuid[])`)))[0];
const notes = async (employee: string, type: string) =>
  (await rows<{ message: string }>(
    `select message from hr_notifications where employee_number = '${employee}' and notification_type = '${type}' order by id`)).map((r) => r.message);
const setWorkflow = (user: string, steps: unknown[], admins = true) =>
  asUser(db, user, () => run(`select save_approval_workflow('leave', '${JSON.stringify(steps)}'::jsonb, ${admins})`));

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  for (const [id, email, role, tenant, number, first, last] of PEOPLE) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id, full_name) values ('${id}', '${email}', '${role}', '${tenant}', '${first} ${last}');
      insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", tenant_id) values ('${number}', '${first}', '${last}', '${email}', '${tenant}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['leaves', 'employees'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    -- typed the way Add/Edit Employee saves it: a name
    update employees set "Leave Approver" = 'lea  approver', "Alternate Approver" = 'Otto Other', manager_email = ' MGR@a.co '
      where "Employee Number" in ('E-ME', 'E-CTO', 'E-OTHER') and tenant_id = '${A}';
    update employees set "Alternate Approver" = null where "Employee Number" = 'E-OTHER';
    -- the leave types applications name; balances are not what these tests are about (leave_rules.test.ts)
    select seed_default_leave_types('${A}');
    select seed_default_leave_types('${B}');
    update leave_policies set balance_rule = 'none';
  `);
}, 120000);

describe('the default leave workflow is today\'s', () => {
  it('every company has it: the Leave Approver, then HR, and admins may act', async () => {
    const wf = await rows(`
      select w.tenant_id, w.admins_can_act, array_agg(s.approver_type || coalesce(':' || s.approver_role, '') order by s.position) steps
      from approval_workflows w join approval_steps s on s.workflow_id = w.id where w.kind = 'leave' group by 1, 2 order by 1`);
    expect(wf).toEqual([
      { tenant_id: A, admins_can_act: true, steps: ['leave_approver', 'role:HR'] },
      { tenant_id: B, admins_can_act: true, steps: ['leave_approver', 'role:HR'] },
    ]);
  });

  it('the Leave Approver recommends, then HR approves, writing what the Leave page wrote', async () => {
    const id = await apply(U.ME, 'E-ME');
    expect(await request(id)).toMatchObject({ status: 'pending', current_step: 1 });
    expect(await notes('E-LA', 'approval_needed')).toHaveLength(1);
    // the alternate approver hears too
    expect(await notes('E-OTHER', 'approval_needed')).toHaveLength(1);

    // HR cannot approve before the recommendation (but sees who it waits on)
    expect(await decide(U.HR, id, 'approved')).toMatch(/not the approver/);
    const before = await chain(U.HR, id);
    expect(before).toMatchObject({ status: 'pending', can_approve: false, can_reject: true });
    expect(before.steps.map((s) => [s.label, s.status, s.waiting_on ?? null])).toEqual([
      ['Leave approver', 'current', 'Lea Approver or Otto Other'],
      ['HR', 'upcoming', null],
    ]);

    expect(await decide(U.LA, id, 'approved', 'fine by me')).toBe('');
    expect(await leave(id)).toEqual({ status: 'pending', recstatus: 'recommended', notes: null, recommendation_notes: 'fine by me' });
    expect(await request(id)).toMatchObject({ status: 'pending', current_step: 2 });
    expect(await notes('E-ME', 'leave_recommended')).toEqual([
      "Lea Approver approved Applicant E-ME's Annual Leave application (3 days, 2026-11-02 to 2026-11-04). Awaiting HR approval.",
    ]);
    expect(await notes('E-ME', 'approval_progress')).toHaveLength(1);

    expect(await decide(U.HR, id, 'approved', 'enjoy')).toBe('');
    expect(await leave(id)).toEqual({ status: 'approved', recstatus: 'recommended', notes: 'enjoy', recommendation_notes: 'fine by me' });
    expect(await notes('E-ME', 'leave_approved')).toEqual([
      'Your Annual Leave application (3 days, 2026-11-02 to 2026-11-04) has been approved.',
    ]);
    const done = await chain(U.ME, id);
    expect(done.steps.map((s) => [s.status, s.actor_name, s.comment])).toEqual([
      ['approved', 'Lea Approver', 'fine by me'],
      ['approved', 'Hana Hr', 'enjoy'],
    ]);
  });

  it('an employee without a Leave Approver goes straight to HR', async () => {
    const id = await apply(U.SOLO, 'E-SOLO');
    expect(await request(id)).toMatchObject({ status: 'pending', current_step: 2 });
    expect((await chain(U.HR, id)).steps.map((s) => s.status)).toEqual(['skipped', 'current']);
    expect(await decide(U.HR, id, 'approved')).toBe('');
    expect((await leave(id)).status).toBe('approved');
  });

  it('HR may reject before the recommendation, and an admin may act at any step', async () => {
    const id = await apply(U.ME, 'E-ME');
    expect(await decide(U.HR, id, 'rejected', 'too busy')).toBe('');
    expect(await leave(id)).toEqual({ status: 'rejected', recstatus: null, notes: 'too busy', recommendation_notes: null });

    const id2 = await apply(U.ME, 'E-ME');
    expect(await decide(U.ADMIN, id2, 'approved')).toBe('');
    expect(await decide(U.ADMIN, id2, 'approved')).toBe('');
    expect((await leave(id2)).status).toBe('approved');
  });
});

describe('only the current approver decides, in order', () => {
  it('nobody else: not a colleague, not the employee, not a later step approving early', async () => {
    const id = await apply(U.ME, 'E-ME');
    expect(await decide(U.CTO, id, 'approved')).toMatch(/not the approver/);
    expect(await decide(U.ME, id, 'approved')).toMatch(/your own request/);
    expect(await decide(U.HR, id, 'approved')).toMatch(/not the approver/);
    expect(await decide(U.LA, id, 'maybe')).toMatch(/approved or rejected/);
    expect(await request(id)).toMatchObject({ status: 'pending', current_step: 1 });
    // ...and the application cannot be decided around the chain
    expect(await asUser(db, U.HR, () => run(`update leave_application set status = 'approved' where id = '${id}'`)))
      .toMatch(/waiting on its approvers/);
    expect(await asUser(db, U.HR, () => run(`update leave_application set reason = 'edited' where id = '${id}'`))).toBe('');
    // nor written directly
    expect(await asUser(db, U.HR, () => rows(`update approval_requests set status = 'approved' returning 1`))).toEqual([]);
    expect(await asUser(db, U.HR, () => run(`insert into approval_actions (request_id, step, decision, acted_as) select id, 1, 'approved', 'approver' from approval_requests limit 1`)))
      .toMatch(/row-level security/);
  });

  it('a company chain of line manager, HR and a named person goes step by step', async () => {
    const cto = (await rows<{ id: string }>(`select id from employees where "Employee Number" = 'E-CTO'`))[0].id;
    expect(await setWorkflow(U.ADMIN, [
      { approver_type: 'reports_to' },
      { approver_type: 'role', approver_role: 'HR' },
      { approver_type: 'person', approver_employee_id: cto, label: 'CTO' },
    ], false)).toBe('');
    const id = await apply(U.ME, 'E-ME');
    expect((await chain(U.ME, id)).steps.map((s) => s.label)).toEqual(['Line manager', 'HR', 'CTO']);
    expect(await notes('E-MGR', 'approval_needed')).toHaveLength(1);

    expect(await decide(U.CTO, id, 'approved')).toMatch(/not the approver/);
    expect(await decide(U.ADMIN, id, 'approved')).toMatch(/not the approver/); // admins may not act on this workflow
    expect(await decide(U.MGR, id, 'approved')).toBe('');
    expect(await decide(U.MGR, id, 'approved')).toMatch(/not the approver/);
    expect(await decide(U.CTO, id, 'approved')).toMatch(/not the approver/);
    expect(await decide(U.HR, id, 'approved')).toBe('');
    expect((await leave(id)).status).toBe('pending');
    expect(await notes('E-CTO', 'approval_needed')).toHaveLength(1);
    expect(await decide(U.CTO, id, 'approved', 'ok')).toBe('');
    expect((await leave(id)).status).toBe('approved');
    expect(await request(id)).toMatchObject({ status: 'approved', current_step: 3 });
  });

  it('a rejection at any step ends it', async () => {
    const id = await apply(U.ME, 'E-ME');
    expect(await decide(U.MGR, id, 'approved')).toBe('');
    expect(await decide(U.HR, id, 'rejected', 'short staffed')).toBe('');
    expect(await request(id)).toMatchObject({ status: 'rejected', current_step: 2 });
    expect(await leave(id)).toMatchObject({ status: 'rejected', recstatus: 'not_recommended', notes: 'short staffed' });
    expect(await decide(U.CTO, id, 'approved')).toMatch(/already been rejected/);
    expect((await notes('E-ME', 'leave_rejected')).at(-1)).toMatch(/has been rejected\. Reason: short staffed\./);
    expect((await chain(U.ME, id)).steps.map((s) => s.status)).toEqual(['approved', 'rejected', 'not_reached']);
  });

  it('a step whose approver is the person asking is skipped', async () => {
    const id = await apply(U.CTO, 'E-CTO');
    expect(await decide(U.MGR, id, 'approved')).toBe('');
    expect(await decide(U.HR, id, 'approved')).toBe('');
    // the CTO step is theirs: skipped, so HR's approval was the last
    expect((await leave(id)).status).toBe('approved');
    expect((await chain(U.CTO, id)).steps.map((s) => s.status)).toEqual(['approved', 'approved', 'skipped']);
  });

  it('when every step is passed over, an admin decides', async () => {
    expect(await setWorkflow(U.ADMIN, [{ approver_type: 'reports_to' }])).toBe('');
    const id = await apply(U.SOLO, 'E-SOLO');
    const r = await request(id);
    expect(r).toMatchObject({ status: 'pending', current_step: 2 });
    expect(await decide(U.HR, id, 'approved')).toMatch(/not the approver/);
    expect(await decide(U.ADMIN, id, 'approved')).toBe('');
    expect((await leave(id)).status).toBe('approved');
  });

  it('a request keeps the steps it started with when the workflow changes', async () => {
    expect(await setWorkflow(U.ADMIN, [{ approver_type: 'reports_to' }, { approver_type: 'role', approver_role: 'HR' }])).toBe('');
    const id = await apply(U.ME, 'E-ME');
    expect(await setWorkflow(U.ADMIN, [{ approver_type: 'role', approver_role: 'HR' }])).toBe('');
    expect((await request(id)).steps).toHaveLength(2);
    expect(await decide(U.HR, id, 'approved')).toMatch(/not the approver/);
    expect(await decide(U.MGR, id, 'approved')).toBe('');
  });
});

describe('setting up workflows', () => {
  it('ADMIN (and Settings) set them up; HR and staff cannot', async () => {
    expect(await setWorkflow(U.HR, [{ approver_type: 'role', approver_role: 'HR' }])).toMatch(/Only an admin/);
    expect(await setWorkflow(U.ME, [{ approver_type: 'role', approver_role: 'HR' }])).toMatch(/Only an admin/);
    expect(await asUser(db, U.HR, () => rows(`delete from approval_steps returning 1`))).toEqual([]);
  });

  it('people are chosen by employee number, and the screen reads them back with their names', async () => {
    expect(await setWorkflow(U.ADMIN, [
      { approver_type: 'person', approver_employee_number: 'E-CTO', label: 'CTO', alternate_type: 'person', alternate_employee_number: 'E-HR' },
    ])).toBe('');
    const [{ w }] = await asUser(db, U.HR, () => rows<{ w: { steps: Record<string, unknown>[] } }>(`select approval_workflow('leave') w`));
    expect(w.steps).toEqual([expect.objectContaining({
      approver_type: 'person', label: 'CTO', approver_employee_number: 'E-CTO', approver_name: 'Chris Cto',
      alternate_type: 'person', alternate_employee_number: 'E-HR', alternate_name: 'Hana Hr',
    })]);
    const [{ w: other }] = await asUser(db, U.B_ADMIN, () => rows<{ w: { steps: Record<string, unknown>[] } }>(`select approval_workflow('leave') w`));
    expect(other.steps.map((s) => s.approver_type)).toEqual(['leave_approver', 'role']);
  });

  it('checks the steps', async () => {
    expect(await setWorkflow(U.ADMIN, [])).toMatch(/between 1 and 10/);
    expect(await setWorkflow(U.ADMIN, [{ approver_type: 'person' }])).toMatch(/Choose who approves at step 1/);
    expect(await setWorkflow(U.ADMIN, [{ approver_type: 'nobody' }])).toMatch(/check/);
    expect(await setWorkflow(U.ADMIN, [{ approver_type: 'role' }])).toMatch(/check/);
  });

  it('department heads are offered only where departments exist', async () => {
    // departments come with the org structure (FIG-826): before it, department head is refused; with it, offered
    const [{ has }] = await rows<{ has: boolean }>(
      `select to_regclass('public.departments') is not null
          and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'employees' and column_name = 'department_id') as has`
    );
    expect((await asUser(db, U.ADMIN, () => rows(`select approval_department_head_available() as ok`)))[0]).toEqual({ ok: has });
    if (has) expect(await setWorkflow(U.ADMIN, [{ approver_type: 'department_head' }])).toBe('');
    else expect(await setWorkflow(U.ADMIN, [{ approver_type: 'department_head' }])).toMatch(/Departments are not set up/);
  });

  it('a new company starts with the default', async () => {
    await db.exec(`insert into tenants (id, name, slug) values ('00000000-0000-0000-0000-0000000000c3', 'New Co', 'new-co')`);
    const [n] = await rows<{ n: number }>(`select count(*)::int n from approval_steps s join approval_workflows w on w.id = s.workflow_id
      where w.tenant_id = '00000000-0000-0000-0000-0000000000c3'`);
    expect(n.n).toBe(2);
  });
});

describe('who sees what', () => {
  it('the employee sees their own requests, approvers theirs, HR all; one company never another', async () => {
    expect(await setWorkflow(U.ADMIN, [{ approver_type: 'leave_approver' }, { approver_type: 'role', approver_role: 'HR' }])).toBe('');
    const id = await apply(U.ME, 'E-ME');
    const seen = async (user: string) => (await asUser(db, user, () => rows(`select 1 from approval_requests where record_id = '${id}'`))).length;
    expect(await seen(U.ME)).toBe(1);
    expect(await seen(U.LA)).toBe(1);
    expect(await seen(U.HR)).toBe(1);
    expect(await seen(U.MGR)).toBe(0);
    expect(await seen(U.B_ADMIN)).toBe(0);
    expect(await chain(U.MGR, id)).toBeUndefined();
    expect(await chain(U.B_ADMIN, id)).toBeUndefined();
    expect(await decide(U.B_ADMIN, id, 'approved')).toMatch(/not found/);
    expect(await decide(U.B_ADMIN, id, 'rejected')).toMatch(/not found/);
    expect((await asUser(db, U.B_ADMIN, () => rows(`select 1 from approval_workflows where tenant_id = '${A}'`))).length).toBe(0);
  });

  it('what waits on me lists the leave my step decides', async () => {
    const mine = await asUser(db, U.LA, () => rows<{ employee_number: string; step_label: string }>(`select * from my_leave_approvals()`));
    expect(mine.map((m) => [m.employee_number, m.step_label])).toContainEqual(['E-ME', 'Leave approver']);
    expect(await asUser(db, U.CTO, () => rows(`select * from my_leave_approvals()`))).toEqual([]);
  });

  it('deleting an application deletes its request', async () => {
    const id = await apply(U.ME, 'E-ME');
    await db.exec(`delete from leave_application where id = '${id}'`);
    expect(await request(id)).toBeUndefined();
  });
});

describe('pending applications made before workflows (20261015800000)', () => {
  let old: PGlite;
  beforeAll(async () => {
    old = await bootDb({
      file: '20261015800000_approval_workflows.sql',
      seed: async (d) => {
        await d.exec(`
          insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Leave Approver", tenant_id) values
            ('E-LA', 'Lea', 'Approver', 'lea@a.co', null, '${A}'), ('E-1', 'One', 'X', 'one@a.co', 'Lea Approver', '${A}'),
            ('E-2', 'Two', 'X', 'two@a.co', null, '${A}');
          insert into leave_application (id, "Employee Number", status, recstatus, recommendation_notes, tenant_id) values
            ('00000000-0000-0000-0000-0000000a0001', 'E-1', 'pending', 'recommended', 'ok', '${A}'),
            ('00000000-0000-0000-0000-0000000a0002', 'E-1', 'Pending', null, null, '${A}'),
            ('00000000-0000-0000-0000-0000000a0003', 'E-2', 'pending', null, null, '${A}'),
            ('00000000-0000-0000-0000-0000000a0004', 'E-1', 'approved', 'recommended', null, '${A}');
        `);
      },
    });
  }, 120000);

  it('puts each at the step it reached, and leaves decided ones alone', async () => {
    const r = (await old.query(`select record_id, status, current_step from approval_requests order by record_id`)).rows;
    expect(r).toEqual([
      { record_id: '00000000-0000-0000-0000-0000000a0001', status: 'pending', current_step: 2 },
      { record_id: '00000000-0000-0000-0000-0000000a0002', status: 'pending', current_step: 1 },
      { record_id: '00000000-0000-0000-0000-0000000a0003', status: 'pending', current_step: 2 },
    ]);
    const a = (await old.query(`select decision, comment from approval_actions a join approval_requests r on r.id = a.request_id
      where r.record_id = '00000000-0000-0000-0000-0000000a0001'`)).rows;
    expect(a).toEqual([{ decision: 'approved', comment: 'ok' }]);
  });

  it('without notifying anyone', async () => {
    expect((await old.query(`select 1 from hr_notifications`)).rows).toEqual([]);
  });
});
