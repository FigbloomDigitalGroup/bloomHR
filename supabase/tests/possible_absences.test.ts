// @vitest-environment node
//
// Possible absences (20261106100000): the days attendance counts as absent come to Leave discipline as a list to
// review (record or dismiss), less leave, holidays, off days, missed-scan requests, records and dismissals, grouped into
// runs of working days; HR sees all, a supervisor their team. The morning job tells HR and supervisors how many, and,
// once switched on, tells each person once per absence (never the backlog).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const C = '00000000-0000-0000-0000-0000000000c3';
const HR = '00000000-0000-0000-0000-00000000ab01';
const SUP = '00000000-0000-0000-0000-00000000ab02';
const STAFF = '00000000-0000-0000-0000-00000000ab03';
const HR_B = '00000000-0000-0000-0000-00000000ab04';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};

interface Entry { employee_number: string; start_date: string; end_date: string; days: number; absent_days: string[]; pending_leave: boolean; notified_on: string | null; reply_by: string | null }
const sel = `employee_number, start_date::text, end_date::text, days, absent_days::text[] as absent_days, pending_leave,
             notified_on::text, reply_by::text`;
/** the company's possible absences on a given day (the internal function, no scoping) */
const listFor = (tenant: string, today: string, emp?: string) =>
  rows<Entry>(`select ${sel} from possible_absences_for($1, $2) ${emp ? 'where employee_number = $3' : ''} order by employee_number, start_date`,
    emp ? [tenant, today, emp] : [tenant, today]);
const ranges = (list: Entry[]) => list.map((e) => `${e.employee_number} ${e.start_date}..${e.end_date} (${e.days})`);

