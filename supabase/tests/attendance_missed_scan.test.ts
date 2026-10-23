// @vitest-environment node
//
// Missed-scan requests (20261025100000, FIG-1201): an employee says "I forgot to scan" for a day (today or up to the
// company's days back), with the time they came in and/or left and a reason; it goes to their manager (else HR, or HR
// only by the setting); the approver approves (applied as HR's correction) or declines with a comment; nobody decides
// their own. And the freeze fix: a day whose clock-in was corrected still takes its clock-out from later scans, while a
// clock-out HR fixed stays fixed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000f401';
const ADMIN = '00000000-0000-0000-0000-00000000f402';
const ME = '00000000-0000-0000-0000-00000000f403';
const LEAD = '00000000-0000-0000-0000-00000000f404';
const THEM = '00000000-0000-0000-0000-00000000f405';
const ADMIN_B = '00000000-0000-0000-0000-00000000f406';
const SERIAL = 'MISS000001';
const MIGRATION = join(__dirname, '..', 'migrations', '20261025100000_attendance_missed_scan_requests.sql');

let db: PGlite;
// days counted back from today (Nairobi), as "YYYY-MM-DD"
let D: (back: number) => string;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const as = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) =>
  asUser(db, user, () => rows<T>(sql, params));
/** a Nairobi moment on a day: at('2026-10-22', '07:59') */
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00+03:00`;
const line = (pin: string, day: string, hhmm: string) => `${pin}\t${day} ${hhmm}:00\t0\t1\t0\t0\t0`;
const receive = async (lines: string[]) => {
  await db.exec('set role service_role');
  try {
    return (await rows<{ r: Record<string, number> }>(`select public.attendance_scanner_receive($1, '41.90.12.34', $2) as r`, [SERIAL, lines.join('\n')]))[0].r;
  } finally {
    await db.exec('reset role');
  }
};
interface Req { id: string; status: string; approver: string; manager_number: string | null }
const ask = (user: string, day: string, cameIn: string | null, left: string | null, reason: string | null) =>
  as<Req>(user, `select id, status, approver, manager_number from public.attendance_missed_scan_request($1, $2, $3, $4)`,
    [day, cameIn && at(day, cameIn), left && at(day, left), reason]).then((r) => r[0]);
const decide = (user: string, id: string, decision: 'approve' | 'decline', comment: string | null = null) =>
  as<{ status: string; decided_by_name: string }>(user, `select status, decided_by_name from public.attendance_missed_scan_decide($1, $2, $3)`,
    [id, decision, comment]).then((r) => r[0]);
interface Day { login: string | null; logout: string | null; source: string; note: string | null; fixed_in: boolean; fixed_out: boolean }
const day = async (emp: string, workDate: string) =>
  (await rows<Day>(
    `select to_char(login_time at time zone 'Africa/Nairobi', 'HH24:MI') as login,
            to_char(logout_time at time zone 'Africa/Nairobi', 'HH24:MI') as logout, source, note,
            hr_fixed_in as fixed_in, hr_fixed_out as fixed_out
     from attendance_logs where tenant_id = $1 and employee_number = $2 and work_date = $3 and source <> 'legacy'`, [A, emp, workDate]))[0];
const notes = (emp: string, type: string) =>
  rows<{ title: string; message: string }>(
    `select title, message from hr_notifications where tenant_id = $1 and employee_number = $2 and notification_type = $3 order by id`,
    [A, emp, type]);
const setRules = (daysBack: number, approver: 'manager' | 'hr') =>
  db.query(`update attendance_settings set missed_scan_days_back = $1, missed_scan_approver = $2 where tenant_id = $3`, [daysBack, approver, A]);

beforeAll(async () => {
  db = await bootLiveDb();
  const today = (await rows<{ d: string }>(`select ((now() at time zone 'Africa/Nairobi')::date)::text as d`))[0].d;
  D = (back: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - back);
    return d.toISOString().slice(0, 10);
  };
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  for (const [id, email, role, tenant] of [
    [HR, 'hr@a.co', 'HR', A], [ADMIN, 'owner@a.co', 'ADMIN', A], [ME, 'me@a.co', 'STAFF', A], [LEAD, 'lead@a.co', 'STAFF', A],
    [THEM, 'them@a.co', 'STAFF', A], [ADMIN_B, 'admin@b.co', 'ADMIN', B],
  ]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${tenant}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into attendance_settings (tenant_id, tracking_from) values ('${A}', '${D(60)}'), ('${B}', '${D(60)}')
      on conflict (tenant_id) do update set tracking_from = excluded.tracking_from;
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Status", "Start Date", manager_email, tenant_id) values
      ('A-ME', 'Given', 'Otieno', 'me@a.co', 'Active', '2025-01-06', 'lead@a.co', '${A}'),
      ('A-THEM', 'Joe', 'Mwangi', 'them@a.co', 'Active', '2025-01-06', null, '${A}'),
      ('A-LEAD', 'Mary', 'Kamau', 'lead@a.co', 'Active', '2025-01-06', null, '${A}'),
      ('A-HR', 'Hana', 'Rono', 'hr@a.co', 'Active', '2025-01-06', null, '${A}'),
      ('B-1', 'Bo', 'Bee', 'bo@b.co', 'Active', '2025-01-06', null, '${B}');
    delete from holidays;
  `);
  await as(HR, `insert into attendance_devices (name, serial_number) values ('Front Door', $1)`, [SERIAL]);
  await as(HR, `insert into attendance_scanner_users (scanner_user_id, employee_number) values ('1', 'A-ME'), ('2', 'A-THEM')`);
}, 120000);

