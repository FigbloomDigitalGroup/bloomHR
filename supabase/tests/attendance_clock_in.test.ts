// @vitest-environment node
//
// Clock in / clock out and work schedules (20261023300000): one record per employee per Nairobi day; clocking in again
// after clocking out keeps the first clock-in; days are classed present / late / absent / leave / holiday / off against
// the employee's schedule (a branch's own, the company's, or Monday to Friday 08:00 with 30 minutes' grace); the old
// portal-open rows are ignored; HR corrects days with a note; staff can't write the table, clock someone else in or read
// others; managers see their reports; companies never see each other's. Working days before the company's
// attendance_tracking_from (20261023400000) are not absent.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000e101';
const ME = '00000000-0000-0000-0000-00000000e102';
const LEAD = '00000000-0000-0000-0000-00000000e103'; // STAFF role, supervises A-ME
const NOBODY = '00000000-0000-0000-0000-00000000e104'; // signed in, no employee record
const ADMIN_B = '00000000-0000-0000-0000-00000000e105';
// the week of Mon 19 - Sun 25 October 2026; "today" is Thursday 22nd
const TODAY = '2026-10-22';
const MIGRATION = join(__dirname, '..', 'migrations', '20261023300000_attendance_clock_in.sql');
const TRACKING_MIGRATION = join(__dirname, '..', 'migrations', '20261023400000_attendance_tracking_from.sql');
const ODD_HOURS_MIGRATION = join(__dirname, '..', 'migrations', '20261023800000_attendance_odd_hours.sql');

let db: PGlite;
let dar: string;
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
/** the system clocks someone in or out at a given moment */
const punch = (emp: string, kind: 'in' | 'out', at: string, loc: unknown = null) =>
  rows<{ t: Record<string, unknown> }>(`select public.attendance_punch($1, $2, $3, $4, $5) as t`, [A, emp, kind, loc === null ? null : JSON.stringify(loc), at]);

interface Day { employee_number: string; day: string; status: string | null; clock_in: string | null; clock_out: string | null; hours: string | null; late_minutes: number | null }
const days = async (emp: string | null, from = '2026-10-19', to = '2026-10-25', tenant = A) =>
  (await rows<Day>(
    `select employee_number, to_char(day, 'YYYY-MM-DD') as day, status, clock_in::text, clock_out::text, hours::text, late_minutes
     from public.attendance_days_for($1, $2, $3, $4, $5)`, [tenant, from, to, emp, TODAY]));
