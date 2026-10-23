// @vitest-environment node
//
// Odd-hours clock-ins and every scan of a day (20261023800000): a day whose clock-in (from a scanner or the app) is at or
// after midnight and before the company's odd_hours_until (05:00 unless HR changes it; 00:00 = never) is flagged, and
// HR and admins are told once (an 'attendance_odd_hours' HR alert), never for days before attendance counts; HR's
// correction clears the flag; a scan after midnight starts the next day without touching the day before.
// attendance_day_scans lists each scan behind a day (and the app's or HR's own times) for HR, a manager's reports and
// staff themselves only. attendance_days_for / attendance_days carry the flag, and the KPI measures still read them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootDb, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000e301';
const ADMIN = '00000000-0000-0000-0000-00000000e302';
const ME = '00000000-0000-0000-0000-00000000e303';
const LEAD = '00000000-0000-0000-0000-00000000e304';
const ADMIN_B = '00000000-0000-0000-0000-00000000e305';
const SERIAL = 'ODD0000001';
const MIGRATION = join(__dirname, '..', 'migrations', '20261023800000_attendance_odd_hours.sql');

let db: PGlite;
let device: string;
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
const line = (pin: string, at: string) => `${pin}\t${at}\t0\t1\t0\t0\t0`;
const receive = async (lines: string[]) => {
  await db.exec('set role service_role');
  try {
    return (await rows<{ r: Record<string, number> }>(`select public.attendance_scanner_receive($1, '41.90.12.34', $2) as r`, [SERIAL, lines.join('\n')]))[0].r;
  } finally {
    await db.exec('reset role');
  }
};
/** the app clocks someone in or out at a Nairobi time ("2026-02-10 04:59") */
const app = (emp: string, kind: 'in' | 'out', nairobi: string) =>
  rows(`select public.attendance_punch($1, $2, $3, null, ($4 || ':00+03')::timestamptz)`, [A, emp, kind, nairobi]);
interface Day { login: string | null; logout: string | null; source: string; flag: string | null; flagged: boolean; notified: boolean }
const day = async (emp: string, workDate: string) =>
  (await rows<Day>(
    `select to_char(login_time at time zone 'Africa/Nairobi', 'HH24:MI') as login,
            to_char(logout_time at time zone 'Africa/Nairobi', 'HH24:MI') as logout, source, flag,
            flag_at is not null as flagged, flag_notified_at is not null as notified
     from attendance_logs where tenant_id = $1 and employee_number = $2 and work_date = $3 and source <> 'legacy'`, [A, emp, workDate]))[0];
const alerts = async (emp: string) =>
  (await rows<{ title: string; message: string; end_date: string }>(
    `select title, message, end_date::text from hr_notifications
     where tenant_id = $1 and employee_number = $2 and notification_type = 'attendance_odd_hours' order by id`, [A, emp]));