describe('the settings', () => {
  it('default to 7 days back and the manager, else HR; HR changes them, staff can’t', async () => {
    expect(await as(ME, `select public.attendance_missed_scan_rules() as r`))
      .toEqual([{ r: { days_back: 7, approver: 'manager', approver_name: 'Mary Kamau' } }]);
    expect(await as(THEM, `select public.attendance_missed_scan_rules() as r`))
      .toEqual([{ r: { days_back: 7, approver: 'hr', approver_name: 'HR' } }]);
    await as(ME, `update attendance_settings set missed_scan_days_back = 30`);
    expect(await as(HR, `select missed_scan_days_back as n, missed_scan_approver as a from attendance_settings`)).toEqual([{ n: 7, a: 'manager' }]);
    expect(await fails(as(HR, `update attendance_settings set missed_scan_days_back = 40`))).toMatch(/missed_scan_days_check/);
    expect(await fails(as(HR, `update attendance_settings set missed_scan_approver = 'ceo'`))).toMatch(/missed_scan_approver_check/);
    await as(HR, `update attendance_settings set missed_scan_days_back = 3, missed_scan_approver = 'hr'`);
    expect(await as(ME, `select public.attendance_missed_scan_rules() as r`))
      .toEqual([{ r: { days_back: 3, approver: 'hr', approver_name: 'HR' } }]);
    await setRules(7, 'manager');
  });
});