/** every weekday from 2 to 13 March 2026 clocked in at 07:55, except the days listed per employee */
const clockIns = async (tenant: string, absent: Record<string, string[]>) => {
  await db.query(`
    insert into attendance_logs (tenant_id, employee_number, work_date, login_time, status, source)
    select e.tenant_id, e."Employee Number", g::date, (g::date + time '07:55') at time zone 'Africa/Nairobi', 'clocked_in', 'app'
    from employees e cross join generate_series('2026-03-02'::date, '2026-03-13'::date, interval '1 day') g
    where e.tenant_id = $1 and extract(isodow from g) < 6`, [tenant]);
  for (const [emp, days] of Object.entries(absent)) {
    await db.query(`delete from attendance_logs where tenant_id = $1 and employee_number = $2 and work_date = any($3::date[])`, [tenant, emp, days]);
  }
};

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co'), ('${C}', 'Notice Co', 'notice-co');
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${SUP}', 'sup@a.co'), ('${STAFF}', 'me@a.co'), ('${HR_B}', 'hr@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${SUP}', 'sup@a.co', 'STAFF', '${A}'), ('${STAFF}', 'me@a.co', 'STAFF', '${A}'),
      ('${HR_B}', 'hr@b.co', 'HR', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['leaves', 'employees'], '${A}'), ('STAFF', array['dashboard'], '${A}'), ('HR', array['leaves', 'employees'], '${B}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", manager_email, "Start Date", worker_kind, tenant_id) values
      ('HRE', 'Hana', 'Hr', 'hr@a.co', null, '2026-03-02', 'employee', '${A}'),
      ('SUPE', 'Sam', 'Sup', 'sup@a.co', null, '2026-03-02', 'employee', '${A}'),
      ('ME', 'Mia', 'Me', 'me@a.co', 'sup@a.co', '2026-03-02', 'employee', '${A}'),
      ('WKND', 'Wanjiru', 'Weekend', 'w@a.co', 'sup@a.co', '2026-03-02', 'employee', '${A}'),
      ('LEAVE', 'Lulu', 'Leave', 'l@a.co', null, '2026-03-02', 'employee', '${A}'),
      ('HOL', 'Hassan', 'Holiday', 'h@a.co', null, '2026-03-02', 'employee', '${A}'),
      ('MISS', 'Musa', 'Missed', 'm@a.co', 'sup@a.co', '2026-03-02', 'employee', '${A}'),
      ('REC', 'Rose', 'Recorded', 'r@a.co', null, '2026-03-02', 'employee', '${A}'),
      ('DIS', 'Dan', 'Dismissed', 'd@a.co', null, '2026-03-02', 'employee', '${A}'),
      ('CAS', 'Carl', 'Casual', 'c@a.co', null, '2026-03-02', 'employee', '${A}'),
      ('LATE', 'Lena', 'Hired', 'lh@a.co', null, '2026-03-11', 'employee', '${A}'),
      ('OTHER', 'Otto', 'Other', 'o@b.co', null, '2026-03-02', 'employee', '${B}'),
      ('NEW', 'Nia', 'New', 'n@c.co', null, '2026-03-02', 'employee', '${C}'),
      ('NEW2', 'Neo', 'Two', 'n2@c.co', null, '2026-03-02', 'employee', '${C}'),
      ('BOSS', 'Bea', 'Boss', 'boss@c.co', null, '2026-03-02', 'employee', '${C}');
    update employees set worker_kind = 'casual', daily_rate = 800 where "Employee Number" = 'CAS';
    update employees set manager_email = 'boss@c.co' where tenant_id = '${C}' and "Employee Number" in ('NEW', 'NEW2');
    select seed_default_leave_types('${A}');
    select seed_default_leave_types('${C}');
    -- no public holidays but the ones a test adds
    delete from holidays;
    insert into holidays (tenant_id, name, date) values ('${A}', 'Test Day', '2026-03-04');
    insert into attendance_settings (tenant_id, tracking_from) values ('${A}', '2026-01-01'), ('${B}', '2026-01-01'), ('${C}', '2026-01-01')
      on conflict (tenant_id) do update set tracking_from = excluded.tracking_from;
  `);
  await clockIns(A, {
    ME: ['2026-03-10'],
    // Fri, the weekend, Mon and Tue: one run
    WKND: ['2026-03-06', '2026-03-09', '2026-03-10'],
    // approved leave 2-12 March; absent on the 13th too
    LEAVE: ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13'],
    // Tue, Wed (the holiday), Thu
    HOL: ['2026-03-03', '2026-03-04', '2026-03-05'],
    MISS: ['2026-03-03', '2026-03-05'],
    REC: ['2026-03-09', '2026-03-10', '2026-03-11'],
    DIS: ['2026-03-09', '2026-03-10'],
    CAS: ['2026-03-09'],
    LATE: ['2026-03-11', '2026-03-12'],
  });
  await clockIns(B, { OTHER: ['2026-03-09'] });
  await clockIns(C, { NEW: ['2026-03-02', '2026-03-04', '2026-03-05'], NEW2: ['2026-03-09', '2026-03-11'] });
  await db.exec(`
    insert into leave_application (tenant_id, "Employee Number", name, "Leave Type", "Start Date", "End Date", status)
      values ('${A}', 'LEAVE', 'Lulu', 'Annual Leave', '2026-03-02', '2026-03-12', 'approved');
    insert into attendance_missed_scan_requests (tenant_id, employee_number, work_date, came_in_at, reason, status, approver)
      values ('${A}', 'MISS', '2026-03-03', '2026-03-03T08:00:00+03:00', 'Forgot to scan', 'pending', 'hr'),
             ('${A}', 'MISS', '2026-03-05', '2026-03-05T08:00:00+03:00', 'Forgot again', 'declined', 'hr');
  `);
}, 120000);

describe('which days are possible absences', () => {
  it('lists working days with no clock-in, grouped, less leave, holidays, missed-scan requests and casual workers', async () => {
    expect(ranges(await listFor(A, '2026-03-14'))).toEqual([
      // the holiday on Wed 4 neither counts nor breaks the run
      'HOL 2026-03-03..2026-03-05 (2)',
      // hired on the 11th: nothing before
      'LATE 2026-03-11..2026-03-12 (2)',
      // approved leave until the 12th
      'LEAVE 2026-03-13..2026-03-13 (1)',
      'ME 2026-03-10..2026-03-10 (1)',
      // the pending request takes out Tue 3; the declined one leaves Thu 5
      'MISS 2026-03-05..2026-03-05 (1)',
      'REC 2026-03-09..2026-03-11 (3)',
      'DIS 2026-03-09..2026-03-10 (2)',
      'WKND 2026-03-06..2026-03-10 (3)',
    ].sort());
    const w = (await listFor(A, '2026-03-14', 'WKND'))[0];
    expect(w.absent_days).toEqual(['2026-03-06', '2026-03-09', '2026-03-10']);
  });

  it('never today (it may still be in progress), only past days in the window', async () => {
    expect(ranges(await listFor(A, '2026-03-10', 'WKND'))).toEqual(['WKND 2026-03-06..2026-03-09 (2)']);
    // the window is the company's setting (default 60 days): from 1 March, nothing in a window ending in early January
    expect(await listFor(A, '2026-01-10')).toEqual([]);
  });

  it('a day already recorded, in either kind, is not listed again', async () => {
    expect(await asUser(db, HR, () => fails(db.query(`select record_absence('REC', 'failed_to_notify', '2026-03-09', '2026-03-10')`)))).toBe('');
    expect(ranges(await listFor(A, '2026-03-14', 'REC'))).toEqual(['REC 2026-03-11..2026-03-11 (1)']);
  });

  it('the days before attendance counts are never listed', async () => {
    await db.query(`update attendance_settings set tracking_from = '2026-03-09' where tenant_id = $1`, [A]);
    expect(ranges(await listFor(A, '2026-03-14', 'WKND'))).toEqual(['WKND 2026-03-09..2026-03-10 (2)']);
    expect(await listFor(A, '2026-03-14', 'HOL')).toEqual([]);
    await db.query(`update attendance_settings set tracking_from = '2026-01-01' where tenant_id = $1`, [A]);
  });
});

describe('dismissing', () => {
  const dismiss = (user: string, emp: string, start: string, end: string, reason: string | null) =>
    asUser(db, user, () => fails(db.query(`select dismiss_possible_absence($1, $2, $3, $4)`, [emp, start, end, reason])));

  it('needs a reason, past days, and HR or the supervisor', async () => {
    expect(await dismiss(HR, 'DIS', '2026-03-09', '2026-03-10', '  ')).toMatch(/Say why/);
    expect(await dismiss(HR, 'DIS', '2026-03-10', '2026-03-09', 'x')).toMatch(/before the first/);
    expect(await dismiss(HR, 'DIS', '2026-03-09', '2099-01-01', 'x')).toMatch(/Only past days/);
    expect(await dismiss(STAFF, 'DIS', '2026-03-09', '2026-03-10', 'x')).toMatch(/Only HR or the employee's supervisor/);
    expect(await dismiss(SUP, 'DIS', '2026-03-09', '2026-03-10', 'x')).toMatch(/Only HR or the employee's supervisor/);
    expect(await dismiss(HR, 'HRE', '2026-03-09', '2026-03-10', 'x')).toMatch(/your own/);
    // nobody writes the table directly
    expect(await asUser(db, HR, () => fails(db.query(`insert into leave_absence_dismissals (employee_number, start_date, end_date, reason) values ('DIS', '2026-03-09', '2026-03-10', 'x')`))))
      .toMatch(/permission denied|row-level security/);
  });

  it('dismissed days do not come back; the dismissal is audited', async () => {
    expect(await dismiss(HR, 'DIS', '2026-03-09', '2026-03-10', 'Was at the client site all day')).toBe('');
    expect(await listFor(A, '2026-03-14', 'DIS')).toEqual([]);
    // the supervisor dismisses for their team
    expect(await dismiss(SUP, 'MISS', '2026-03-05', '2026-03-05', 'On a site visit with me')).toBe('');
    expect(await listFor(A, '2026-03-14', 'MISS')).toEqual([]);
    const seen = await asUser(db, SUP, () => rows<{ employee_number: string }>(`select employee_number from leave_absence_dismissals order by employee_number`));
    expect(seen.map((r) => r.employee_number)).toEqual(['MISS']);
    const audited = await rows<{ n: number }>(`select count(*)::int as n from audit_log where table_name = 'leave_absence_dismissals'`);
    expect(audited[0].n).toBe(2);
  });

  it('recording from the list uses the usual recording rules (and pay)', async () => {
    expect(await asUser(db, HR, () => fails(db.query(`select record_absence('WKND', 'unexcused_absence', '2026-03-06', '2026-03-10')`)))).toBe('');
    const rec = await rows<{ days: string }>(`select days from leave_absences where tenant_id = $1 and employee_number = 'WKND'`, [A]);
    expect(rec[0].days).toBe('3');
    expect(await listFor(A, '2026-03-14', 'WKND')).toEqual([]);
  });
});

describe('who sees what', () => {
  const visible = async (user: string) =>
    new Set((await asUser(db, user, () => rows<{ employee_number: string }>(`select employee_number from possible_absences()`))).map((r) => r.employee_number));

  it('HR sees everyone but themselves; a supervisor their team; others nothing; never another company', async () => {
    // since March nobody has clocked in, so everyone counted has possible absences now
    const hr = await visible(HR);
    expect(hr.has('HRE')).toBe(false);
    expect(hr.has('CAS')).toBe(false);
    expect(hr.has('OTHER')).toBe(false);
    expect(hr.has('ME') && hr.has('LEAVE') && hr.has('SUPE')).toBe(true);
    expect(await visible(SUP)).toEqual(new Set(['ME', 'WKND', 'MISS']));
    expect(await visible(STAFF)).toEqual(new Set());
    expect(await visible(HR_B)).toEqual(new Set(['OTHER']));
  });

  it('only HR changes the settings', async () => {
    expect(await asUser(db, SUP, () => fails(db.query(`select set_possible_absence_settings(30, true, 2)`)))).toMatch(/Only HR/);
    expect(await asUser(db, HR, () => fails(db.query(`select set_possible_absence_settings(3, false, 2)`)))).toMatch(/between 7 and 180/);
    expect(await asUser(db, HR, () => fails(db.query(`insert into leave_discipline_settings (lookback_days) values (30)`)))).toMatch(/permission denied|row-level security/);
    const s = await asUser(db, HR, () => rows<{ s: { lookback_days: number; notify_employees: boolean; notify_from: string } }>(
      `select set_possible_absence_settings(30, true, 3) as s`));
    const today = (await rows<{ d: string }>(`select nairobi_today()::text as d`))[0].d;
    expect(s[0].s).toMatchObject({ lookback_days: 30, notify_employees: true, notify_from: today, reply_working_days: 3 });
    // saving again while on keeps the day it was switched on
    await db.query(`update leave_discipline_settings set notify_from = '2026-01-05' where tenant_id = $1`, [A]);
    const again = await asUser(db, HR, () => rows<{ s: { notify_from: string } }>(`select set_possible_absence_settings(30, true, 3) as s`));
    expect(again[0].s.notify_from).toBe('2026-01-05');
    const b = await asUser(db, HR_B, () => rows<{ s: { lookback_days: number } }>(`select possible_absence_settings() as s`));
    expect(b[0].s.lookback_days).toBe(60);
  });
});

describe('the morning notifications', () => {
  const notify = (today: string) => rows<{ n: number }>(`select possible_absences_notify($1, $2) as n`, [C, today]).then((r) => r[0].n);
  const notes = (emp: string, type: string) =>
    rows<{ title: string; message: string; end_date: string }>(
      `select title, message, end_date::text from hr_notifications where tenant_id = $1 and employee_number = $2 and notification_type = $3 order by id`,
      [C, emp, type]);
  const notices = (emp: string) =>
    rows<{ start_date: string; end_date: string; notified_on: string; reply_by: string }>(
      `select start_date::text, end_date::text, notified_on::text, reply_by::text from possible_absence_notices
       where tenant_id = $1 and employee_number = $2 order by start_date`, [C, emp]);

  it('with the notice off: HR and the supervisor are told how many, once a day; the employee nothing', async () => {
    // on the 3rd: NEW's Monday
    expect(await notify('2026-03-03')).toBe(2);
    expect(await notify('2026-03-03')).toBe(0);
    const hr = await notes('', 'possible_absences');
    expect(hr).toHaveLength(1);
    expect(hr[0].title).toBe('1 possible absence to review');
    expect((await notes('BOSS', 'possible_absences_team'))[0].title).toBe('1 possible absence in your team');
    expect(await notes('NEW', 'possible_absence')).toEqual([]);
    expect(await notices('NEW')).toEqual([]);
  });

  it('switched on: only absences from that day on, one notice per absence, growing without a new message', async () => {
    await db.query(`insert into leave_discipline_settings (tenant_id, notify_employees, notify_from, reply_working_days)
                    values ($1, true, '2026-03-04', 2)`, [C]);
    // the 5th: Wed 4 is new (Mon 2, before the switch-on, is the backlog)
    await notify('2026-03-05');
    expect(await notices('NEW')).toEqual([{ start_date: '2026-03-04', end_date: '2026-03-04', notified_on: '2026-03-05', reply_by: '2026-03-09' }]);
    const sent = await notes('NEW', 'possible_absence');
    expect(sent).toHaveLength(1);
    expect(sent[0].message).toBe('We have no clock-in for you on Wed 4 Mar and no approved leave. If you were at work or on leave, submit a '
      + 'missed-scan request or a leave application by Mon 9 Mar. Otherwise it may be recorded as an unexcused absence, which is '
      + 'unpaid and can lead to disciplinary action.');
    // nothing is recorded or warned
    expect((await rows<{ n: number }>(`select count(*)::int as n from leave_absences where tenant_id = $1`, [C]))[0].n).toBe(0);
    expect((await rows<{ n: number }>(`select count(*)::int as n from warnings where tenant_id = $1`, [C]))[0].n).toBe(0);
    // the 6th: the absence grew to Thu 5; the same notice, no new message
    await notify('2026-03-06');
    expect(await notices('NEW')).toEqual([{ start_date: '2026-03-04', end_date: '2026-03-05', notified_on: '2026-03-05', reply_by: '2026-03-09' }]);
    expect(await notes('NEW', 'possible_absence')).toHaveLength(1);
    const listed = await listFor(C, '2026-03-06', 'NEW');
    expect(listed.map((e) => [e.start_date, e.notified_on, e.reply_by])).toEqual([['2026-03-02', null, null], ['2026-03-04', '2026-03-05', '2026-03-09']]);
  });

  it('at most one message a day: two new absences go in one', async () => {
    await notify('2026-03-12');
    const sent = await notes('NEW2', 'possible_absence');
    expect(sent).toHaveLength(1);
    expect(sent[0].message).toMatch(/^We have no clock-in for you on Mon 9 Mar and Wed 11 Mar and no approved leave/);
    expect((await notices('NEW2')).map((n) => n.start_date)).toEqual(['2026-03-09', '2026-03-11']);
  });

  it("the employee's reply takes the days off the list: a missed-scan request, or leave (pending shows, approved removes)", async () => {
    await db.query(`insert into attendance_missed_scan_requests (tenant_id, employee_number, work_date, came_in_at, reason, status, approver)
                    values ($1, 'NEW', '2026-03-05', '2026-03-05T08:00:00+03:00', 'Forgot to scan', 'pending', 'hr')`, [C]);
    expect(ranges(await listFor(C, '2026-03-14', 'NEW'))).toEqual(['NEW 2026-03-02..2026-03-02 (1)', 'NEW 2026-03-04..2026-03-04 (1)']);
    await db.query(`insert into leave_application (tenant_id, "Employee Number", name, "Leave Type", "Start Date", "End Date", status)
                    values ($1, 'NEW', 'Nia', 'Sick Leave', '2026-03-04', '2026-03-04', 'pending')`, [C]);
    expect((await listFor(C, '2026-03-14', 'NEW')).map((e) => e.pending_leave)).toEqual([false, true]);
    await db.query(`delete from leave_application where tenant_id = $1 and "Employee Number" = 'NEW'`, [C]);
    await db.query(`insert into leave_application (tenant_id, "Employee Number", name, "Leave Type", "Start Date", "End Date", status)
                    values ($1, 'NEW', 'Nia', 'Sick Leave', '2026-03-04', '2026-03-04', 'approved')`, [C]);
    expect(ranges(await listFor(C, '2026-03-14', 'NEW'))).toEqual(['NEW 2026-03-02..2026-03-02 (1)']);
  });

  it('switched off: no notices', async () => {
    await db.query(`update leave_discipline_settings set notify_employees = false where tenant_id = $1`, [C]);
    await db.query(`delete from attendance_logs where tenant_id = $1 and employee_number = 'BOSS' and work_date = '2026-03-13'`, [C]);
    await notify('2026-03-16');
    expect(await notes('BOSS', 'possible_absence')).toEqual([]);
  });

  it('the daily job runs for every company', async () => {
    expect(await fails(db.query(`select notify_possible_absences_all()`))).toBe('');
  });
});