const setUntil = (t: string) => db.query(`update attendance_settings set odd_hours_until = $1 where tenant_id = $2`, [t, A]);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  for (const [id, email, role, tenant] of [
    [HR, 'hr@a.co', 'HR', A], [ADMIN, 'owner@a.co', 'ADMIN', A], [ME, 'me@a.co', 'STAFF', A], [LEAD, 'lead@a.co', 'STAFF', A],
    [ADMIN_B, 'admin@b.co', 'ADMIN', B],
  ]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${tenant}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into attendance_settings (tenant_id, tracking_from) values ('${A}', '2026-02-01'), ('${B}', '2026-01-01')
      on conflict (tenant_id) do update set tracking_from = excluded.tracking_from;
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Status", "Start Date", manager_email, tenant_id) values
      ('A-ME', 'Amina', 'Otieno', 'me@a.co', 'Active', '2025-01-06', 'lead@a.co', '${A}'),
      ('A-THEM', 'Tia', 'Mwangi', 'them@a.co', 'Active', '2025-01-06', null, '${A}'),
      ('A-LEAD', 'Lena', 'Kamau', 'lead@a.co', 'Active', '2025-01-06', null, '${A}'),
      ('B-1', 'Bo', 'Bee', 'bo@b.co', 'Active', '2025-01-06', null, '${B}');
    delete from holidays;
  `);
  device = (await as<{ id: string }>(HR, `insert into attendance_devices (name, serial_number) values ('Front Door', $1) returning id`, [SERIAL]))[0].id;
  await as(HR, `insert into attendance_scanner_users (scanner_user_id, employee_number) values ('1', 'A-ME'), ('2', 'A-THEM')`);
}, 120000);

describe('the setting', () => {
  it('defaults to 5:00 am; HR changes it within 00:00 to 12:00; staff can’t', async () => {
    expect(await as(ME, `select odd_hours_until::text as t from attendance_settings`)).toEqual([{ t: '05:00:00' }]);
    await as(ME, `update attendance_settings set odd_hours_until = '03:00'`);
    expect(await as(HR, `select odd_hours_until::text as t from attendance_settings`)).toEqual([{ t: '05:00:00' }]);
    expect(await fails(as(HR, `update attendance_settings set odd_hours_until = '12:30'`))).toMatch(/attendance_settings_odd_hours_check/);
    await as(HR, `update attendance_settings set odd_hours_until = '04:00'`);
    expect(await as(HR, `select odd_hours_until::text as t from attendance_settings`)).toEqual([{ t: '04:00:00' }]);
    await setUntil('05:00');
  });

  it('a company without a settings row saves it on its own (it keeps counting from the day it was set up)', async () => {
    await db.query(`delete from attendance_settings where tenant_id = $1`, [B]);
    await db.query(`update tenants set created_at = '2026-01-15T05:00:00Z' where id = $1`, [B]);
    await as(ADMIN_B, `insert into attendance_settings (odd_hours_until) values ('02:00')
                       on conflict (tenant_id) do update set odd_hours_until = excluded.odd_hours_until`);
    expect(await as(ADMIN_B, `select tracking_from::text as f, odd_hours_until::text as t from attendance_settings`))
      .toEqual([{ f: '2026-01-15', t: '02:00:00' }]);
  });
});

describe('flagging and telling HR', () => {
  it('a scanner punch at 12:01 am is flagged and tells HR and admins once; a later scan doesn’t tell them again', async () => {
    // the day before: in at 8:00, out at 5:00 pm; then a scan just after midnight
    await receive([line('1', '2026-02-02 08:00:00'), line('1', '2026-02-02 17:00:00'), line('1', '2026-02-03 00:01:00')]);
    expect(await day('A-ME', '2026-02-03')).toEqual({
      login: '00:01', logout: null, source: 'scanner', flag: 'Clocked in at 12:01 am, before 5:00 am', flagged: true, notified: true,
    });
    expect(await alerts('A-ME')).toEqual([{
      title: 'Odd-hours clock-in',
      message: 'Odd-hours clock-in: Amina Otieno (A-ME) clocked in at 12:01 am on Tue 3 Feb.',
      end_date: '2026-02-03',
    }]);
    await receive([line('1', '2026-02-03 08:05:00')]);
    expect(await day('A-ME', '2026-02-03')).toMatchObject({ login: '00:01', logout: '08:05', flag: 'Clocked in at 12:01 am, before 5:00 am' });
    expect(await alerts('A-ME')).toHaveLength(1);
  });

  it('the scan after midnight starts the next day: the day before keeps its clock-out', async () => {
    expect(await day('A-ME', '2026-02-02')).toEqual({ login: '08:00', logout: '17:00', source: 'scanner', flag: null, flagged: false, notified: false });
  });

  it('the alert is for HR: emailed to admins and HR, never shown to the employee', async () => {
    expect((await rows<{ b: boolean }>(`select public.hr_only_notification('attendance_odd_hours') as b`))[0].b).toBe(true);
    const to = (await rows<{ user_id: string }>(`select user_id from public.hr_alert_recipients($1, 'attendance_odd_hours')`, [A]))
      .map((r) => r.user_id).sort();
    expect(to).toEqual([HR, ADMIN].sort());
    // in the HR bell: HR and admins read it, staff don't
    expect(await as(HR, `select 1 from hr_notifications where notification_type = 'attendance_odd_hours'`)).toHaveLength(1);
    expect(await as(ADMIN, `select 1 from hr_notifications where notification_type = 'attendance_odd_hours'`)).toHaveLength(1);
    expect(await as(LEAD, `select 1 from hr_notifications where notification_type = 'attendance_odd_hours'`)).toEqual([]);
  });

  it('an app clock-in at 4:59 am is flagged; one at 5:00 am is not', async () => {
    await app('A-THEM', 'in', '2026-02-04 04:59');
    expect(await day('A-THEM', '2026-02-04')).toMatchObject({ source: 'app', flag: 'Clocked in at 4:59 am, before 5:00 am', notified: true });
    await app('A-THEM', 'in', '2026-02-05 05:00');
    expect(await day('A-THEM', '2026-02-05')).toMatchObject({ source: 'app', flag: null, notified: false });
    // clocking out leaves the flag as it is
    await app('A-THEM', 'out', '2026-02-04 09:00');
    expect(await day('A-THEM', '2026-02-04')).toMatchObject({ logout: '09:00', flag: 'Clocked in at 4:59 am, before 5:00 am' });
    expect((await alerts('A-THEM')).map((a) => a.message)).toEqual(['Odd-hours clock-in: Tia Mwangi (A-THEM) clocked in at 4:59 am on Wed 4 Feb.']);
  });

  it('a setting of 00:00 means never', async () => {
    await setUntil('00:00');
    try {
      await app('A-THEM', 'in', '2026-02-06 00:30');
      expect(await day('A-THEM', '2026-02-06')).toMatchObject({ flag: null, notified: false });
      expect(await alerts('A-THEM')).toHaveLength(1);
    } finally {
      await setUntil('05:00');
    }
  });

  it('an earlier punch that moves the clock-in into the window flags the day', async () => {
    await receive([line('2', '2026-02-09 08:00:00')]);
    expect(await day('A-THEM', '2026-02-09')).toMatchObject({ login: '08:00', flag: null });
    await receive([line('2', '2026-02-09 03:15:00')]);
    expect(await day('A-THEM', '2026-02-09')).toMatchObject({ login: '03:15', logout: '08:00', flag: 'Clocked in at 3:15 am, before 5:00 am', notified: true });
    expect(await alerts('A-THEM')).toHaveLength(2);
  });

  it('HR correcting a day clears the flag (and doesn’t tell anyone again)', async () => {
    await as(HR, `select public.attendance_set_day('A-THEM', '2026-02-09', '2026-02-09T05:00:00Z', '2026-02-09T14:00:00Z', 'Night shift, agreed')`);
    expect(await day('A-THEM', '2026-02-09')).toMatchObject({ source: 'hr', flag: null, flagged: false });
    // even an HR time in the window isn't flagged: HR set it on purpose
    await as(HR, `select public.attendance_set_day('A-THEM', '2026-02-10', '2026-02-09T22:30:00Z', null, 'Stocktake')`);
    expect(await day('A-THEM', '2026-02-10')).toMatchObject({ login: '01:30', source: 'hr', flag: null });
    expect(await alerts('A-THEM')).toHaveLength(2);
  });

  it('before attendance counts: flagged, but nobody is told', async () => {
    await app('A-LEAD', 'in', '2026-01-20 01:00');
    expect(await day('A-LEAD', '2026-01-20')).toMatchObject({ flag: 'Clocked in at 1:00 am, before 5:00 am', notified: false });
    expect(await alerts('A-LEAD')).toEqual([]);
  });

  it('the days carry the flag', async () => {
    const got = await as<{ day: string; flag: string | null }>(HR,
      `select day::text, flag from public.attendance_days('2026-02-02', '2026-02-03', 'A-ME')`);
    expect(got).toEqual([{ day: '2026-02-02', flag: null }, { day: '2026-02-03', flag: 'Clocked in at 12:01 am, before 5:00 am' }]);
  });
});

describe('every scan of a day', () => {
  interface Scan { at: string; via: string; scanner_name: string | null; kind: string; reason: string | null }
  const scans = (user: string, emp: string, d: string) =>
    as<Scan>(user, `select to_char(punched_at at time zone 'Africa/Nairobi', 'HH24:MI') as at, via, scanner_name, kind, reason
                    from public.attendance_day_scans($1, $2)`, [emp, d]);

  it('lists each scan in order, which was the clock-in and clock-out, and the ones held back', async () => {
    await receive([line('1', '2026-02-11 07:55:00'), line('1', '2026-02-11 12:30:00'), line('1', '2026-02-11 17:04:00')]);
    // one held back because the scanner's clock was ahead
    await db.query(`insert into attendance_scanner_punches (tenant_id, device_id, scanner_user_id, punched_at, employee_number, skipped_reason)
                    values ($1, $2, '1', '2026-02-11 21:00:00+03', 'A-ME', 'clock_ahead')`, [A, device]);
    expect(await scans(HR, 'A-ME', '2026-02-11')).toEqual([
      { at: '07:55', via: 'scanner', scanner_name: 'Front Door', kind: 'clock_in', reason: null },
      { at: '12:30', via: 'scanner', scanner_name: 'Front Door', kind: 'between', reason: null },
      { at: '17:04', via: 'scanner', scanner_name: 'Front Door', kind: 'clock_out', reason: null },
      { at: '21:00', via: 'scanner', scanner_name: 'Front Door', kind: 'held', reason: 'clock_ahead' },
    ]);
  });

  it('shows the app’s clock-in alongside the scanner, and a punch skipped because HR corrected the day', async () => {
    await app('A-ME', 'in', '2026-02-12 08:02');
    await receive([line('1', '2026-02-12 17:10:00')]);
    expect(await scans(ME, 'A-ME', '2026-02-12')).toEqual([
      { at: '08:02', via: 'app', scanner_name: null, kind: 'clock_in', reason: null },
      { at: '17:10', via: 'scanner', scanner_name: 'Front Door', kind: 'clock_out', reason: null },
    ]);
    // HR fixed the clock-out: a later scan is held back (20261025100000: a clock-out left empty takes the scan instead)
    await as(HR, `select public.attendance_set_day('A-ME', '2026-02-13', '2026-02-13T05:00:00Z', '2026-02-13T14:00:00Z', 'Forgot')`);
    await receive([line('1', '2026-02-13 18:00:00')]);
    expect(await scans(HR, 'A-ME', '2026-02-13')).toEqual([
      { at: '08:00', via: 'hr', scanner_name: null, kind: 'clock_in', reason: null },
      { at: '17:00', via: 'hr', scanner_name: null, kind: 'clock_out', reason: null },
      { at: '18:00', via: 'scanner', scanner_name: 'Front Door', kind: 'held', reason: 'hr_corrected' },
    ]);
  });

  it('HR sees anyone, a manager their reports, staff themselves only, another company nothing', async () => {
    expect(await scans(HR, 'A-ME', '2026-02-11')).toHaveLength(4);
    expect(await scans(LEAD, 'A-ME', '2026-02-11')).toHaveLength(4);
    expect(await scans(ME, 'A-ME', '2026-02-11')).toHaveLength(4);
    expect(await fails(scans(ME, 'A-THEM', '2026-02-09'))).toMatch(/your own attendance/);
    expect(await fails(scans(LEAD, 'A-THEM', '2026-02-09'))).toMatch(/your own attendance/);
    expect(await scans(ADMIN_B, 'A-ME', '2026-02-11')).toEqual([]);
    expect(await fails(asAnon(db, () => rows(`select * from public.attendance_day_scans('A-ME', '2026-02-11')`)))).toMatch(/permission denied/);
  });
});

describe('days before attendance counts', () => {
  it('a scanner clock-in at 1:00 pm before tracking_from has no status, keeps its clock-in, and the KPIs ignore it', async () => {
    // Tue 17 Feb: the scanner went live at midday (late by hours); Wed 18 Feb on time. Then HR counts from the 18th.
    await receive([line('1', '2026-02-17 13:00:00'), line('1', '2026-02-17 17:00:00'), line('1', '2026-02-18 07:58:00')]);
    await db.query(`update attendance_settings set tracking_from = '2026-02-18' where tenant_id = $1`, [A]);
    try {
      const got = await as<{ day: string; status: string | null; late_minutes: number | null; clock_in: boolean; hours: string | null; source: string; counted: boolean }>(HR,
        `select day::text, status, late_minutes, clock_in is not null as clock_in, hours::text, source, counted
         from public.attendance_days('2026-02-16', '2026-02-18', 'A-ME')`);
      expect(got).toEqual([
        { day: '2026-02-16', status: null, late_minutes: null, clock_in: false, hours: null, source: null, counted: false },
        { day: '2026-02-17', status: null, late_minutes: null, clock_in: true, hours: '4.00', source: 'scanner', counted: false },
        { day: '2026-02-18', status: 'present', late_minutes: 0, clock_in: true, hours: null, source: 'scanner', counted: true },
      ]);
      const measure = async (m: string) => (await rows<{ value: string | null; detail: Record<string, number> }>(
        `select value::text, detail from public.kpi_attendance_measure($1, 'A-ME', $2, '2026-02-16', '2026-02-18', '2026-02-19')`, [A, m]))[0];
      expect(await measure('attendance_rate')).toEqual({ value: '100.0', detail: { present: 1, expected: 1 } });
      expect(await measure('punctuality')).toEqual({ value: '100.0', detail: { on_time: 1, present: 1 } });
    } finally {
      await db.query(`update attendance_settings set tracking_from = '2026-02-01' where tenant_id = $1`, [A]);
    }
  });

  it('an odd-hours day before tracking_from isn’t flagged in the days', async () => {
    expect(await as(HR, `select flag, counted from public.attendance_days('2026-01-20', '2026-01-20', 'A-LEAD')`))
      .toEqual([{ flag: null, counted: false }]);
  });
});

describe('the KPI attendance measures', () => {
  it('still read the days', async () => {
    const got = await rows<{ value: string | null; detail: Record<string, number> }>(
      `select value::text, detail from public.kpi_attendance_measure($1, 'A-ME', 'attendance_rate', '2026-02-09', '2026-02-13', '2026-02-14')`, [A]);
    // Mon 9 and Tue 10 absent; Wed 11, Thu 12, Fri 13 present
    expect(got).toEqual([{ value: '60.0', detail: { present: 3, expected: 5 } }]);
    const hours = await rows<{ value: string | null }>(
      `select value::text from public.kpi_attendance_measure($1, 'A-ME', 'avg_hours', '2026-02-11', '2026-02-12', '2026-02-14')`, [A]);
    expect(hours).toEqual([{ value: '9.1' }]);
  });
});

describe('the migration', () => {
  it('runs again safely: flags, alerts and the setting stay as they are', async () => {
    const snapshot = async () => ({
      logs: await rows(`select id, flag, flag_at::text, flag_notified_at::text from attendance_logs order by id`),
      alerts: await rows(`select id from hr_notifications where notification_type = 'attendance_odd_hours' order by id`),
      settings: await rows(`select tenant_id, tracking_from::text, odd_hours_until::text from attendance_settings order by tenant_id`),
    });
    const before = await snapshot();
    // 20261025300000 added columns to attendance_day_scans (verify, status, mode): this version can only be created
    // again once it is gone
    await db.exec(`drop function public.attendance_day_scans(text, date);`);
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    await db.exec('reset search_path');
    expect(await snapshot()).toEqual(before);
    // and still works
    await receive([line('2', '2026-02-16 02:00:00')]);
    expect(await day('A-THEM', '2026-02-16')).toMatchObject({ flag: 'Clocked in at 2:00 am, before 5:00 am', notified: true });
  });
});

describe('days recorded before the migration', () => {
  it('are flagged once, without telling anyone', async () => {
    const old = await bootDb({
      file: '20261023800000_attendance_odd_hours.sql',
      seed: async (d) => {
        await d.exec(`
          insert into employees ("Employee Number", "First Name", "Status", "Start Date", tenant_id)
            values ('A-OLD', 'Ola', 'Active', '2025-01-06', '${A}');
          insert into attendance_logs (tenant_id, employee_number, work_date, login_time, status, source) values
            ('${A}', 'A-OLD', '2026-02-02', '2026-02-02 02:10:00+03', 'clocked_in', 'scanner'),
            ('${A}', 'A-OLD', '2026-02-03', '2026-02-03 07:50:00+03', 'clocked_in', 'app'),
            ('${A}', 'A-OLD', '2026-02-04', '2026-02-04 01:00:00+03', 'clocked_in', 'hr');
        `);
      },
    });
    expect((await old.query(`select work_date::text as d, flag, flag_notified_at is not null as notified from attendance_logs
                             where employee_number = 'A-OLD' order by work_date`)).rows).toEqual([
      { d: '2026-02-02', flag: 'Clocked in at 2:10 am, before 5:00 am', notified: true },
      { d: '2026-02-03', flag: null, notified: false },
      { d: '2026-02-04', flag: null, notified: false },
    ]);
    expect((await old.query(`select 1 from hr_notifications where notification_type = 'attendance_odd_hours'`)).rows).toEqual([]);
    await old.close();
  }, 120000);
});