const statuses = async (emp: string) => Object.fromEntries((await days(emp)).map((d) => [d.day.slice(8), d.status]));

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  for (const [id, email, role, tenant] of [
    [HR, 'hr@a.co', 'HR', A], [ME, 'me@a.co', 'STAFF', A], [LEAD, 'lead@a.co', 'STAFF', A], [NOBODY, 'nobody@a.co', 'STAFF', A],
    [ADMIN_B, 'admin@b.co', 'ADMIN', B],
  ]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${tenant}');
    `);
  }
  dar = (await rows<{ id: string }>(`insert into branches (tenant_id, name, country) values ($1, 'Dar es Salaam', 'Tanzania') returning id`, [A]))[0].id;
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    -- both companies have counted attendance for a long time (the tracking-from tests change A's)
    insert into attendance_settings (tenant_id, tracking_from) values ('${A}', '2025-01-01'), ('${B}', '2025-01-01')
      on conflict (tenant_id) do update set tracking_from = excluded.tracking_from;
    insert into employees ("Employee Number", "First Name", "Work Email", "Status", "Start Date", "Termination Date", manager_email, tenant_id) values
      ('A-ME', 'Mo', 'me@a.co', 'Active', '2025-01-06', null, 'lead@a.co', '${A}'),
      ('A-THEM', 'Tia', 'them@a.co', 'Active', '2025-01-06', null, null, '${A}'),
      ('A-LEAD', 'Lena', 'lead@a.co', 'Active', '2025-01-06', null, null, '${A}'),
      ('A-HR', 'Hana', 'hr@a.co', 'Active', '2025-01-06', null, null, '${A}'),
      ('A-DAR', 'Dina', 'dar@a.co', 'Active', '2025-01-06', null, null, '${A}'),
      ('A-NEW', 'Neo', 'new@a.co', 'Active', '2026-10-21', null, null, '${A}'),
      ('A-GONE', 'Gus', 'gone@a.co', 'Terminated', '2025-01-06', '2026-10-20', null, '${A}'),
      ('A-OLD', 'Ola', 'old@a.co', 'Terminated', '2024-01-06', '2025-12-31', null, '${A}'),
      ('B-1', 'Bo', 'bo@b.co', 'Active', '2025-01-06', null, null, '${B}');
    insert into employees ("Employee Number", "First Name", "Status", worker_kind, daily_rate, tenant_id) values
      ('A-CAS', 'Cas', 'Active', 'casual', 800, '${A}');
    update employees set branch_id = '${dar}' where "Employee Number" = 'A-DAR';
    select seed_default_leave_types('${A}');
    -- only these holidays: one for everyone (Wednesday), one for Tanzania only (Monday)
    delete from holidays;
    insert into holidays (tenant_id, name, date, country) values
      ('${A}', 'Company day', '2026-10-21', null), ('${A}', 'Tanzania day', '2026-10-19', 'Tanzania');
    -- Dar works Monday to Saturday from 07:00, no grace
    insert into work_schedules (tenant_id, branch_id, work_days, start_time, end_time, grace_minutes)
      values ('${A}', '${dar}', '{6,1,2,3,4,5}', '07:00', '16:00', 0);
    -- Tia's approved leave on Tuesday; a pending one on Friday doesn't count
    insert into leave_application ("Employee Number", name, "Leave Type", "Start Date", "End Date", status, tenant_id) values
      ('A-THEM', 'Tia', 'Annual Leave', '2026-10-20', '2026-10-20', 'Approved', '${A}'),
      ('A-THEM', 'Tia', 'Annual Leave', '2026-10-23', '2026-10-23', 'pending', '${A}');
    -- an old portal-open row, before this migration's model
    insert into attendance_logs (tenant_id, employee_number, login_time, status, source, work_date)
      values ('${A}', 'A-THEM', '2026-10-19T05:00:00Z', 'logged_in', 'legacy', '2026-10-19');
  `);
  // Mo: Monday at 08:30 sharp (on time), Tuesday at 08:31 (late); Dina (Dar, 07:00 no grace): Tuesday at 07:01
  await punch('A-ME', 'in', '2026-10-19T05:30:59Z');
  await punch('A-ME', 'in', '2026-10-20T05:31:00Z');
  await punch('A-ME', 'out', '2026-10-20T14:01:00Z');
  await punch('A-DAR', 'in', '2026-10-20T04:01:00Z');
  await punch('A-GONE', 'in', '2026-10-20T05:00:00Z');
}, 120000);

describe('work schedules', () => {
  it('the built-in default is Monday to Friday, 08:00 to 17:00 with 30 minutes’ grace', async () => {
    expect((await rows(`select work_days, start_time::text, end_time::text, grace_minutes from public.work_schedule_for($1, 'A-ME')`, [A]))[0])
      .toEqual({ work_days: [1, 2, 3, 4, 5], start_time: '08:00:00', end_time: '17:00:00', grace_minutes: 30 });
  });

  it('a branch’s own schedule overrides the company’s (the days kept in order)', async () => {
    expect((await rows(`select work_days, start_time::text, grace_minutes from public.work_schedule_for($1, 'A-DAR')`, [A]))[0])
      .toEqual({ work_days: [1, 2, 3, 4, 5, 6], start_time: '07:00:00', grace_minutes: 0 });
  });

  it('HR sets the company default; staff read it but can’t change it; bad values are refused', async () => {
    expect(await fails(as(ME, `insert into work_schedules (start_time) values ('09:00')`))).toMatch(/row-level security/);
    expect(await fails(as(HR, `insert into work_schedules (grace_minutes) values (500)`))).toMatch(/work_schedules_grace_check/);
    expect(await fails(as(HR, `insert into work_schedules (work_days) values ('{0,8}')`))).toMatch(/work_schedules_days_check/);
    expect(await fails(as(HR, `insert into work_schedules (start_time, end_time) values ('17:00', '08:00')`))).toMatch(/work_schedules_times_check/);
    await as(HR, `insert into work_schedules (work_days, start_time, grace_minutes) values ('{1,2,3,4,5}', '08:00', 30)`);
    expect(await fails(as(HR, `insert into work_schedules (start_time) values ('09:00')`))).toMatch(/duplicate key|unique/);
    expect((await as(ME, `select start_time::text, updated_by from work_schedules where branch_id is null`))).toEqual([{ start_time: '08:00:00', updated_by: HR }]);
    expect(await as(ADMIN_B, `select 1 from work_schedules`)).toEqual([]);
    // another company's branch can't be given a schedule here
    expect(await fails(as(ADMIN_B, `insert into work_schedules (branch_id) values ($1)`, [dar]))).toMatch(/Unknown branch/);
  });
});

