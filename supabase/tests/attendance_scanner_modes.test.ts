// @vitest-environment node
//
// Scanner modes (20261025300000, FIG-1206): each scanner says how its punches count. 'first_last' (the default, one
// shared door: first scan in, last scan out), 'in_only' (an entrance: only the clock-in, the earliest), 'out_only' (an
// exit: only the clock-out, the latest, after the clock-in; with no clock-in it waits as 'no_clock_in') and
// 'device_keys' (status 0 in, 1 out, 2-5 break/overtime kept but not counted, anything else first_last). Each punch
// keeps the mode it arrived under, so changing a scanner's mode never counts the past again. attendance_day_scans
// shows how each punch was verified and the key pressed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const HR = '00000000-0000-0000-0000-00000000f501';
const STAFF = '00000000-0000-0000-0000-00000000f502';
const DOOR = 'MODEDOOR01';
const ENTRANCE = 'MODEIN0001';
const EXIT = 'MODEOUT001';
const KEYS = 'MODEKEYS01';
const MIGRATION = join(__dirname, '..', 'migrations', '20261025300000_attendance_scanner_modes.sql');

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
const as = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) =>
  asUser(db, user, () => rows<T>(sql, params));
/** one ATTLOG line: PIN, Nairobi time, status (the key), verify */
const line = (pin: string, d: string, hhmm: string, status: number | null = 1, verify = 1) =>
  status === null ? `${pin}\t${d} ${hhmm}:00` : `${pin}\t${d} ${hhmm}:00\t${status}\t${verify}\t0\t0\t0`;
const receive = async (serial: string, lines: string[]) => {
  await db.exec('set role service_role');
  try {
    return (await rows<{ r: Record<string, number> }>(`select public.attendance_scanner_receive($1, '41.90.12.34', $2) as r`,
      [serial, lines.join('\n')]))[0].r;
  } finally {
    await db.exec('reset role');
  }
};
const at = (d: string, hhmm: string) => `${d}T${hhmm}:00+03:00`;
interface Day { login: string | null; logout: string | null; source: string; status: string; flag: string | null }
const day = async (emp: string, d: string) =>
  (await rows<Day>(
    `select to_char(login_time at time zone 'Africa/Nairobi', 'HH24:MI') as login,
            to_char(logout_time at time zone 'Africa/Nairobi', 'HH24:MI') as logout, source, status, flag
     from attendance_logs where tenant_id = $1 and employee_number = $2 and work_date = $3 and source <> 'legacy'`, [A, emp, d]))[0];
const records = async (emp: string, d: string) =>
  (await rows<{ n: number }>(`select count(*)::int as n from attendance_logs where tenant_id = $1 and employee_number = $2 and work_date = $3`,
    [A, emp, d]))[0].n;
const punches = (emp: string, d: string) =>
  rows<{ at: string; applied: boolean; skipped: string | null; mode: string | null }>(
    `select to_char(punched_at at time zone 'Africa/Nairobi', 'HH24:MI') as at, applied_at is not null as applied,
            skipped_reason as skipped, punch_mode as mode
     from attendance_scanner_punches
     where tenant_id = $1 and employee_number = $2 and (punched_at at time zone 'Africa/Nairobi')::date = $3
     order by punched_at, punch_mode`, [A, emp, d]);
const setMode = (serial: string, mode: string) => as(HR, `update attendance_devices set punch_mode = $1 where serial_number = $2`, [mode, serial]);
const correct = (emp: string, d: string, inAt: string, outAt: string | null) =>
  as(HR, `select 1 from public.attendance_set_day($1, $2, $3, $4, 'Checked with the supervisor')`,
    [emp, d, at(d, inAt), outAt && at(d, outAt)]);

