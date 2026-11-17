// @vitest-environment node
//
// A school's leave approval chain (20261108400000_school_leave_chain.sql):
//   enable          platform_enable_hr() gives the school's company: 1. Leave Approver, 2. School admin (role ADMIN)
//   waiting on me   a teacher's application waits on the school's admin and is in their my_leave_approvals() (in HR and
//                   through My HR); deciding works through my_hr_leave_decide() (decide_approval())
//   one-off         platform_school_leave_chain(tenant): a school still on HR's default gets the school chain; a
//                   customised chain, or a company that is not a school's, is never touched; running it again changes
//                   nothing; pending requests keep their copy unless asked to reroute them
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const PT = '7a1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c20';
const PT_OLD = '7a1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c21'; // a school enabled before the school chain (like staging's Reu)
const PT_CUSTOM = '7a1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c22';
const U = {
  HEAD: '00000000-0000-0000-0000-00000000d101', // the school's admin (invited as ADMIN on enable)
  DEPUTY: '00000000-0000-0000-0000-00000000d102', // Mary's Leave Approver
  STAFF: '00000000-0000-0000-0000-00000000d103',
  OLD_HEAD: '00000000-0000-0000-0000-00000000d104',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the functions' JSON answers
type J = any;

let db: PGlite;
let school: string;
let oldSchool: string;
let custom: string;
let plain: string;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const val = async <T = J>(sql: string, params: unknown[] = []) => (await rows<{ v: T }>(sql, params))[0]?.v;
const failsWith = async (sql: string, params: unknown[] = []) => {
  try {
    await db.query(sql, params);
    return { code: '', message: '' };
  } catch (e) {
    return { code: (e as { code?: string }).code ?? '', message: (e as Error).message };
  }
};
const day = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const enable = async (pt: string, name: string, slug: string, admins: unknown[] = []) =>
  (await rows<{ tenant_id: string }>(`select tenant_id from platform_enable_hr($1, $2, $3, $4::jsonb)`, [pt, name, slug, JSON.stringify(admins)]))[0].tenant_id;
const chain = (tenant: string) =>
  rows<{ position: number; label: string | null; approver_type: string; approver_role: string | null; skip_if_requester: boolean }>(
    `select s.position, s.label, s.approver_type, s.approver_role, s.skip_if_requester
     from approval_steps s join approval_workflows w on w.id = s.workflow_id
     where w.tenant_id = $1 and w.kind = 'leave' order by s.position`, [tenant]);
const steps = async (tenant: string) => (await chain(tenant)).map((s) => [s.approver_type, s.approver_role, s.label]);
const HR_DEFAULT = [['leave_approver', null, null], ['role', 'HR', null]];
const SCHOOL = [['leave_approver', null, null], ['role', 'ADMIN', 'School admin']];
const run = (tenant: string, reroute?: boolean) =>
  reroute === undefined
    ? val(`select platform_school_leave_chain($1) v`, [tenant])
    : val(`select platform_school_leave_chain($1, $2) v`, [tenant, reroute]);
// a company enabled before the school chain: back on HR's default, as approval_workflow_create() made it
const backToHrDefault = (tenant: string) => db.query(
  `update approval_steps s set label = null, approver_role = 'HR'
   from approval_workflows w where w.id = s.workflow_id and w.tenant_id = $1 and w.kind = 'leave' and s.position = 2`, [tenant]);
const typeId = async (tenant: string, name: string) =>
  (await rows<{ id: string }>(`select id from leave_types where tenant_id = $1 and name = $2`, [tenant, name]))[0].id;
const apply = async (tenant: string, employee: string, offset: number) =>
  val(`select my_hr_leave_apply($1, $2, $3, $4, $4, false, 'Family matters to attend') v`,
    [tenant, employee, await typeId(tenant, 'Annual Leave'), day(offset)]);
const approvals = (tenant: string, user: string) => val<J[]>(`select my_hr_leave_approvals($1, $2) v`, [tenant, user]);
const decide = (tenant: string, user: string, application: string, decision: string, comment: string | null = null) =>
  val(`select my_hr_leave_decide($1, $2, $3, $4, $5) v`, [tenant, user, application, decision, comment]);

beforeAll(async () => {
  db = await bootLiveDb();
  school = await enable(PT, 'Hillside Primary', 'hillside', [{ email: 'head@hillside.ac.ke' }]);
  oldSchool = await enable(PT_OLD, 'Reu Academy', 'reu-academy', [{ email: 'old.head@reu.ac.ke' }]);
  custom = await enable(PT_CUSTOM, 'Custom School', 'custom-school', []);
  plain = (await rows<{ id: string }>(`insert into tenants (name, slug, plan, status) values ('Acme Ltd', 'acme-ltd', 'trial', 'active') returning id`))[0].id;
  await db.exec(`
    delete from holidays where source = 'auto';
    insert into auth.users (id, email) values
      ('${U.HEAD}', 'head@hillside.ac.ke'), ('${U.DEPUTY}', 'dee@hillside.ac.ke'), ('${U.STAFF}', 'sam@hillside.ac.ke'),
      ('${U.OLD_HEAD}', 'old.head@reu.ac.ke');
    -- the invitations accepted: the head is an ADMIN of the school (and has no employee record)
    insert into user_profiles (user_id, email, role, tenant_id, full_name) values
      ('${U.HEAD}', 'head@hillside.ac.ke', 'ADMIN', '${school}', 'Hope Head'),
      ('${U.DEPUTY}', 'dee@hillside.ac.ke', 'STAFF', '${school}', 'Dee Deputy'),
      ('${U.STAFF}', 'sam@hillside.ac.ke', 'STAFF', '${school}', 'Sam Staff'),
      ('${U.OLD_HEAD}', 'old.head@reu.ac.ke', 'ADMIN', '${oldSchool}', 'Olive Head');
    insert into role_permissions (role_name, permissions, tenant_id) values ('STAFF', array['dashboard'], '${school}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Start Date", "Town", onboarding_status, "Leave Approver", tenant_id) values
      ('E1', 'Mary', 'Teacher', 'mary@hillside.ac.ke', '2024-01-01', 'Nairobi', 'approved', 'Dee Deputy', '${school}'),
      ('E2', 'John', 'Teacher', 'john@hillside.ac.ke', '2024-01-01', 'Nairobi', 'approved', null, '${school}'),
      ('E-D', 'Dee', 'Deputy', 'dee@hillside.ac.ke', '2020-01-01', null, 'approved', null, '${school}'),
      ('E-S', 'Sam', 'Staff', 'sam@hillside.ac.ke', '2020-01-01', null, 'approved', null, '${school}'),
      ('R1', 'Rita', 'Teacher', 'rita@reu.ac.ke', '2024-01-01', 'Nairobi', 'approved', null, '${oldSchool}');
    insert into external_people (tenant_id, employee_number, source, external_id) values
      ('${school}', 'E1', 'schools', 'person-mary'), ('${school}', 'E2', 'schools', 'person-john'),
      ('${oldSchool}', 'R1', 'schools', 'person-rita');
    insert into external_logins (tenant_id, source, external_id, user_id) values
      ('${school}', 'schools', 'person-head', '${U.HEAD}'), ('${school}', 'schools', 'person-deputy', '${U.DEPUTY}'),
      ('${school}', 'schools', 'person-staff', '${U.STAFF}'), ('${oldSchool}', 'schools', 'person-old-head', '${U.OLD_HEAD}');
  `);
}, 180000);

describe('enable: the school company\'s leave chain', () => {
  it('is the Leave Approver, then the school\'s admins (role ADMIN), each skipped for the person asking', async () => {
    expect(await chain(school)).toEqual([
      { position: 1, label: null, approver_type: 'leave_approver', approver_role: null, skip_if_requester: true },
      { position: 2, label: 'School admin', approver_type: 'role', approver_role: 'ADMIN', skip_if_requester: true },
    ]);
    // nobody chose it in Settings, and admins may still act at any step as before
    expect(await rows(`select updated_by, admins_can_act from approval_workflows where tenant_id = $1 and kind = 'leave'`, [school]))
      .toEqual([{ updated_by: null, admins_can_act: true }]);
  });
  it('the invitations are still ADMIN only: nobody is given HR', async () => {
    expect(await rows(`select distinct role from invite_queue where tenant_id = $1`, [school])).toEqual([{ role: 'ADMIN' }]);
  });
  it('a company that is not a school\'s keeps HR\'s default chain', async () => {
    expect(await steps(plain)).toEqual(HR_DEFAULT);
  });
  it('the form shows the employee the chain they would go through', async () => {
    const f = await val(`select my_hr_leave_form($1, 'E2') v`, [school]);
    expect(f.approval_chain.map((s: J) => [s.label, s.skipped])).toEqual([['Leave approver', true], ['School admin', false]]);
  });
});

describe('a teacher\'s leave waits on the school\'s admin', () => {
  it('with no Leave Approver: straight to the head, in their "Leave to approve"; they approve it through My HR', async () => {
    const a = await apply(school, 'E2', 14);
    expect(a.approval.steps.map((s: J) => [s.label, s.status])).toEqual([['Leave approver', 'skipped'], ['School admin', 'current']]);
    const mine = await approvals(school, U.HEAD);
    expect(mine.map((i: J) => [i.application_id, i.step_label])).toEqual([[a.id, 'School admin']]);
    // HR's own "waiting on me" for the signed-in head says the same
    const inHr = await asUser(db, U.HEAD, () => rows<{ record_id: string; step_label: string }>(`select record_id, step_label from my_leave_approvals()`));
    expect(inHr).toEqual([{ record_id: a.id, step_label: 'School admin' }]);
    expect(await approvals(school, U.STAFF)).toEqual([]);
    expect(await failsWith(`select my_hr_leave_decide($1, $2, $3, 'approved', null)`, [school, U.STAFF, a.id]))
      .toMatchObject({ code: '42501' });

    const r = await decide(school, U.HEAD, a.id, 'approved', 'Fine');
    expect(r.request_status).toBe('approved');
    expect(r.application.status).toBe('approved');
    expect(r.application.approval.steps[1]).toMatchObject({ status: 'approved', actor_name: 'Hope Head' });
    // as the step's approver (its role), not as an admin stepping in
    expect(await rows(`select x.step, x.acted_as from approval_actions x join approval_requests q on q.id = x.request_id
                       where q.record_id = $1 and x.decision = 'approved'`, [a.id])).toEqual([{ step: 2, acted_as: 'approver' }]);
    expect(await approvals(school, U.HEAD)).toEqual([]);
  });

  it('with a Leave Approver: the deputy first, then the head, who can decline it with a reason', async () => {
    const a = await apply(school, 'E1', 21);
    expect((await approvals(school, U.DEPUTY)).map((i: J) => i.application_id)).toEqual([a.id]);
    // not the head's yet ("waiting on me" leaves out what they could only do as an admin)
    expect(await approvals(school, U.HEAD)).toEqual([]);
    expect((await decide(school, U.DEPUTY, a.id, 'approved')).request_status).toBe('pending');
    expect((await approvals(school, U.HEAD)).map((i: J) => [i.application_id, i.step_label])).toEqual([[a.id, 'School admin']]);
    expect(await approvals(school, U.DEPUTY)).toEqual([]);
    const r = await decide(school, U.HEAD, a.id, 'rejected', 'Exams that week');
    expect(r.request_status).toBe('rejected');
    expect(r.application.approval.steps.map((s: J) => [s.status, s.actor_name])).toEqual([['approved', 'Dee Deputy'], ['rejected', 'Hope Head']]);
  });
});

describe('platform_school_leave_chain(): the one-off for schools enabled before', () => {
  let pending: J;
  it('a school still on HR\'s default gets the school chain; its pending request keeps its copy (waiting on HR)', async () => {
    await backToHrDefault(oldSchool);
    pending = await apply(oldSchool, 'R1', 14);
    expect(pending.approval.steps.map((s: J) => [s.label, s.status])).toEqual([['Leave approver', 'skipped'], ['HR', 'current']]);
    expect(await approvals(oldSchool, U.OLD_HEAD)).toEqual([]);

    expect(await run(oldSchool)).toEqual({ tenant_id: oldSchool, chain: 'set', rerouted: 0 });
    expect(await steps(oldSchool)).toEqual(SCHOOL);
    expect(await approvals(oldSchool, U.OLD_HEAD)).toEqual([]);
    // a new application goes the new way
    const fresh = await apply(oldSchool, 'R1', 30);
    expect((await approvals(oldSchool, U.OLD_HEAD)).map((i: J) => i.application_id)).toEqual([fresh.id]);
  });

  it('again changes nothing; asked to reroute, the request still on HR\'s default copy moves to the school\'s admins at the same step', async () => {
    expect(await run(oldSchool)).toEqual({ tenant_id: oldSchool, chain: 'already_school', rerouted: 0 });
    expect(await run(oldSchool, true)).toEqual({ tenant_id: oldSchool, chain: 'already_school', rerouted: 1 });
    expect(await rows(`select current_step, status from approval_requests where record_id = $1`, [pending.id]))
      .toEqual([{ current_step: 2, status: 'pending' }]);
    const mine = await approvals(oldSchool, U.OLD_HEAD);
    expect(mine.map((i: J) => [i.application_id, i.step_label]).sort()).toContainEqual([pending.id, 'School admin']);
    expect(mine).toHaveLength(2);
    expect(await run(oldSchool, true)).toEqual({ tenant_id: oldSchool, chain: 'already_school', rerouted: 0 });
    expect((await decide(oldSchool, U.OLD_HEAD, pending.id, 'approved')).request_status).toBe('approved');
  });

  it('never touches a chain the school customised', async () => {
    // saved from Settings (HR's default steps, chosen on purpose)
    await backToHrDefault(custom);
    await db.query(`update approval_workflows set updated_by = $2 where tenant_id = $1 and kind = 'leave'`, [custom, U.HEAD]);
    expect(await run(custom, true)).toEqual({ tenant_id: custom, chain: 'customised', rerouted: 0 });
    expect(await steps(custom)).toEqual(HR_DEFAULT);
    // other steps (a bursar added after the school's admins)
    await db.query(`update approval_workflows set updated_by = null where tenant_id = $1 and kind = 'leave'`, [custom]);
    await db.query(`update approval_steps s set label = 'School admin', approver_role = 'ADMIN'
      from approval_workflows w where w.id = s.workflow_id and w.tenant_id = $1 and w.kind = 'leave' and s.position = 2`, [custom]);
    await db.query(`insert into approval_steps (tenant_id, workflow_id, position, label, approver_type, approver_role)
      select $1, w.id, 3, 'Bursar', 'role', 'CHECKER' from approval_workflows w where w.tenant_id = $1 and w.kind = 'leave'`, [custom]);
    expect(await run(custom)).toMatchObject({ chain: 'customised' });
    expect(await steps(custom)).toEqual([...SCHOOL, ['role', 'CHECKER', 'Bursar']]);
  });

  it('never touches a company that is not a school\'s, nor its requests', async () => {
    expect(await run(plain, true)).toEqual({ tenant_id: plain, chain: 'not_school', rerouted: 0 });
    expect(await steps(plain)).toEqual(HR_DEFAULT);
    expect(await run('00000000-0000-0000-0000-0000000000ff')).toMatchObject({ chain: 'not_school' });
  });

  it('is the server\'s only', async () => {
    expect(await asUser(db, U.HEAD, () => failsWith(`select platform_school_leave_chain($1)`, [school])))
      .toMatchObject({ message: expect.stringMatching(/permission denied/) });
  });
});