describe('clocking in and out', () => {
  it('in, out, and back in: one record, the first clock-in kept, the clock-out cleared', async () => {
    await punch('A-THEM', 'in', '2026-10-12T05:05:00Z', { latitude: -1.28, longitude: 36.82 });
    await punch('A-THEM', 'out', '2026-10-12T09:00:00Z');
    let t = (await punch('A-THEM', 'in', '2026-10-12T10:00:00Z'))[0].t;
    expect(t).toMatchObject({ date: '2026-10-12', status: 'present', clock_out: null, start_time: '08:00', late_after: '08:30', working_day: true });
    expect(new Date(t.clock_in as string).toISOString()).toBe('2026-10-12T05:05:00.000Z');
    t = (await punch('A-THEM', 'out', '2026-10-12T14:00:00Z'))[0].t;
    expect(new Date(t.clock_out as string).toISOString()).toBe('2026-10-12T14:00:00.000Z');
    const recs = await rows<{ n: number; geolocation: unknown; source: string }>(
      `select count(*) over () ::int as n, geolocation, source from attendance_logs where employee_number = 'A-THEM' and work_date = '2026-10-12'`);
    expect(recs).toEqual([{ n: 1, geolocation: { in: { latitude: -1.28, longitude: 36.82 } }, source: 'app' }]);
    expect((await days('A-THEM', '2026-10-12', '2026-10-12'))[0]).toMatchObject({ status: 'present', hours: '8.92', late_minutes: 0 });
  });

  it('clocking out before clocking in is refused', async () => {
    expect(await fails(punch('A-THEM', 'out', '2026-10-13T14:00:00Z'))).toMatch(/haven't clocked in today/);
  });

  it('the day is the Nairobi day (22:30 UTC is the next morning)', async () => {
    await punch('A-THEM', 'in', '2026-10-13T22:30:00Z');
    expect((await rows(`select to_char(work_date, 'YYYY-MM-DD') d from attendance_logs where employee_number = 'A-THEM' and login_time = '2026-10-13T22:30:00Z'`))[0].d).toBe('2026-10-14');
  });
});

describe('attendance_days', () => {
  it('08:30 is on time, 08:31 is late; weekends are off; a holiday for everyone; future days and today are not absent', async () => {
    expect(await statuses('A-ME')).toEqual({ '19': 'present', '20': 'late', '21': 'holiday', '22': null, '23': null, '24': 'off', '25': 'off' });
    const [mon, tue] = await days('A-ME');
    expect(mon).toMatchObject({ late_minutes: 0, hours: null, clock_out: null });
    // minutes late count from the late mark (8:30, 20261023900000): 8:31 is 1 minute late
    expect(tue).toMatchObject({ late_minutes: 1, hours: '8.50' });
  });

  it('approved leave counts as leave, a pending one does not; legacy rows are ignored (Monday is absent)', async () => {
    expect(await statuses('A-THEM')).toEqual({ '19': 'absent', '20': 'leave', '21': 'holiday', '22': null, '23': null, '24': 'off', '25': 'off' });
  });

  it('a branch’s schedule and country: Monday is Tanzania’s holiday, 07:01 is late with no grace, Saturday is a working day', async () => {
    expect(await statuses('A-DAR')).toEqual({ '19': 'holiday', '20': 'late', '21': 'holiday', '22': null, '23': null, '24': null, '25': 'off' });
    expect((await days('A-DAR'))[1].late_minutes).toBe(1);
  });

  it('leaves out days before someone started and after they left, people who left before, and casual workers', async () => {
    expect(Object.keys(await statuses('A-NEW'))).toEqual(['21', '22', '23', '24', '25']);
    expect(await statuses('A-GONE')).toEqual({ '19': 'absent', '20': 'present' });
    const everyone = new Set((await days(null)).map((d) => d.employee_number));
    expect([...everyone].sort()).toEqual(['A-DAR', 'A-GONE', 'A-HR', 'A-LEAD', 'A-ME', 'A-NEW', 'A-THEM']);
  });
});

describe('the signed-in employee', () => {
  it('clocks in (again: the same record), sees today, clocks out', async () => {
    const first = (await as<{ t: Record<string, unknown> }>(ME, `select public.attendance_clock_in('{"latitude": 1, "longitude": 2}') as t`))[0].t;
    expect(first).toMatchObject({ employee_number: 'A-ME', start_time: '08:00', late_after: '08:30' });
    expect(first.clock_in).toBeTruthy();
    const again = (await as<{ t: Record<string, unknown> }>(ME, `select public.attendance_clock_in() as t`))[0].t;
    expect(again.clock_in).toBe(first.clock_in);
    expect((await as<{ t: Record<string, unknown> }>(ME, `select public.attendance_today() as t`))[0].t.clock_in).toBe(first.clock_in);
    const out = (await as<{ t: Record<string, unknown> }>(ME, `select public.attendance_clock_out() as t`))[0].t;
    expect(out.clock_out).toBeTruthy();
  });

  it('someone with no employee record is told so', async () => {
    expect(await fails(as(NOBODY, `select public.attendance_clock_in()`))).toMatch(/isn't linked to an employee record/);
  });

  it('staff can’t write the table, clock someone else in, correct a day or read others', async () => {
    expect(await fails(as(ME, `insert into attendance_logs (employee_number, login_time) values ('A-ME', now())`))).toMatch(/permission denied/);
    expect(await fails(as(ME, `update attendance_logs set login_time = now() where employee_number = 'A-ME'`))).toMatch(/permission denied/);
    expect(await fails(as(ME, `delete from attendance_logs where employee_number = 'A-ME'`))).toMatch(/permission denied/);
    expect(await fails(as(ME, `select public.attendance_punch($1, 'A-THEM', 'in', null, now())`, [A]))).toMatch(/permission denied/);
    expect(await fails(as(ME, `select public.attendance_days_for($1, '2026-10-19', '2026-10-25')`, [A]))).toMatch(/permission denied/);
    expect(await fails(as(ME, `select public.attendance_set_day('A-ME', '2026-10-19', '2026-10-19T05:00:00Z', null, 'me')`))).toMatch(/Only HR/);
    expect((await as<{ e: string }>(ME, `select distinct employee_number e from attendance_logs`)).map((r) => r.e)).toEqual(['A-ME']);
    expect(await fails(as(ME, `select * from public.attendance_days('2026-10-12', '2026-10-16', 'A-THEM')`))).toMatch(/your own attendance/);
    const mine = await as<{ e: string }>(ME, `select distinct employee_number e from public.attendance_days('2026-10-12', '2026-10-16')`);
    expect(mine.map((r) => r.e)).toEqual(['A-ME']);
  });
});

describe('managers and HR', () => {
  it('a manager sees their reports’ days and records (and their own), nobody else’s', async () => {
    const seen = await as<{ e: string }>(LEAD, `select distinct employee_number e from public.attendance_days('2026-10-12', '2026-10-16') order by 1`);
    expect(seen.map((r) => r.e)).toEqual(['A-LEAD', 'A-ME']);
    expect(await fails(as(LEAD, `select * from public.attendance_days('2026-10-12', '2026-10-16', 'A-THEM')`))).toMatch(/your own attendance/);
    expect((await as<{ e: string }>(LEAD, `select distinct employee_number e from attendance_logs`)).map((r) => r.e)).toEqual(['A-ME']);
    expect((await as<{ t: Record<string, unknown> }>(LEAD, `select public.attendance_my_access() as t`))[0].t)
      .toEqual({ sees_all: false, manages: false, schedules: false, employee_number: 'A-LEAD', team: ['A-ME'] });
  });

  it('HR sees everyone', async () => {
    const seen = await as<{ e: string }>(HR, `select distinct employee_number e from public.attendance_days('2026-10-12', '2026-10-16') order by 1`);
    expect(seen.map((r) => r.e)).toEqual(['A-DAR', 'A-GONE', 'A-HR', 'A-LEAD', 'A-ME', 'A-THEM']);
    expect((await as<{ t: Record<string, unknown> }>(HR, `select public.attendance_my_access() as t`))[0].t)
      .toMatchObject({ sees_all: true, manages: true, schedules: true });
  });

  it('HR corrects a day: a note is needed, clock-out after clock-in, on that day', async () => {
    const set = (inAt: string, outAt: string | null, note: string | null, date = '2026-10-15') =>
      as(HR, `select * from public.attendance_set_day('A-THEM', $1, $2, $3, $4)`, [date, inAt, outAt, note]);
    expect(await fails(set('2026-10-15T05:00:00Z', '2026-10-15T14:00:00Z', '  '))).toMatch(/Add a note/);
    expect(await fails(set('2026-10-15T05:00:00Z', '2026-10-15T04:00:00Z', 'Forgot'))).toMatch(/clock-out time must be after/);
    expect(await fails(set('2026-10-16T05:00:00Z', null, 'Forgot'))).toMatch(/must be on 15 Oct 2026/);
    const [r] = await set('2026-10-15T05:00:00Z', '2026-10-15T14:00:00Z', 'Forgot to clock in') as { source: string; note: string; edited_by: string }[];
    expect(r).toMatchObject({ source: 'hr', note: 'Forgot to clock in', edited_by: HR });
    // correcting it again changes the same record
    await set('2026-10-15T05:45:00Z', '2026-10-15T14:00:00Z', 'Arrived 08:45');
    const d = (await days('A-THEM', '2026-10-15', '2026-10-15'))[0];
    expect(d).toMatchObject({ status: 'late', late_minutes: 15, hours: '8.25' });
    expect((await rows<{ n: number }>(`select count(*)::int n from attendance_logs where employee_number = 'A-THEM' and work_date = '2026-10-15'`))[0].n).toBe(1);
  });

  it('HR removes a day', async () => {
    expect((await as<{ r: boolean }>(HR, `select public.attendance_remove_day('A-THEM', '2026-10-15') as r`))[0].r).toBe(true);
    expect((await days('A-THEM', '2026-10-15', '2026-10-15'))[0].status).toBe('absent');
    expect(await fails(as(LEAD, `select public.attendance_remove_day('A-ME', '2026-10-19')`))).toMatch(/Only HR/);
  });
});

describe('companies are kept apart', () => {
  it('another company sees none of these days or records and can’t correct them', async () => {
    const seen = await as<{ e: string }>(ADMIN_B, `select distinct employee_number e from public.attendance_days('2026-10-12', '2026-10-16')`);
    expect(seen.map((r) => r.e)).toEqual(['B-1']);
    expect(await as(ADMIN_B, `select 1 from attendance_logs where tenant_id = $1`, [A])).toEqual([]);
    expect(await fails(as(ADMIN_B, `select public.attendance_set_day('A-ME', '2026-10-15', '2026-10-15T05:00:00Z', null, 'x')`))).toMatch(/Unknown employee/);
    expect((await as<{ r: boolean }>(ADMIN_B, `select public.attendance_remove_day('A-ME', '2026-10-19') as r`))[0].r).toBe(false);
  });

  it('the system (no one signed in) skips the access check; anon can’t call it', async () => {
    expect(await days(null, '2026-10-19', '2026-10-19', B)).toEqual([expect.objectContaining({ employee_number: 'B-1', status: 'absent' })]);
    expect(await fails(asAnon(db, () => rows(`select * from public.attendance_days('2026-10-12', '2026-10-16')`)))).toMatch(/permission denied/);
    expect(await fails(asAnon(db, () => rows(`select public.attendance_clock_in()`)))).toMatch(/permission denied/);
  });
});

describe('the day attendance counts from', () => {
  const setFrom = (day: string) => db.query(`update attendance_settings set tracking_from = $1 where tenant_id = $2`, [day, A]);

  it('days before it don’t count (left empty, even with a clock-in: 20261023800000); clock-ins on them still show', async () => {
    await setFrom('2026-10-20');
    try {
      expect(await statuses('A-THEM')).toMatchObject({ '19': null, '20': 'leave' });
      expect((await statuses('A-ME'))['19']).toBeNull();
      expect((await days('A-ME', '2026-10-19', '2026-10-19'))[0]).toMatchObject({ late_minutes: null, clock_in: expect.any(String) });
      expect((await statuses('A-GONE'))['19']).toBeNull();
    } finally {
      await setFrom('2025-01-01');
    }
    expect((await statuses('A-THEM'))['19']).toBe('absent');
  });

  it('a company without the setting counts from the day it was created', async () => {
    const c = '00000000-0000-0000-0000-0000000000c3';
    await db.query(`insert into tenants (id, name, slug, created_at) values ($1, 'New Co', 'new-co', '2026-10-21T05:00:00Z')`, [c]);
    expect((await rows<{ d: string }>(`select public.attendance_tracking_from($1)::text as d`, [c]))[0].d).toBe('2026-10-21');
  });

  it('HR changes it; staff read it but can’t', async () => {
    expect(await as(ME, `select tracking_from::text from attendance_settings`)).toEqual([{ tracking_from: '2025-01-01' }]);
    await as(ME, `update attendance_settings set tracking_from = '2026-10-01'`);
    expect((await rows<{ d: string }>(`select tracking_from::text as d from attendance_settings where tenant_id = $1`, [A]))[0].d).toBe('2025-01-01');
    await as(HR, `update attendance_settings set tracking_from = '2025-02-01'`);
    const row = (await rows<{ d: string; by: string }>(`select tracking_from::text as d, updated_by as by from attendance_settings where tenant_id = $1`, [A]))[0];
    expect(row).toEqual({ d: '2025-02-01', by: HR });
    expect(await as(ADMIN_B, `select tracking_from::text from attendance_settings`)).toEqual([{ tracking_from: '2025-01-01' }]);
    await setFrom('2025-01-01');
  });
});

describe('the migration', () => {
  it('can run again without changing anything', async () => {
    const snapshot = async () => ({
      logs: await rows(`select id, employee_number, work_date::text, login_time::text, logout_time::text, source, note from attendance_logs order by id`),
      schedules: await rows(`select tenant_id, branch_id, work_days, start_time::text, grace_minutes from work_schedules order by tenant_id, branch_id nulls first`),
      tracking: await rows(`select tenant_id, tracking_from::text from attendance_settings order by tenant_id`),
    });
    const before = await snapshot();
    // 20261023800000 added a column to the days (the odd-hours flag): the older versions can only be created again
    // once it is gone, and running it again afterwards puts it back
    await db.exec(`drop function public.attendance_days_for(uuid, date, date, text, date); drop function public.attendance_days(date, date, text);`);
    // and 20261025300000 added columns to attendance_day_scans, which 20261023800000 creates
    await db.exec(`drop function public.attendance_day_scans(text, date);`);
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    await db.exec(readFileSync(TRACKING_MIGRATION, 'utf8'));
    await db.exec(readFileSync(ODD_HOURS_MIGRATION, 'utf8'));
    await db.exec('reset search_path');
    expect(await snapshot()).toEqual(before);
  });
});
