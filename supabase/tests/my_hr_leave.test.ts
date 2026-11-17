// @vitest-environment node
//
// Leave in Figbloom Schools, run by HR (20261108300000_my_hr_leave.sql, ERP/SCHOOLS_HR_LEAVE_CONTRACT.md section 2):
//   the form       the company's types with their rules, balances, and the approval chain the employee would go through
//   applying       HR's own applicant checks (notice, most days, balance, document with the application...), each refusal
//                  in HR's words; the chain starts and the approver hears, as for the staff portal
//   approving      only HR's "waiting on me", and decide_approval() as that HR login (found only through
//                  external_logins): another login is refused; a login working in another company is switched in for
//                  the decision and back
//   events         hr.leave.approved once when finally approved; hr.leave.cancelled once when cancelled; a date change
//                  while approved is cancelled + approved with the same id; nothing for other changes
//   cancelling     the employee's own, while pending or before an approved leave starts; the days go back
//   history        idempotent on the source id, a dry run writes nothing, no notifications, no events, counted in balances
//   isolation      another company's application, employee or login is never reached
//   overlaps       refused on every path (HR, staff portal, My HR, the import), adjacent days and declined or
//                  cancelled ones fine, two half days on one day overlap (HR doesn't record which half), existing
//                  overlaps left alone
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const PT = '7a1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c10';
const PT_OTHER = '8b2c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c11';
const U = {
  PRINCIPAL: '00000000-0000-0000-0000-00000000c101', // Mary's Leave Approver
  HR: '00000000-0000-0000-0000-00000000c102', // HR in the school, but working in the other company right now
  STAFF: '00000000-0000-0000-0000-00000000c103', // linked, approves nothing
  GONE: '00000000-0000-0000-0000-00000000c104', // linked, membership suspended
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the functions' JSON answers
type J = any;

let db: PGlite;
let school: string;
let other: string;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const val = async <T = J>(sql: string, params: unknown[] = []) => (await rows<{ v: T }>(sql, params))[0]?.v;
const fails = async (sql: string, params: unknown[] = []) => {
  try {
    await db.query(sql, params);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const failsWith = async (sql: string, params: unknown[] = []) => {
  try {
    await db.query(sql, params);
    return { code: '', message: '' };
  } catch (e) {
    return { code: (e as { code?: string }).code ?? '', message: (e as Error).message };
  }
};
// a weekday `offset` days from today
const day = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
// the weekday after a date (day(14) and day(15) are the same Monday when day 14 falls on a Sunday)
const dayAfter = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
};
const typeId = async (tenant: string, name: string) =>
  (await rows<{ id: string }>(`select id from leave_types where tenant_id = $1 and name = $2`, [tenant, name]))[0].id;
const apply = (args: { type: string; start: string; end: string; half?: boolean; reason?: string; doc?: string | null; employee?: string; tenant?: string }) =>
  val(`select my_hr_leave_apply($1, $2, $3, $4, $5, $6, $7, $8, $9) v`, [
    args.tenant ?? school, args.employee ?? 'E1', args.type, args.start, args.end, args.half ?? false,
    args.reason ?? 'Family matters to attend', args.doc ?? null, args.doc ? 'report.pdf' : null,
  ]);
const applyError = async (args: Parameters<typeof apply>[0]) => {
  try {
    await apply(args);
    return { code: '', message: '' };
  } catch (e) {
    return { code: (e as { code?: string }).code ?? '', message: (e as Error).message };
  }
};
const events = async (applicationId: string) =>
  rows<{ event_type: string; dedupe_key: string; data: J }>(
    `select event_type, dedupe_key, data from platform_event_outbox where tenant_id = $1 and data ->> 'application_id' = $2
     order by split_part(dedupe_key, ':', 2)::int`, [school, applicationId]);
const used = async (employee: string, type: string) =>
  Number((await val(`select coalesce(sum(used_days), 0) v from leave_balances where tenant_id = $1 and employee_number = $2 and leave_type_id = $3`,
    [school, employee, await typeId(school, type)])) ?? 0);
const approvals = (user: string) => val<J[]>(`select my_hr_leave_approvals($1, $2) v`, [school, user]);
const decide = (user: string, application: string, decision: string, comment: string | null = null) =>
  val(`select my_hr_leave_decide($1, $2, $3, $4, $5) v`, [school, user, application, decision, comment]);
const decideError = async (user: string, application: string, decision: string, comment: string | null = null) =>
  failsWith(`select my_hr_leave_decide($1, $2, $3, $4, $5)`, [school, user, application, decision, comment]);
const docPath = () => `${school}/my-hr/${crypto.randomUUID()}.pdf`;

beforeAll(async () => {
  db = await bootLiveDb();
  school = (await rows<{ tenant_id: string }>(`select tenant_id from platform_enable_hr($1, 'Hillside Primary', 'hillside', '[]')`, [PT]))[0].tenant_id;
  other = (await rows<{ tenant_id: string }>(`select tenant_id from platform_enable_hr($1, 'Other School', 'other-school', '[]')`, [PT_OTHER]))[0].tenant_id;
  await db.exec(`
    -- these tests approve as HR: the school's chain as HR's default (Leave Approver, then HR), as a school can set it
    -- in Settings (the school chain itself is tested in school_leave_chain.test.ts)
    update approval_steps s set label = null, approver_role = 'HR'
      from approval_workflows w where w.id = s.workflow_id and w.tenant_id = '${school}' and w.kind = 'leave' and s.position = 2;
    -- dates near today: public holidays are tested elsewhere
    delete from holidays where source = 'auto';
    insert into auth.users (id, email) values
      ('${U.PRINCIPAL}', 'pat@hillside.ac.ke'), ('${U.HR}', 'hana@hillside.ac.ke'), ('${U.STAFF}', 'sam@hillside.ac.ke'),
      ('${U.GONE}', 'gone@hillside.ac.ke');
    insert into user_profiles (user_id, email, role, tenant_id, full_name) values
      ('${U.PRINCIPAL}', 'pat@hillside.ac.ke', 'STAFF', '${school}', 'Pat Principal'),
      ('${U.HR}', 'hana@hillside.ac.ke', 'STAFF', '${other}', 'Hana Hr'),
      ('${U.STAFF}', 'sam@hillside.ac.ke', 'STAFF', '${school}', 'Sam Staff'),
      ('${U.GONE}', 'gone@hillside.ac.ke', 'STAFF', '${school}', 'Gone Person');
    -- Hana is HR in the school too, but is working in the other company now
    insert into memberships (user_id, tenant_id, role, account_status) values ('${U.HR}', '${school}', 'HR', 'ACTIVE');
    update memberships set account_status = 'SUSPENDED' where user_id = '${U.GONE}' and tenant_id = '${school}';
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['leaves', 'employees'], '${school}'), ('STAFF', array['dashboard'], '${school}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Start Date", "Town", onboarding_status, "Leave Approver", tenant_id) values
      ('E1', 'Mary', 'Teacher', 'mary@hillside.ac.ke', '2024-01-01', 'Nairobi', 'approved', 'Pat Principal', '${school}'),
      ('E2', 'John', 'Colleague', 'john@hillside.ac.ke', '2024-01-01', 'Nairobi', 'approved', 'Pat Principal', '${school}'),
      ('E3', 'New', 'Person', null, '2024-01-01', null, 'draft', null, '${school}'),
      ('E-P', 'Pat', 'Principal', 'pat@hillside.ac.ke', '2020-01-01', null, 'approved', null, '${school}'),
      ('E-HR', 'Hana', 'Hr', 'hana@hillside.ac.ke', '2020-01-01', null, 'approved', null, '${school}'),
      ('E-S', 'Sam', 'Staff', 'sam@hillside.ac.ke', '2020-01-01', null, 'approved', null, '${school}'),
      ('E1', 'Same', 'Number', 'same@other.ac.ke', '2024-01-01', null, 'approved', null, '${other}');
    insert into external_people (tenant_id, employee_number, source, external_id) values
      ('${school}', 'E1', 'schools', 'person-mary'), ('${school}', 'E2', 'schools', 'person-john'),
      ('${school}', 'E3', 'schools', 'person-new'), ('${other}', 'E1', 'schools', 'person-other');
    insert into external_logins (tenant_id, source, external_id, user_id) values
      ('${school}', 'schools', 'person-principal', '${U.PRINCIPAL}'), ('${school}', 'schools', 'person-hr', '${U.HR}'),
      ('${school}', 'schools', 'person-staff', '${U.STAFF}'), ('${school}', 'schools', 'person-gone', '${U.GONE}');
  `);
  // rules the tests below rely on: annual leave needs 3 days' notice and at most 10 days at a time
  await db.query(`update leave_policies set min_notice_days = 3, max_days_per_request = 10 where leave_type_id = $1`, [await typeId(school, 'Annual Leave')]);
}, 180000);

describe('the form', () => {
  it('types with their rules, balances and the chain the employee would go through', async () => {
    const f = await val(`select my_hr_leave_form($1, 'E1') v`, [school]);
    const annual = f.leave_types.find((t: J) => t.name === 'Annual Leave');
    expect(annual).toMatchObject({ half_days: true, min_notice_days: 3, max_days_per_request: 10, count_days: 'working', service_months_before_use: 2 });
    expect(annual.balance).toMatchObject({ leave_type: 'Annual Leave' });
    const sick = f.leave_types.find((t: J) => t.name === 'Sick Leave');
    expect(sick.document).toMatchObject({ name: expect.stringMatching(/medical practitioner/), when: 'with_application' });
    expect(f.approval_chain.map((s: J) => [s.label, s.waiting_on, s.skipped])).toEqual([
      ['Leave approver', 'Pat Principal', false],
      ['HR', 'HR', false],
    ]);
    expect(f.reason_min_length).toBe(10);
  });
  it('a draft employee gets nothing', async () => {
    expect(await fails(`select my_hr_leave_form($1, 'E3')`, [school])).toMatch(/not approved/);
  });
});

describe('applying: HR\'s checks, each refusal in HR\'s words', () => {
  // day(0): today, or Monday at a weekend, so always under 3 calendar days away. day(1) on a Friday is Monday, 3 days
  // away, which meets the notice and the refusal never came (the test failed every Friday and weekend).
  it('notice', async () => {
    const e = await applyError({ type: await typeId(school, 'Annual Leave'), start: day(0), end: day(0) });
    expect(e.code).toBe('P0001');
    expect(e.message).toMatch(/Annual Leave needs 3 days' notice/);
  });
  it('most days in one application, with every rule that failed', async () => {
    const e = await applyError({ type: await typeId(school, 'Annual Leave'), start: day(0), end: day(30) });
    expect(e.message).toMatch(/allows at most 10 days in one application/);
    expect(e.message).toMatch(/needs 3 days' notice/);
  });
  it('the balance', async () => {
    await db.query(`update leave_policies set max_days_per_request = null where leave_type_id = $1`, [await typeId(school, 'Annual Leave')]);
    const e = await applyError({ type: await typeId(school, 'Annual Leave'), start: day(10), end: day(80) });
    await db.query(`update leave_policies set max_days_per_request = 10 where leave_type_id = $1`, [await typeId(school, 'Annual Leave')]);
    expect(e.message).toMatch(/Not enough Annual Leave left/);
  });
  it('a document with the application', async () => {
    const e = await applyError({ type: await typeId(school, 'Sick Leave'), start: day(5), end: day(5) });
    expect(e.message).toMatch(/Sick Leave needs a document with the application/);
  });
  it('a half day is one day', async () => {
    const e = await applyError({ type: await typeId(school, 'Annual Leave'), start: day(10), end: day(12), half: true });
    expect(e.message).toMatch(/A half day is one day/);
  });
  it('a type of another company, or a document from elsewhere, is refused', async () => {
    expect((await applyError({ type: await typeId(other, 'Annual Leave'), start: day(10), end: day(10) })).message).toMatch(/Choose a leave type/);
    const elsewhere = `${other}/my-hr/${crypto.randomUUID()}.pdf`;
    expect((await applyError({ type: await typeId(school, 'Sick Leave'), start: day(5), end: day(5), doc: elsewhere })).message).toMatch(/not uploaded here/);
    expect((await applyError({ type: await typeId(school, 'Sick Leave'), start: day(5), end: day(5), doc: `${school}/someone/x.pdf` })).message).toMatch(/not uploaded here/);
  });
  it('HR entering leave for someone (the server, without My HR) is unchanged: counted, not checked', async () => {
    const r = await fails(`insert into leave_application (tenant_id, "Employee Number", "Leave Type", "Start Date", "End Date", days, status)
      values ($1, 'E2', 'Annual Leave', $2, $2, 1, 'pending')`, [school, day(1)]);
    expect(r).toBe('');
    await db.query(`delete from leave_application where tenant_id = $1 and "Employee Number" = 'E2'`, [school]);
  });
  it('a sick leave with its document is accepted, the document kept on the application', async () => {
    const path = docPath();
    const a = await apply({ type: await typeId(school, 'Sick Leave'), start: day(5), end: day(5), doc: path });
    expect(a).toMatchObject({ status: 'pending', document_name: 'report.pdf', leave_type: 'Sick Leave', cancellable: true });
    expect(await val(`select document_path v from leave_application where id = $1`, [a.id])).toBe(path);
    await db.query(`delete from leave_application where id = $1`, [a.id]);
  });
});

describe('apply, approve as the right HR login, events', () => {
  let app: J;
  it('applies: pending, the chain starts and the Leave Approver hears', async () => {
    const before = Number(await val(`select count(*) v from hr_notifications where tenant_id = $1 and employee_number = 'E-P' and notification_type = 'approval_needed'`, [school]));
    app = await apply({ type: await typeId(school, 'Annual Leave'), start: day(14), end: dayAfter(day(14)) });
    expect(app).toMatchObject({ status: 'pending', leave_type: 'Annual Leave', days: 2, half_day: false });
    expect(app.approval.steps.map((s: J) => [s.label, s.status, s.waiting_on])).toEqual([
      ['Leave approver', 'current', 'Pat Principal'],
      ['HR', 'upcoming', null],
    ]);
    const after = Number(await val(`select count(*) v from hr_notifications where tenant_id = $1 and employee_number = 'E-P' and notification_type = 'approval_needed'`, [school]));
    expect(after).toBe(before + 1);
    expect(await val(`select "Office Branch" v from leave_application where id = $1`, [app.id])).toBe('Nairobi');
  });

  it('approvals: only HR\'s "waiting on me" for that login', async () => {
    const mine = await approvals(U.PRINCIPAL);
    expect(mine.map((i: J) => [i.application_id, i.employee.name, i.employee.external_id, i.step_label, Number(i.days)])).toEqual([
      [app.id, 'Mary Teacher', 'person-mary', 'Leave approver', 2],
    ]);
    expect(mine[0].approval.steps[0].status).toBe('current');
    expect(await approvals(U.HR)).toEqual([]); // not their step yet
    expect(await approvals(U.STAFF)).toEqual([]);
  });

  it('another login cannot decide it; a decline needs a reason (HR\'s rules)', async () => {
    expect(await decideError(U.STAFF, app.id, 'approved')).toMatchObject({ code: '42501', message: expect.stringMatching(/not the approver/) });
    expect(await decideError(U.HR, app.id, 'approved')).toMatchObject({ code: '42501' });
    expect(await decideError(U.PRINCIPAL, app.id, 'rejected')).toMatchObject({ code: '22023', message: expect.stringMatching(/Give a reason/) });
    expect(await decideError(U.GONE, app.id, 'approved')).toMatchObject({ code: '42501', message: expect.stringMatching(/no access/) });
  });

  it('the Leave Approver recommends, as themselves: recorded with their name; no event yet', async () => {
    const r = await decide(U.PRINCIPAL, app.id, 'approved', 'Enjoy');
    expect(r.request_status).toBe('pending');
    expect(r.application.approval.steps.map((s: J) => [s.status, s.actor_name])).toEqual([['approved', 'Pat Principal'], ['current', null]]);
    expect(await events(app.id)).toEqual([]);
    // the acting is over: nobody is signed in afterwards
    expect(await val(`select auth.uid() v`)).toBeNull();
  });

  it('HR approves (finally) from a login working in another company: switched in for the decision, then back', async () => {
    expect(await approvals(U.HR)).toHaveLength(1);
    expect(await val(`select tenant_id v from user_profiles where user_id = $1`, [U.HR])).toBe(other);
    const usedBefore = await used('E1', 'Annual Leave');
    const r = await decide(U.HR, app.id, 'approved');
    expect(r.request_status).toBe('approved');
    expect(r.application.status).toBe('approved');
    expect(r.application.approval.steps[1]).toMatchObject({ status: 'approved', actor_name: 'Hana Hr' });
    expect(await val(`select tenant_id v from user_profiles where user_id = $1`, [U.HR])).toBe(other);
    expect(await val(`select role v from user_profiles where user_id = $1`, [U.HR])).toBe('STAFF');
    expect(await used('E1', 'Annual Leave')).toBe(usedBefore + 2);
    expect(await val(`select count(*)::int v from hr_notifications where employee_number = 'E1' and tenant_id = $1 and notification_type = 'leave_approved'`, [school])).toBe(1);

    const ev = await events(app.id);
    expect(ev).toHaveLength(1);
    expect(ev[0].event_type).toBe('hr.leave.approved');
    expect(ev[0].data).toEqual({
      application_id: app.id, external_id: 'person-mary', employee_number: 'E1', leave_type: 'Annual Leave',
      start_date: day(14), end_date: dayAfter(day(14)), half_day: false, days: 2, status: 'approved', source: 'schools',
    });
    expect(await decideError(U.HR, app.id, 'approved')).toMatchObject({ code: '55000' });
  });

  it('an unrelated change sends nothing; a date change is cancelled (old) + approved (new), same id, once', async () => {
    await db.query(`update leave_application set notes = 'noted', reason = 'Changed reason text' where id = $1`, [app.id]);
    expect(await events(app.id)).toHaveLength(1);
    await db.query(`update leave_application set "Start Date" = $2, "End Date" = $3, days = 3 where id = $1`, [app.id, day(21), day(23)]);
    await db.query(`update leave_application set notes = 'again' where id = $1`, [app.id]);
    const ev = await events(app.id);
    expect(ev.map((e) => [e.event_type, e.data.status, e.data.start_date, e.data.days])).toEqual([
      ['hr.leave.approved', 'approved', day(14), 2],
      ['hr.leave.cancelled', 'cancelled', day(14), 2],
      ['hr.leave.approved', 'approved', day(21), 3],
    ]);
    expect(new Set(ev.map((e) => e.data.application_id))).toEqual(new Set([app.id]));
  });

  it('the employee cancels it before it starts: the days go back, hr.leave.cancelled once', async () => {
    const usedBefore = await used('E1', 'Annual Leave');
    const c = await val(`select my_hr_leave_cancel($1, 'E1', $2) v`, [school, app.id]);
    expect(c).toMatchObject({ status: 'cancelled', cancellable: false });
    // HR's balance trigger gives the application's days back (never below nothing used)
    expect(usedBefore).toBeGreaterThan(0);
    expect(await used('E1', 'Annual Leave')).toBe(Math.max(usedBefore - 3, 0));
    const ev = await events(app.id);
    expect(ev.map((e) => [e.event_type, e.data.start_date])).toEqual([
      ['hr.leave.approved', day(14)], ['hr.leave.cancelled', day(14)], ['hr.leave.approved', day(21)], ['hr.leave.cancelled', day(21)],
    ]);
    expect(await failsWith(`select my_hr_leave_cancel($1, 'E1', $2)`, [school, app.id])).toMatchObject({ code: '55000' });
    expect(await events(app.id)).toHaveLength(4);
  });
});

describe('cancelling', () => {
  it('a pending one: its chain ends, nothing is sent', async () => {
    const a = await apply({ type: await typeId(school, 'Annual Leave'), start: day(30), end: day(30) });
    expect(await approvals(U.PRINCIPAL)).toHaveLength(1);
    expect(await val(`select (my_hr_leave_cancel($1, 'E1', $2)) ->> 'status' v`, [school, a.id])).toBe('cancelled');
    expect(await val(`select count(*)::int v from approval_requests where record_id = $1`, [a.id])).toBe(0);
    expect(await approvals(U.PRINCIPAL)).toEqual([]);
    expect(await events(a.id)).toEqual([]);
  });
  it('not one that has started, not someone else\'s, not another company\'s', async () => {
    const started = (await rows<{ id: string }>(`insert into leave_application (tenant_id, "Employee Number", "Leave Type", "Start Date", "End Date", days, status)
      values ($1, 'E1', 'Unpaid Leave', $2, $2, 1, 'approved') returning id`, [school, day(-3)]))[0].id;
    expect(await failsWith(`select my_hr_leave_cancel($1, 'E1', $2)`, [school, started])).toMatchObject({ code: '55000', message: expect.stringMatching(/already started/) });
    const johns = await apply({ type: await typeId(school, 'Annual Leave'), start: day(30), end: day(30), employee: 'E2' });
    expect(await failsWith(`select my_hr_leave_cancel($1, 'E1', $2)`, [school, johns.id])).toMatchObject({ code: 'P0002' });
    expect(await failsWith(`select my_hr_leave_cancel($1, 'E1', $2)`, [other, johns.id])).toMatchObject({ code: 'P0002' });
    // the started approved leave was entered for a Schools person: the platform heard about it
    expect((await events(started)).map((e) => e.event_type)).toEqual(['hr.leave.approved']);
  });
});

describe('who the approver is', () => {
  it('only through external_logins, in the platform tenant\'s company', async () => {
    const who = async (tenant: string, pt: string, ext: string) => (await rows(`select * from my_hr_approver($1, $2, $3)`, [tenant, pt, ext]))[0];
    expect(await who(school, PT, 'person-principal')).toEqual({ outcome: 'found', user_id: U.PRINCIPAL });
    expect(await who(school, PT, 'person-hr')).toEqual({ outcome: 'found', user_id: U.HR });
    expect(await who(school, PT, 'person-mary')).toEqual({ outcome: 'not_linked', user_id: null });
    expect(await who(school, PT, 'person-gone')).toEqual({ outcome: 'no_access', user_id: U.GONE });
    expect((await who(school, PT_OTHER, 'person-principal')).outcome).toBe('unknown_company');
    expect((await who(other, PT_OTHER, 'person-principal')).outcome).toBe('not_linked');
  });
  it('another company\'s application cannot be decided or listed from this school', async () => {
    const otherApp = (await rows<{ id: string }>(`insert into leave_application (tenant_id, "Employee Number", "Leave Type", "Start Date", "End Date", days, status)
      values ($1, 'E1', 'Annual Leave', $2, $2, 1, 'pending') returning id`, [other, day(20)]))[0].id;
    expect(await decideError(U.PRINCIPAL, otherApp, 'approved')).toMatchObject({ code: 'P0002' });
    expect((await approvals(U.HR)).map((i: J) => i.application_id)).not.toContain(otherApp);
    // a login with no membership in that company is refused before anything else
    expect(await failsWith(`select my_hr_leave_approvals($1, $2)`, [other, U.PRINCIPAL])).toMatchObject({ code: '42501' });
  });
});

describe('history from Schools', () => {
  const records = () => [
    { external_id: 'person-mary', leave_type_name: 'annual leave', start_date: '2026-03-02', end_date: '2026-03-03', days: 2, status: 'approved', source_id: 'lr-1' },
    { external_id: 'person-mary', leave_type_name: 'Teacher Training', start_date: '2026-04-06', end_date: '2026-04-06', days: 1, status: 'approved', source_id: 'lr-2' },
    { external_id: 'person-mary', leave_type_name: 'Annual Leave', start_date: '2026-05-04', end_date: '2026-05-04', days: 1, status: 'rejected', source_id: 'lr-3' },
    { external_id: 'person-nobody', leave_type_name: 'Annual Leave', start_date: '2026-05-04', end_date: '2026-05-04', days: 1, status: 'approved', source_id: 'lr-4' },
    { external_id: 'person-mary', leave_type_name: 'Annual Leave', start_date: '2026-05-09', end_date: '2026-05-04', days: 1, status: 'approved', source_id: 'lr-5' },
    { external_id: 'person-other', leave_type_name: 'Annual Leave', start_date: '2026-05-04', end_date: '2026-05-04', days: 1, status: 'approved', source_id: 'lr-6' },
  ];
  const imported = (dry: boolean) => val(`select my_hr_leave_import($1, $2, $3::jsonb, $4) v`, [school, PT, JSON.stringify(records()), dry]);
  const count = (sql: string) => val<number>(`select count(*)::int v from ${sql}`, [school]);

  it('a dry run says what would happen and writes nothing', async () => {
    const before = { apps: await count(`leave_application where tenant_id = $1`), types: await count(`leave_types where tenant_id = $1`) };
    const r = await imported(true);
    expect(r.dry_run).toBe(true);
    expect(r.results.map((x: J) => [x.source_id, x.outcome])).toEqual([
      ['lr-1', 'would_import'], ['lr-2', 'would_import'], ['lr-3', 'skipped'], ['lr-4', 'not_linked'], ['lr-5', 'invalid'], ['lr-6', 'not_linked'],
    ]);
    expect(r.results[1]).toMatchObject({ leave_type: 'Imported from Schools', type_mapped: true });
    expect(r.counts).toEqual({ would_import: 2, skipped: 1, not_linked: 2, invalid: 1 });
    expect(await count(`leave_application where tenant_id = $1`)).toBe(before.apps);
    expect(await count(`leave_types where tenant_id = $1`)).toBe(before.types);
    expect(await count(`leave_history_imports where tenant_id = $1`)).toBe(0);
  });

  it('imports approved history: no chain, no notifications, no events, counted in balances; then idempotent', async () => {
    const notes = await count(`hr_notifications where tenant_id = $1`);
    const outbox = await count(`platform_event_outbox where tenant_id = $1`);
    const usedBefore = await used('E1', 'Annual Leave');
    const r = await imported(false);
    expect(r.counts).toEqual({ imported: 2, skipped: 1, not_linked: 2, invalid: 1 });
    const ids = r.results.filter((x: J) => x.outcome === 'imported').map((x: J) => x.application_id);
    const apps = await rows<J>(`select "Leave Type", status, days from leave_application where id = any($1::uuid[]) order by "Start Date"`, [ids]);
    expect(apps.map((a) => [a['Leave Type'], a.status, Number(a.days)])).toEqual([['Annual Leave', 'approved', 2], ['Imported from Schools', 'approved', 1]]);
    expect(await val(`select count(*)::int v from approval_requests where record_id = any($1::uuid[])`, [ids])).toBe(0);
    expect(await count(`hr_notifications where tenant_id = $1`)).toBe(notes);
    expect(await count(`platform_event_outbox where tenant_id = $1`)).toBe(outbox);
    expect(await used('E1', 'Annual Leave')).toBe(usedBefore + 2);

    const again = await imported(false);
    expect(again.counts).toEqual({ already_imported: 2, skipped: 1, not_linked: 2, invalid: 1 });
    expect(again.results[0].application_id).toBe(ids[0]);
    expect(await count(`leave_history_imports where tenant_id = $1`)).toBe(2);
    expect(await used('E1', 'Annual Leave')).toBe(usedBefore + 2);
    // later changes to imported history are Schools' own: still no events
    await db.query(`update leave_application set "Start Date" = '2026-03-09', "End Date" = '2026-03-10' where id = $1`, [ids[0]]);
    expect(await count(`platform_event_outbox where tenant_id = $1`)).toBe(outbox);
  });

  it('only for the platform tenant\'s company', async () => {
    expect(await failsWith(`select my_hr_leave_import($1, $2, '[]'::jsonb, true)`, [school, PT_OTHER])).toMatchObject({ code: 'P0002' });
  });
});

describe('overlapping leave: refused on every path (leave_application_overlap())', () => {
  const JOHN = '00000000-0000-0000-0000-00000000c105';
  // a Monday at least 60 days ahead, and the days after it (no weekend in between)
  const monday = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 60);
    while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  })();
  const wd = (n: number) => {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const unpaid = () => typeId(school, 'Unpaid Leave');
  // HR (or the server) entering leave for someone
  const enter = (start: string, end: string, status = 'pending', type = 'Full Day', employee = 'E2') =>
    rows<{ id: string }>(`insert into leave_application (tenant_id, "Employee Number", "Leave Type", "Start Date", "End Date", days, status, type)
      values ($1, $2, 'Unpaid Leave', $3, $4, 1, $5, $6) returning id`, [school, employee, start, end, status, type]).then((r) => r[0].id);
  const enterError = async (start: string, end: string, status = 'pending', type = 'Full Day') => {
    try {
      await enter(start, end, status, type);
      return '';
    } catch (e) {
      return (e as Error).message;
    }
  };
  const label = (n: number) => {
    const d = new Date(`${wd(n)}T00:00:00Z`);
    return { day: String(d.getUTCDate()), mon: d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }) };
  };
  let first: string;

  beforeAll(async () => {
    await db.exec(`
      insert into auth.users (id, email) values ('${JOHN}', 'john@hillside.ac.ke');
      insert into user_profiles (user_id, email, role, tenant_id, full_name) values ('${JOHN}', 'john@hillside.ac.ke', 'STAFF', '${school}', 'John Colleague');
      delete from leave_application where tenant_id = '${school}' and "Employee Number" = 'E2';
    `);
    first = await enter(wd(1), wd(3)); // Tuesday to Thursday, pending
  });

  it('HR entering leave: refused, naming the other application', async () => {
    const msg = await enterError(wd(3), wd(4));
    expect(msg).toMatch(/^This overlaps John Colleague's Unpaid Leave from /);
    const [a, b] = [label(1), label(3)];
    expect(msg).toContain(a.mon === b.mon ? `from ${a.day} to ${b.day} ${b.mon}` : `from ${a.day} ${a.mon} to ${b.day} ${b.mon}`);
    expect(msg).toMatch(/\(pending\)\. Cancel or change that one first\.$/);
    expect(await enterError(wd(0), wd(4), 'approved')).toMatch(/This overlaps/);
  });
  it('the staff portal: refused, "your"', async () => {
    const msg = await asUser(db, JOHN, () => fails(`insert into leave_application ("Employee Number", name, "Leave Type", "Start Date", "End Date", days, status, reason)
      values ('E2', 'John Colleague', 'Unpaid Leave', $1, $1, 1, 'pending', 'Personal matters here')`, [wd(2)]));
    expect(msg).toMatch(/^This overlaps your Unpaid Leave from .* \(pending\)\. Cancel or change that one first\.$/);
  });
  it('My HR from Schools: refused, "your"', async () => {
    const e = await applyError({ type: await unpaid(), start: wd(2), end: wd(2), employee: 'E2' });
    expect(e.code).toBe('P0001');
    expect(e.message).toMatch(/^This overlaps your Unpaid Leave from /);
  });
  it('adjacent days are allowed', async () => {
    expect(await enterError(wd(0), wd(0))).toBe('');
    expect(await enterError(wd(4), wd(4))).toBe('');
  });
  it('rejected and cancelled applications don\'t count', async () => {
    await enter(wd(7), wd(8), 'rejected');
    await enter(wd(7), wd(8), 'cancelled');
    expect(await enterError(wd(7), wd(8))).toBe('');
  });
  it('approved ones count; the message says so', async () => {
    await enter(wd(14), wd(14), 'approved');
    expect(await enterError(wd(14), wd(15))).toMatch(/Unpaid Leave on \d+ \w+( \d{4})? \(approved\)/);
  });
  it('half days: HR doesn\'t record which half, so two half days on the same day overlap', async () => {
    await enter(wd(21), wd(21), 'pending', 'Half Day');
    expect(await enterError(wd(21), wd(21), 'pending', 'Half Day')).toMatch(/on \d+ \w+( \d{4})?, a half day \(pending\)/);
    expect(await enterError(wd(22), wd(22), 'pending', 'Half Day')).toBe('');
  });
  it('changing an application\'s own dates is allowed; moving it onto another is refused', async () => {
    expect(await fails(`update leave_application set "Start Date" = $2, "End Date" = $3 where id = $1`, [first, wd(2), wd(3)])).toBe('');
    expect(await fails(`update leave_application set "End Date" = $2 where id = $1`, [first, wd(4)])).toMatch(/This overlaps/);
    expect(await fails(`update leave_application set "Leave Type" = 'Unpaid Leave', type = 'Full Day' where id = $1`, [first])).toBe('');
  });
  it('overlaps already in the data are left alone: other edits, renumbering and cancelling still work', async () => {
    await db.exec(`alter table leave_application disable trigger leave_application_overlap`);
    const a = await enter(wd(28), wd(29));
    const b = await enter(wd(29), wd(30));
    await db.exec(`alter table leave_application enable trigger leave_application_overlap`);
    expect(await fails(`update leave_application set notes = 'seen', reason = 'Another reason' where id = $1`, [a])).toBe('');
    expect(await fails(`update leave_application set "Employee Number" = 'E2' where id = $1`, [b])).toBe('');
    expect(await val(`select (my_hr_leave_cancel($1, 'E2', $2)) ->> 'status' v`, [school, b])).toBe('cancelled');
    expect(await fails(`update leave_application set "End Date" = $2 where id = $1`, [a, wd(30)])).toBe('');
  });
  it('history from Schools that overlaps HR\'s leave: refused, reason overlap (never counted twice)', async () => {
    const r = await val(`select my_hr_leave_import($1, $2, $3::jsonb, $4) v`, [school, PT, JSON.stringify([
      { external_id: 'person-john', leave_type_name: 'Unpaid Leave', start_date: wd(14), end_date: wd(14), days: 1, status: 'approved', source_id: 'ov-1' },
      { external_id: 'person-john', leave_type_name: 'Unpaid Leave', start_date: wd(35), end_date: wd(35), days: 1, status: 'approved', source_id: 'ov-2' },
    ]), true]);
    expect(r.results.map((x: J) => [x.source_id, x.outcome, x.reason ?? null])).toEqual([['ov-1', 'refused', 'overlap'], ['ov-2', 'would_import', null]]);
    expect(r.results[0].message).toMatch(/^This overlaps John Colleague's Unpaid Leave/);
  });
});

describe('who may call', () => {
  const STAFF_SQL = [
    [`select my_hr_leave_form($1, 'E1')`],
    [`select my_hr_leave_cancel($1, 'E1', gen_random_uuid())`],
    [`select my_hr_leave_approvals($1, '${U.PRINCIPAL}')`],
    [`select my_hr_leave_decide($1, '${U.PRINCIPAL}', gen_random_uuid(), 'approved', null)`],
    [`select my_hr_leave_import($1, '${PT}', '[]'::jsonb, true)`],
    [`select * from my_hr_approver($1, '${PT}', 'person-principal')`],
    [`select my_hr_act_begin($1, '${U.PRINCIPAL}')`],
    [`select * from leave_history_imports where tenant_id = $1`],
    [`select * from leave_platform_events where tenant_id = $1`],
  ];
  it('not a signed-in user', async () => {
    for (const [sql] of STAFF_SQL) {
      expect(await asUser(db, U.PRINCIPAL, () => fails(sql, [school]))).toMatch(/permission denied/);
    }
  });
  it('the backend (service role) calls the API, but never the acting functions themselves', async () => {
    await db.exec(`set role service_role`);
    try {
      expect(await fails(`select my_hr_leave_form($1, 'E1')`, [school])).toBe('');
      expect(await fails(`select my_hr_leave_approvals($1, '${U.PRINCIPAL}')`, [school])).toBe('');
      expect(await fails(`select my_hr_act_begin($1, '${U.PRINCIPAL}')`, [school])).toMatch(/permission denied/);
      expect(await fails(`select my_hr_act_end('${U.PRINCIPAL}', '{}'::jsonb)`)).toMatch(/permission denied/);
    } finally {
      await db.exec(`reset role`);
    }
  });
});