describe('asking', () => {
  it('a day from today back to the setting, a time on that day that has happened, a reason', async () => {
    expect(await fails(ask(ME, D(-1), '08:00', null, 'forgot'))).toMatch(/today or a day before/);
    expect(await fails(ask(ME, D(8), '08:00', null, 'forgot'))).toMatch(/up to 7 days back/);
    expect(await fails(ask(ME, D(1), null, null, 'forgot'))).toMatch(/came in or the time you left/);
    expect(await fails(ask(ME, D(1), '08:00', null, '  '))).toMatch(/Say why/);
    expect(await fails(ask(ME, D(1), '17:00', '08:00', 'forgot'))).toMatch(/left must be after the time you came in/);
    expect(await fails(as(ME, `select public.attendance_missed_scan_request($1, $2, null, 'forgot')`, [D(1), at(D(2), '08:00')])))
      .toMatch(/must be on/);
    // a time that hasn't happened yet (asked at noon for 1 pm)
    expect(await fails(rows(`select public.attendance_missed_scan_request_for($1, 'A-ME', $2, $3, null, 'forgot', $4)`,
      [A, D(1), at(D(1), '13:00'), at(D(1), '12:00')]))).toMatch(/hasn.t happened yet/);
    // only the time they left, with no clock-in that day
    expect(await fails(ask(ME, D(6), null, '17:00', 'forgot'))).toMatch(/no clock-in that day/);
    await setRules(0, 'manager');
    expect(await fails(ask(ME, D(1), '08:00', null, 'forgot'))).toMatch(/today only/);
    await setRules(7, 'manager');
    // someone not linked to an employee record
    expect(await fails(as(ADMIN, `select public.attendance_missed_scan_request($1, $2, null, 'x')`, [D(1), at(D(1), '08:00')])))
      .toMatch(/isn't linked to an employee record/);
  });

  it('one open request per person per day; cancelled while pending, a new one can go', async () => {
    const first = await ask(ME, D(5), '08:05', null, 'forgot');
    expect(await fails(ask(ME, D(5), '08:10', null, 'forgot again'))).toMatch(/already have a request waiting/);
    // only the person cancels their own
    expect(await fails(as(LEAD, `select public.attendance_missed_scan_cancel($1)`, [first.id]))).toMatch(/not found/);
    expect((await as<{ status: string }>(ME, `select status from public.attendance_missed_scan_cancel($1)`, [first.id]))[0].status).toBe('cancelled');
    expect(await fails(as(ME, `select public.attendance_missed_scan_cancel($1)`, [first.id]))).toMatch(/already cancelled/);
    expect(await fails(decide(LEAD, first.id, 'approve'))).toMatch(/already cancelled/);
    const second = await ask(ME, D(5), '08:10', null, 'forgot again');
    expect(second.status).toBe('pending');
    await as(ME, `select public.attendance_missed_scan_cancel($1)`, [second.id]);
  });
});

describe('routing and notifications', () => {
  it('goes to the manager (in their staff portal bell), or to HR when there is none', async () => {
    const mine = await ask(ME, D(4), '07:59', null, 'forgot to scan');
    expect(mine).toMatchObject({ approver: 'manager', manager_number: 'A-LEAD' });
    const told = await notes('A-LEAD', 'missed_scan_request');
    expect(told.at(-1)).toEqual({
      title: 'Missed scan to approve',
      message: expect.stringMatching(/^Given Otieno \(A-ME\) missed a scan on \w{3} \d{1,2} \w{3}: came in 7:59 am\. Reason: forgot to scan$/),
    });
    // it's the manager's own notification, emailed like the employee's own (important)
    expect((await rows<{ b: boolean; i: boolean }>(`select public.hr_only_notification('missed_scan_request') b, public.important_notification('missed_scan_request') i`))[0])
      .toEqual({ b: false, i: true });

    const theirs = await ask(THEM, D(4), '08:43', null, 'phone died');
    expect(theirs).toMatchObject({ approver: 'hr', manager_number: null });
    expect((await notes('A-THEM', 'missed_scan_requested')).at(-1)?.message).toMatch(/^Joe Mwangi \(A-THEM\) missed a scan on .*: came in 8:43 am\. Reason: phone died$/);
    // an HR alert: HR and admins see it and are emailed; Joe doesn't see it
    expect((await rows<{ b: boolean }>(`select public.hr_only_notification('missed_scan_requested') as b`))[0].b).toBe(true);
    const to = (await rows<{ user_id: string }>(`select user_id from public.hr_alert_recipients($1, 'missed_scan_requested')`, [A]))
      .map((r) => r.user_id).sort();
    expect(to).toEqual([HR, ADMIN].sort());
    await as(ME, `select public.attendance_missed_scan_cancel($1)`, [mine.id]);
    await as(THEM, `select public.attendance_missed_scan_cancel($1)`, [theirs.id]);
  });

  it('"HR only" sends even a person with a manager to HR', async () => {
    await setRules(7, 'hr');
    const r = await ask(ME, D(4), '07:59', null, 'forgot');
    expect(r).toMatchObject({ approver: 'hr', manager_number: null });
    expect((await notes('A-ME', 'missed_scan_requested')).length).toBe(1);
    // the manager can't decide an HR request
    expect(await fails(decide(LEAD, r.id, 'approve'))).toMatch(/Only their manager or HR/);
    await as(ME, `select public.attendance_missed_scan_cancel($1)`, [r.id]);
    await setRules(7, 'manager');
  });

  it('who sees what: the person their own, a manager their reports’, HR everyone’s', async () => {
    const r = await ask(ME, D(3), '08:00', null, 'forgot');
    const t = await ask(THEM, D(3), '08:00', null, 'forgot');
    const list = (user: string) => as<{ employee_number: string; can_decide: boolean; mine: boolean }>(user,
      `select employee_number, can_decide, mine from public.attendance_missed_scans('pending')`);
    expect(await list(ME)).toEqual([{ employee_number: 'A-ME', can_decide: false, mine: true }]);
    expect(await list(LEAD)).toEqual([{ employee_number: 'A-ME', can_decide: true, mine: false }]);
    expect((await list(HR)).map((x) => [x.employee_number, x.can_decide]).sort()).toEqual([['A-ME', true], ['A-THEM', true]]);
    expect(await list(THEM)).toEqual([{ employee_number: 'A-THEM', can_decide: false, mine: true }]);
    // the table itself: the same
    expect(await as(ME, `select employee_number from attendance_missed_scan_requests where status = 'pending'`)).toEqual([{ employee_number: 'A-ME' }]);
    expect(await fails(as(ME, `update attendance_missed_scan_requests set status = 'approved'`))).toMatch(/permission denied/);
    await as(ME, `select public.attendance_missed_scan_cancel($1)`, [r.id]);
    await as(THEM, `select public.attendance_missed_scan_cancel($1)`, [t.id]);
  });
});

describe('deciding', () => {
  it('approving applies the correction as HR would, and the evening scans still become the clock-out (Given, 22 Oct)', async () => {
    const d = D(2);
    // no scan on arrival; the first at 10:54
    await receive([line('1', d, '10:54')]);
    expect(await day('A-ME', d)).toMatchObject({ login: '10:54', logout: null, source: 'scanner' });
    const r = await ask(ME, d, '07:59', null, 'forgot to scan');
    // staff who aren't the manager can't decide; another company can't see it
    expect(await fails(decide(THEM, r.id, 'approve'))).toMatch(/Only their manager or HR/);
    expect(await fails(decide(ADMIN_B, r.id, 'approve'))).toMatch(/not found/);
    expect(await decide(LEAD, r.id, 'approve')).toEqual({ status: 'approved', decided_by_name: 'Mary Kamau' });
    expect(await day('A-ME', d)).toEqual({
      login: '07:59', logout: '10:54', source: 'hr', note: 'Missed scan: forgot to scan (approved by Mary Kamau)', fixed_in: true, fixed_out: false,
    });
    // the evening scan moves the clock-out; an earlier one doesn't move the corrected clock-in
    await receive([line('1', d, '17:32'), line('1', d, '07:30')]);
    expect(await day('A-ME', d)).toMatchObject({ login: '07:59', logout: '17:32' });
    expect(await rows(`select skipped_reason from attendance_scanner_punches where employee_number = 'A-ME' and punched_at = $1`, [at(d, '07:30')]))
      .toEqual([{ skipped_reason: 'hr_corrected' }]);
    const days = await as<{ status: string; clock_out_via: string; late_minutes: number }>(HR,
      `select status, clock_out_via, late_minutes from public.attendance_days($1, $1, 'A-ME')`, [d]);
    expect(days).toEqual([expect.objectContaining({ clock_out_via: 'scanner', late_minutes: 0 })]);
    expect((await notes('A-ME', 'missed_scan_approved')).at(-1)).toEqual({
      title: 'Missed scan approved',
      message: expect.stringMatching(/^Your missed scan on .* was approved by Mary Kamau: came in 7:59 am\.$/),
    });
    // decided once
    expect(await fails(decide(HR, r.id, 'decline', 'no'))).toMatch(/already approved/);
  });

  it('a request for the time they left only: the clock-out is fixed, the clock-in stays the scanner’s', async () => {
    const d = D(3);
    await receive([line('1', d, '08:10')]);
    const r = await ask(ME, d, null, '17:10', 'scanner was off');
    await decide(HR, r.id, 'approve');
    expect(await day('A-ME', d)).toMatchObject({ login: '08:10', logout: '17:10', source: 'hr', fixed_in: false, fixed_out: true });
    // a later scan doesn't move the fixed clock-out; an earlier one still moves the clock-in
    await receive([line('1', d, '18:30'), line('1', d, '07:50')]);
    expect(await day('A-ME', d)).toMatchObject({ login: '07:50', logout: '17:10' });
  });

  it('declining needs a comment and changes nothing; the person is told', async () => {
    const d = D(1);
    await receive([line('2', d, '11:04')]);
    const r = await ask(THEM, d, '08:43', null, 'forgot');
    expect(await fails(decide(HR, r.id, 'decline'))).toMatch(/Add a comment/);
    expect(await decide(HR, r.id, 'decline', 'You were at the bank until 11')).toMatchObject({ status: 'declined' });
    expect(await day('A-THEM', d)).toMatchObject({ login: '11:04', source: 'scanner' });
    expect((await notes('A-THEM', 'missed_scan_declined')).at(-1)).toEqual({
      title: 'Missed scan declined',
      message: expect.stringMatching(/^Your missed scan on .* \(came in 8:43 am\) was declined by Hana Rono\. Comment: You were at the bank until 11\.$/),
    });
  });

  it('nobody approves their own request', async () => {
    // HR (Hana) asks: it goes to HR, but she can't decide it; an admin can
    const r = await ask(HR, D(1), '08:00', null, 'forgot');
    expect(r.approver).toBe('hr');
    expect(await fails(decide(HR, r.id, 'approve'))).toMatch(/your own request/);
    expect(await as(HR, `select can_decide from public.attendance_missed_scans('pending', 'A-HR')`)).toEqual([{ can_decide: false }]);
    expect(await decide(ADMIN, r.id, 'approve')).toMatchObject({ status: 'approved' });
    expect(await day('A-HR', D(1))).toMatchObject({ login: '08:00', source: 'hr' });
  });
});

describe('HR’s own correction: the freeze fix', () => {
  it('a clock-in corrected with the clock-out left empty keeps taking the clock-out from scans', async () => {
    const d = D(5);
    await receive([line('2', d, '11:04')]);
    await as(HR, `select public.attendance_set_day('A-THEM', $1, $2, null, 'Arrived 8:43, confirmed')`, [d, at(d, '08:43')]);
    expect(await day('A-THEM', d)).toMatchObject({ login: '08:43', logout: '11:04', source: 'hr', fixed_in: true, fixed_out: false });
    await receive([line('2', d, '17:45')]);
    expect(await day('A-THEM', d)).toMatchObject({ login: '08:43', logout: '17:45' });
  });

  it('a clock-out HR fixed stays fixed', async () => {
    const d = D(6);
    await receive([line('2', d, '08:00')]);
    await as(HR, `select public.attendance_set_day('A-THEM', $1, $2, $3, 'Left early, agreed')`, [d, at(d, '08:00'), at(d, '15:00')]);
    await receive([line('2', d, '18:00')]);
    expect(await day('A-THEM', d)).toMatchObject({ login: '08:00', logout: '15:00', fixed_in: true, fixed_out: true });
    expect(await rows(`select skipped_reason from attendance_scanner_punches where employee_number = 'A-THEM' and punched_at = $1`, [at(d, '18:00')]))
      .toEqual([{ skipped_reason: 'hr_corrected' }]);
    // reopening the clock-out takes the scan HR's fixed clock-out held back
    await as(HR, `select public.attendance_set_day('A-THEM', $1, $2, null, 'Stayed late after all')`, [d, at(d, '08:00')]);
    expect(await day('A-THEM', d)).toMatchObject({ logout: '18:00', fixed_out: false });
  });
});

describe('companies are kept apart', () => {
  it('another company sees none of the requests and can’t decide them', async () => {
    expect(await as(ADMIN_B, `select * from public.attendance_missed_scans()`)).toEqual([]);
    expect(await as(ADMIN_B, `select * from attendance_missed_scan_requests`)).toEqual([]);
    const r = await ask(ME, D(0), '00:01', null, 'forgot');
    expect(await fails(decide(ADMIN_B, r.id, 'approve'))).toMatch(/not found/);
    await as(ME, `select public.attendance_missed_scan_cancel($1)`, [r.id]);
  });
});

describe('the migration', () => {
  it('runs again safely: requests, settings and which times are fixed stay as they are', async () => {
    const snapshot = async () => ({
      requests: await rows(`select id, status, approver, decided_at::text from attendance_missed_scan_requests order by id`),
      logs: await rows(`select id, hr_fixed_in, hr_fixed_out, logout_time::text from attendance_logs order by id`),
      settings: await rows(`select tenant_id, missed_scan_days_back, missed_scan_approver from attendance_settings order by tenant_id`),
    });
    const before = await snapshot();
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    await db.exec('reset search_path');
    expect(await snapshot()).toEqual(before);
    // and still works
    const d = D(5);
    await receive([line('2', d, '19:00')]);
    expect(await day('A-THEM', d)).toMatchObject({ logout: '19:00' });
  });
});