beforeAll(async () => {
  db = await bootLiveDb();
  for (const [id, email, role] of [[HR, 'hr@a.co', 'HR'], [STAFF, 'staff@a.co', 'STAFF']]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${A}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into attendance_settings (tenant_id, tracking_from) values ('${A}', '2026-03-01')
      on conflict (tenant_id) do update set tracking_from = excluded.tracking_from;
    insert into employees ("Employee Number", "First Name", "Work Email", "Status", "Start Date", tenant_id) values
      ('M-1', 'Amina', 'm1@a.co', 'Active', '2025-01-06', '${A}'),
      ('M-2', 'Baraka', 'm2@a.co', 'Active', '2025-01-06', '${A}'),
      ('M-3', 'Chebet', 'm3@a.co', 'Active', '2025-01-06', '${A}'),
      ('M-4', 'Daudi', 'm4@a.co', 'Active', '2025-01-06', '${A}');
  `);
  await as(HR, `insert into attendance_devices (name, serial_number) values ('Front Door', $1)`, [DOOR]);
  await as(HR, `insert into attendance_devices (name, serial_number, punch_mode) values
    ('Entrance', $1, 'in_only'), ('Exit', $2, 'out_only'), ('Gate', $3, 'device_keys')`, [ENTRANCE, EXIT, KEYS]);
  await as(HR, `insert into attendance_scanner_users (scanner_user_id, employee_number) values
    ('1', 'M-1'), ('2', 'M-2'), ('3', 'M-3'), ('4', 'M-4')`);
}, 120000);

describe('the setting', () => {
  it('defaults to first scan in, last scan out; HR sets it; only the four modes', async () => {
    expect(await as(HR, `select serial_number as s, punch_mode as m from attendance_devices order by serial_number`)).toEqual([
      { s: DOOR, m: 'first_last' }, { s: ENTRANCE, m: 'in_only' }, { s: KEYS, m: 'device_keys' }, { s: EXIT, m: 'out_only' },
    ]);
    expect(await fails(setMode(DOOR, 'sometimes'))).toMatch(/punch_mode_check/);
  });

  it('only HR can set it', async () => {
    // staff can't see or change scanners (row security: nothing to update)
    await as(STAFF, `update attendance_devices set punch_mode = 'in_only' where serial_number = $1`, [DOOR]);
    expect(await fails(as(STAFF, `insert into attendance_devices (name, serial_number, punch_mode) values ('Mine', 'MODESTAFF1', 'in_only')`)))
      .toMatch(/row-level security|permission denied/);
    expect(await rows(`select punch_mode as m from attendance_devices where serial_number = $1`, [DOOR])).toEqual([{ m: 'first_last' }]);
    // nobody writes a punch's mode
    expect(await fails(as(HR, `update attendance_scanner_punches set punch_mode = 'in_only'`))).toMatch(/permission denied/);
  });
});

describe('first_last (one shared door)', () => {
  it('works exactly as before: first scan in, last scan out', async () => {
    await receive(DOOR, [line('1', '2026-03-02', '07:55'), line('1', '2026-03-02', '12:30'), line('1', '2026-03-02', '17:04')]);
    expect(await day('M-1', '2026-03-02')).toMatchObject({ login: '07:55', logout: '17:04', source: 'scanner', status: 'clocked_out' });
    expect((await punches('M-1', '2026-03-02')).map((p) => p.mode)).toEqual(['first_last', 'first_last', 'first_last']);
  });
});

describe('in_only (an entrance)', () => {
  it('creates the day with the clock-in, moves it to the earliest, never sets the clock-out', async () => {
    await receive(ENTRANCE, [line('1', '2026-03-03', '08:10')]);
    expect(await day('M-1', '2026-03-03')).toMatchObject({ login: '08:10', logout: null, status: 'clocked_in' });
    await receive(ENTRANCE, [line('1', '2026-03-03', '13:05')]);
    expect(await day('M-1', '2026-03-03')).toMatchObject({ login: '08:10', logout: null });
    await receive(ENTRANCE, [line('1', '2026-03-03', '07:50')]);
    expect(await day('M-1', '2026-03-03')).toMatchObject({ login: '07:50', logout: null, status: 'clocked_in' });
    expect((await punches('M-1', '2026-03-03')).every((p) => p.applied && p.skipped === null)).toBe(true);
  });

  it('flags an odd-hours clock-in like any other', async () => {
    await receive(ENTRANCE, [line('1', '2026-03-04', '02:15')]);
    expect((await day('M-1', '2026-03-04')).flag).toBe('Clocked in at 2:15 am, before 5:00 am');
  });
});

describe('out_only (an exit)', () => {
  it('before any clock-in: waits, never becomes the clock-in, then counts when a clock-in before it arrives', async () => {
    await receive(EXIT, [line('2', '2026-03-03', '17:00')]);
    expect(await records('M-2', '2026-03-03')).toBe(0);
    expect(await punches('M-2', '2026-03-03')).toEqual([{ at: '17:00', applied: false, skipped: 'no_clock_in', mode: 'out_only' }]);
    // the entrance punch arrives later (e.g. the scanner uploads late): the waiting exit punch becomes the clock-out
    await receive(ENTRANCE, [line('2', '2026-03-03', '08:00')]);
    expect(await day('M-2', '2026-03-03')).toMatchObject({ login: '08:00', logout: '17:00', status: 'clocked_out' });
    expect(await punches('M-2', '2026-03-03')).toEqual([
      { at: '08:00', applied: true, skipped: null, mode: 'in_only' },
      { at: '17:00', applied: true, skipped: null, mode: 'out_only' },
    ]);
  });

  it('an exit punch before the clock-in waits; only a later one moves the clock-out, to the latest', async () => {
    await receive(ENTRANCE, [line('2', '2026-03-04', '09:00')]);
    await receive(EXIT, [line('2', '2026-03-04', '07:30')]);
    expect(await day('M-2', '2026-03-04')).toMatchObject({ login: '09:00', logout: null });
    await receive(EXIT, [line('2', '2026-03-04', '17:30')]);
    await receive(EXIT, [line('2', '2026-03-04', '16:00')]);
    expect(await day('M-2', '2026-03-04')).toMatchObject({ login: '09:00', logout: '17:30' });
    expect((await punches('M-2', '2026-03-04')).find((p) => p.at === '07:30')).toMatchObject({ skipped: 'no_clock_in' });
    // an entrance punch before it frees it (it is not after the latest clock-out, so the clock-out stays)
    await receive(ENTRANCE, [line('2', '2026-03-04', '07:00')]);
    expect(await day('M-2', '2026-03-04')).toMatchObject({ login: '07:00', logout: '17:30' });
    expect((await punches('M-2', '2026-03-04')).find((p) => p.at === '07:30')).toMatchObject({ applied: true, skipped: null });
  });
});

describe('two devices, one person', () => {
  it('an entrance and an exit make one day record', async () => {
    await receive(ENTRANCE, [line('3', '2026-03-05', '08:00')]);
    await receive(EXIT, [line('3', '2026-03-05', '12:00')]);
    await receive(ENTRANCE, [line('3', '2026-03-05', '13:00')]);
    await receive(EXIT, [line('3', '2026-03-05', '17:30')]);
    expect(await records('M-3', '2026-03-05')).toBe(1);
    expect(await day('M-3', '2026-03-05')).toMatchObject({ login: '08:00', logout: '17:30', status: 'clocked_out', source: 'scanner' });
  });

  it('with a shared door too, an entrance punch never becomes the clock-out', async () => {
    await receive(DOOR, [line('3', '2026-03-06', '08:00')]);
    await receive(ENTRANCE, [line('3', '2026-03-06', '13:00')]);
    expect(await day('M-3', '2026-03-06')).toMatchObject({ login: '08:00', logout: null });
    await receive(DOOR, [line('3', '2026-03-06', '10:00')]);
    expect(await day('M-3', '2026-03-06')).toMatchObject({ login: '08:00', logout: '10:00' });
    await receive(DOOR, [line('3', '2026-03-06', '17:00')]);
    expect(await day('M-3', '2026-03-06')).toMatchObject({ login: '08:00', logout: '17:00' });
  });
});

describe('device_keys (the scanner’s In/Out keys)', () => {
  it('0 is the clock-in, 1 the clock-out; break and overtime are kept but not counted', async () => {
    await receive(KEYS, [line('4', '2026-03-09', '17:00', 1)]);
    expect(await records('M-4', '2026-03-09')).toBe(0);
    await receive(KEYS, [
      line('4', '2026-03-09', '08:05', 0), line('4', '2026-03-09', '12:00', 2), line('4', '2026-03-09', '13:00', 3),
      line('4', '2026-03-09', '18:00', 4), line('4', '2026-03-09', '20:00', 5),
    ]);
    expect(await day('M-4', '2026-03-09')).toMatchObject({ login: '08:05', logout: '17:00', status: 'clocked_out' });
    expect((await punches('M-4', '2026-03-09')).map((p) => [p.at, p.applied, p.skipped])).toEqual([
      ['08:05', true, null], ['12:00', false, 'break'], ['13:00', false, 'break'], ['17:00', true, null],
      ['18:00', false, 'overtime'], ['20:00', false, 'overtime'],
    ]);
  });

  it('an unknown or missing status counts as first scan in, last scan out', async () => {
    await receive(KEYS, [line('4', '2026-03-10', '08:00', 9), line('4', '2026-03-10', '17:00', null)]);
    expect(await day('M-4', '2026-03-10')).toMatchObject({ login: '08:00', logout: '17:00' });
  });

  it('a status-1 punch as the first of the day waits instead of clocking in', async () => {
    await receive(KEYS, [line('4', '2026-03-11', '08:00', 1)]);
    expect(await records('M-4', '2026-03-11')).toBe(0);
  });
});

describe('days HR corrected', () => {
  it('keep what HR fixed: an earlier entrance punch and a later exit punch are held as HR’s', async () => {
    await correct('M-1', '2026-03-12', '08:30', '17:00');
    await receive(ENTRANCE, [line('1', '2026-03-12', '08:00')]);
    await receive(EXIT, [line('1', '2026-03-12', '18:00')]);
    expect(await day('M-1', '2026-03-12')).toMatchObject({ login: '08:30', logout: '17:00', source: 'hr' });
    expect((await punches('M-1', '2026-03-12')).map((p) => p.skipped)).toEqual(['hr_corrected', 'hr_corrected']);
  });

  it('an open clock-out still takes the exit punches; an exit punch waiting for a clock-in counts once HR sets one', async () => {
    await receive(EXIT, [line('2', '2026-03-12', '16:45')]);
    expect(await punches('M-2', '2026-03-12')).toEqual([{ at: '16:45', applied: false, skipped: 'no_clock_in', mode: 'out_only' }]);
    await correct('M-2', '2026-03-12', '08:00', null);
    expect(await day('M-2', '2026-03-12')).toMatchObject({ login: '08:00', logout: '16:45', source: 'hr' });
    await receive(EXIT, [line('2', '2026-03-12', '17:20')]);
    await receive(ENTRANCE, [line('2', '2026-03-12', '07:40')]);
    expect(await day('M-2', '2026-03-12')).toMatchObject({ login: '08:00', logout: '17:20' });
    expect((await punches('M-2', '2026-03-12')).find((p) => p.at === '07:40')).toMatchObject({ skipped: 'hr_corrected' });
  });

  it('a fixed clock-out holds a waiting exit punch as HR’s', async () => {
    await receive(EXIT, [line('3', '2026-03-12', '17:10')]);
    await correct('M-3', '2026-03-12', '08:00', '17:00');
    expect(await day('M-3', '2026-03-12')).toMatchObject({ login: '08:00', logout: '17:00' });
    expect((await punches('M-3', '2026-03-12'))[0]).toMatchObject({ applied: false, skipped: 'hr_corrected' });
  });
});

describe('changing a scanner’s mode', () => {
  it('applies to punches from then on; nothing already received is counted again', async () => {
    await receive(DOOR, [line('3', '2026-03-13', '08:00'), line('3', '2026-03-13', '17:00')]);
    const before = await day('M-3', '2026-03-13');
    await setMode(DOOR, 'in_only');
    expect(await day('M-3', '2026-03-13')).toEqual(before);
    expect((await punches('M-3', '2026-03-13')).map((p) => p.mode)).toEqual(['first_last', 'first_last']);
    // a punch arriving now is an entrance punch: a later one is no clock-out
    await receive(DOOR, [line('3', '2026-03-13', '18:00')]);
    expect(await day('M-3', '2026-03-13')).toMatchObject({ login: '08:00', logout: '17:00' });
    await receive(DOOR, [line('3', '2026-03-16', '08:00'), line('3', '2026-03-16', '17:00')]);
    expect(await day('M-3', '2026-03-16')).toMatchObject({ login: '08:00', logout: null });
    await setMode(DOOR, 'first_last');
  });
});

describe('scanner user 0 and the clock guard', () => {
  it('are untouched: user 0 is never applied, a punch stamped ahead is held', async () => {
    await receive(ENTRANCE, [line('0', '2026-03-17', '08:00')]);
    expect(await rows(`select applied_at is not null as applied from attendance_scanner_punches where scanner_user_id = '0'`))
      .toEqual([{ applied: false }]);
    const ahead = new Date(Date.now() + 5 * 3600 * 1000).toLocaleString('sv-SE', { timeZone: 'Africa/Nairobi' }).slice(0, 16);
    await receive(EXIT, [line('1', ahead.slice(0, 10), ahead.slice(11, 16))]);
    expect(await rows(`select skipped_reason as s from attendance_scanner_punches where device_id =
      (select id from attendance_devices where serial_number = $1) and scanner_user_id = '1' and punched_at > now()`, [EXIT]))
      .toEqual([{ s: 'clock_ahead' }]);
  });
});

describe('every scan of a day', () => {
  it('says how each punch was verified, the key pressed and the scanner’s mode', async () => {
    await receive(KEYS, [line('1', '2026-03-18', '08:03', 0, 4), line('1', '2026-03-18', '12:00', 2, 15), line('1', '2026-03-18', '17:00', 1, 1)]);
    expect(await as(HR, `select to_char(punched_at at time zone 'Africa/Nairobi', 'HH24:MI') as at, scanner_name, kind, reason,
                                verify, status, punch_mode from public.attendance_day_scans('M-1', '2026-03-18')`)).toEqual([
      { at: '08:03', scanner_name: 'Gate', kind: 'clock_in', reason: null, verify: 4, status: 0, punch_mode: 'device_keys' },
      { at: '12:00', scanner_name: 'Gate', kind: 'held', reason: 'break', verify: 15, status: 2, punch_mode: 'device_keys' },
      { at: '17:00', scanner_name: 'Gate', kind: 'clock_out', reason: null, verify: 1, status: 1, punch_mode: 'device_keys' },
    ]);
    // the app's or HR's own times have none
    await correct('M-4', '2026-03-18', '08:00', '17:00');
    expect(await as(HR, `select via, verify, status, punch_mode from public.attendance_day_scans('M-4', '2026-03-18')`)).toEqual([
      { via: 'hr', verify: null, status: null, punch_mode: null }, { via: 'hr', verify: null, status: null, punch_mode: null },
    ]);
  });
});

describe('the migration', () => {
  it('runs again safely: modes, punches and days stay as they are, and it still works', async () => {
    const snapshot = async () => ({
      devices: await rows(`select serial_number, punch_mode from attendance_devices order by serial_number`),
      punches: await rows(`select id, punch_mode, applied_at::text, skipped_reason from attendance_scanner_punches order by id`),
      logs: await rows(`select id, login_time::text, logout_time::text, source, flag from attendance_logs order by id`),
    });
    const before = await snapshot();
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    await db.exec('reset search_path');
    expect(await snapshot()).toEqual(before);
    await receive(ENTRANCE, [line('2', '2026-03-19', '08:00')]);
    await receive(EXIT, [line('2', '2026-03-19', '17:00')]);
    expect(await day('M-2', '2026-03-19')).toMatchObject({ login: '08:00', logout: '17:00' });
    // staff still can't set a mode after it ran again
    await as(STAFF, `update attendance_devices set punch_mode = 'out_only'`);
    expect(await rows(`select count(*)::int as n from attendance_devices where punch_mode = 'out_only'`)).toEqual([{ n: 1 }]);
  });
});
