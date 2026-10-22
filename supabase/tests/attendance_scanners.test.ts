// @vitest-environment node
//
// Door scanners (20261023600000): HR registers a company's scanners (serial numbers unique across companies) and
// matches scanner user IDs to employees; the receiver (service_role only) stores each upload once, drops punches before
// the company's attendance_tracking_from, and turns matched punches into one attendance_logs record per Nairobi day
// (first punch in, last punch out) without touching a day HR corrected. Unknown serials are remembered without their
// data, switched-off scanners and ones outside their IP lock store nothing, and companies never see each other's.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000e201';
const ME = '00000000-0000-0000-0000-00000000e202';
const REPORTS = '00000000-0000-0000-0000-00000000e203';
const ADMIN_B = '00000000-0000-0000-0000-00000000e204';
const SERIAL = 'BRAV260421021';
const MIGRATION = join(__dirname, '..', 'migrations', '20261023600000_attendance_scanners.sql');

let db: PGlite;
let deviceA: string;
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
/** the receiver (service_role), the way iclock_routes.js calls it */
const asService = async <T>(fn: () => Promise<T>) => {
  await db.exec('set role service_role');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
};
interface Receipt { accepted: boolean; received: number; stored: number; applied: number; unmatched: number }
const receive = async (lines: string[], serial = SERIAL, ip = '41.90.12.34') =>
  (await asService(() => rows<{ r: Receipt }>(`select public.attendance_scanner_receive($1, $2, $3) as r`, [serial, ip, lines.join('\n')])))[0].r;
const seen = async (serial: string, ip = '41.90.12.34') =>
  (await asService(() => rows<{ r: { accepted: boolean } }>(`select public.attendance_scanner_seen($1, $2) as r`, [serial, ip])))[0].r;
/** one ATTLOG line, as a ZKTeco sends it */
const line = (pin: string, at: string, status = 0, verify = 1) => `${pin}\t${at}\t${status}\t${verify}\t0\t0\t0`;
const day = async (emp: string, workDate: string) =>
  (await rows<{ login: string | null; logout: string | null; source: string; status: string }>(
    `select to_char(login_time at time zone 'Africa/Nairobi', 'HH24:MI') as login,
            to_char(logout_time at time zone 'Africa/Nairobi', 'HH24:MI') as logout, source, status
     from attendance_logs where tenant_id = $1 and employee_number = $2 and work_date = $3 and source <> 'legacy'`, [A, emp, workDate]))[0];

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  for (const [id, email, role, tenant] of [
    [HR, 'hr@a.co', 'HR', A], [ME, 'me@a.co', 'STAFF', A], [REPORTS, 'rep@a.co', 'STAFF', A], [ADMIN_B, 'admin@b.co', 'ADMIN', B],
  ]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${tenant}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    -- attendance counts from 1 February 2026 at A
    insert into attendance_settings (tenant_id, tracking_from) values ('${A}', '2026-02-01'), ('${B}', '2026-01-01')
      on conflict (tenant_id) do update set tracking_from = excluded.tracking_from;
    insert into employees ("Employee Number", "First Name", "Work Email", "Status", "Start Date", tenant_id) values
      ('FBL-000006', 'Sita', 'six@a.co', 'Active', '2025-01-06', '${A}'),
      ('FBL-000007', 'Saba', 'seven@a.co', 'Active', '2025-01-06', '${A}'),
      ('FBL-000008', 'Nane', 'eight@a.co', 'Active', '2025-01-06', '${A}'),
      ('B-1', 'Bo', 'bo@b.co', 'Active', '2025-01-06', '${B}');
  `);
}, 120000);

describe('registering scanners', () => {
  it('HR registers a scanner: the serial kept trimmed and in capitals, the IP lock checked', async () => {
    const [d] = await as<{ id: string; serial_number: string; brand: string; allowed_ip: string | null; active: boolean }>(HR,
      `insert into attendance_devices (name, serial_number) values ('Front door', '  brav260421021 ') returning id, serial_number, brand, allowed_ip, active`);
    deviceA = d.id;
    expect(d).toMatchObject({ serial_number: SERIAL, brand: 'zkteco', allowed_ip: null, active: true });
    expect(await fails(as(HR, `insert into attendance_devices (name, serial_number) values ('Back', 'x')`))).toMatch(/serial number as it shows/);
    expect(await fails(as(HR, `insert into attendance_devices (name, serial_number) values ('  ', 'ABC123')`))).toMatch(/Give the scanner a name/);
    expect(await fails(as(HR, `update attendance_devices set allowed_ip = 'office' where id = $1`, [deviceA]))).toMatch(/office IP address/);
  });

  it('a serial belongs to one company only', async () => {
    expect(await fails(as(ADMIN_B, `insert into attendance_devices (name, serial_number) values ('Gate', $1)`, [SERIAL])))
      .toMatch(/duplicate key|attendance_devices_serial_key/);
    expect(await fails(as(HR, `insert into attendance_devices (name, serial_number) values ('Again', $1)`, [SERIAL.toLowerCase()])))
      .toMatch(/duplicate key|attendance_devices_serial_key/);
  });

  it('what the scanner last did is written by the receiver only', async () => {
    expect(await fails(as(HR, `update attendance_devices set last_seen_at = now() where id = $1`, [deviceA]))).toMatch(/permission denied/);
    expect(await fails(as(HR, `update attendance_devices set tenant_id = $2 where id = $1`, [deviceA, B]))).toMatch(/permission denied/);
  });

  it('staff can’t see or add scanners; another company sees none of ours', async () => {
    expect(await as(ME, `select 1 from attendance_devices`)).toEqual([]);
    expect(await fails(as(ME, `insert into attendance_devices (name, serial_number) values ('Mine', 'ABC123')`))).toMatch(/row-level security/);
    expect(await as(ADMIN_B, `select 1 from attendance_devices`)).toEqual([]);
    expect(await as(HR, `select serial_number from attendance_devices`)).toEqual([{ serial_number: SERIAL }]);
  });
});

describe('the receiver is the server’s only', () => {
  it('signed-in people and visitors can’t call it', async () => {
    expect(await fails(as(HR, `select public.attendance_scanner_receive($1, '1.1.1.1', '')`, [SERIAL]))).toMatch(/permission denied/);
    expect(await fails(as(HR, `select public.attendance_scanner_seen($1, '1.1.1.1')`, [SERIAL]))).toMatch(/permission denied/);
    expect(await fails(asAnon(db, () => rows(`select public.attendance_scanner_receive($1, '1.1.1.1', '')`, [SERIAL])))).toMatch(/permission denied/);
    expect(await fails(asAnon(db, () => rows(`select public.attendance_scanner_seen($1, '1.1.1.1')`, [SERIAL])))).toMatch(/permission denied/);
    expect(await fails(as(HR, `select public.attendance_scanner_apply(gen_random_uuid())`))).toMatch(/permission denied/);
  });
});

describe('receiving punches', () => {
  it('stores each punch once, ignores bad lines and history before attendance counts, and records the check-in', async () => {
    const r = await receive([
      line('6', '2026-01-31 08:00:00'), // before 1 February: not stored at all
      line('6', '2026-02-02 07:55:12'),
      line('6', '2026-02-02 07:55:12'), // the same line twice in one upload
      line('6', '2026-02-02 17:04:00'),
      line('6', '2026-02-02 12:30:00'), // in between: neither in nor out
      'garbage',
      line('6', '2026-02-30 08:00:00'), // no such day
      line('bad pin!', '2026-02-02 08:00:00'),
      '',
    ]);
    expect(r).toEqual({ accepted: true, received: 8, stored: 3, applied: 0, unmatched: 3 });
    // sent again (the scanner resends after a restart): nothing new
    expect(await receive([line('6', '2026-02-02 07:55:12')])).toMatchObject({ stored: 0 });
    const [d] = await rows<{ last_ip: string; last_seen: boolean; last_error: string | null }>(
      `select last_ip, last_seen_at > now() - interval '1 minute' as last_seen, last_error from attendance_devices where id = $1`, [deviceA]);
    expect(d).toEqual({ last_ip: '41.90.12.34', last_seen: true, last_error: null });
    const [p] = await rows(`select tenant_id, status, verify, employee_number, applied_at from attendance_scanner_punches where punched_at = '2026-02-02 04:55:12+00'`);
    expect(p).toEqual({ tenant_id: A, status: 0, verify: 1, employee_number: null, applied_at: null });
    expect(await rows(`select 1 from attendance_logs where employee_number = 'FBL-000006'`)).toEqual([]);
  });

  it('HR sees the unmatched scanner user IDs; matching one turns its punches into attendance: first in, last out', async () => {
    expect(await as(HR, `select scanner_user_id, punches from public.attendance_scanner_unmatched()`)).toEqual([{ scanner_user_id: '6', punches: 3 }]);
    await as(HR, `insert into attendance_scanner_users (scanner_user_id, employee_number) values (' 6 ', 'FBL-000006')`);
    expect(await day('FBL-000006', '2026-02-02')).toEqual({ login: '07:55', logout: '17:04', source: 'scanner', status: 'clocked_out' });
    expect(await as(HR, `select * from public.attendance_scanner_unmatched()`)).toEqual([]);
    expect(await rows(`select count(*)::int as n from attendance_scanner_punches where employee_number = 'FBL-000006' and applied_at is not null`))
      .toEqual([{ n: 3 }]);
  });

  it('a matched punch applies as it arrives; one punch is a clock-in only; an earlier one moves the clock-in', async () => {
    let r = await receive([line('6', '2026-02-03 08:10:00')]);
    expect(r).toMatchObject({ stored: 1, applied: 1, unmatched: 0 });
    expect(await day('FBL-000006', '2026-02-03')).toEqual({ login: '08:10', logout: null, source: 'scanner', status: 'clocked_in' });
    r = await receive([line('6', '2026-02-03 07:50:00')]);
    expect(await day('FBL-000006', '2026-02-03')).toMatchObject({ login: '07:50', logout: '08:10', status: 'clocked_out' });
    await receive([line('6', '2026-02-03 17:30:00')]);
    expect(await day('FBL-000006', '2026-02-03')).toMatchObject({ login: '07:50', logout: '17:30' });
  });

  it('a day clocked in on the app keeps its record: the scanner moves the clock-in earlier and the clock-out later', async () => {
    await rows(`select public.attendance_punch($1, 'FBL-000007', 'in', null, '2026-02-04T05:20:00Z')`, [A]); // 08:20
    await as(HR, `insert into attendance_scanner_users (scanner_user_id, employee_number) values ('7', 'FBL-000007')`);
    await receive([line('7', '2026-02-04 08:05:00'), line('7', '2026-02-04 17:15:00')]);
    expect(await day('FBL-000007', '2026-02-04')).toEqual({ login: '08:05', logout: '17:15', source: 'app', status: 'clocked_out' });
  });

  it('a day HR corrected is left alone and the punch marked', async () => {
    await as(HR, `select public.attendance_set_day('FBL-000007', '2026-02-05', '2026-02-05T06:00:00Z', '2026-02-05T15:00:00Z', 'Was at a client')`);
    const r = await receive([line('7', '2026-02-05 07:00:00')]);
    expect(r).toMatchObject({ stored: 1, applied: 0 });
    expect(await day('FBL-000007', '2026-02-05')).toEqual({ login: '09:00', logout: '18:00', source: 'hr', status: 'clocked_out' });
    expect(await rows(`select skipped_reason from attendance_scanner_punches where punched_at = '2026-02-05 04:00:00+00'`)).toEqual([{ skipped_reason: 'hr_corrected' }]);
  });

  it('removing a match doesn’t undo attendance; a changed match applies the waiting punches to the new person', async () => {
    await as(HR, `delete from attendance_scanner_users where scanner_user_id = '6'`);
    expect(await day('FBL-000006', '2026-02-02')).toMatchObject({ login: '07:55' });
    await receive([line('6', '2026-02-06 08:00:00')]);
    expect(await as(HR, `select scanner_user_id from public.attendance_scanner_unmatched()`)).toEqual([{ scanner_user_id: '6' }]);
    await as(HR, `insert into attendance_scanner_users (scanner_user_id, employee_number) values ('6', 'FBL-000008')`);
    expect(await day('FBL-000008', '2026-02-06')).toMatchObject({ login: '08:00', source: 'scanner' });
    expect(await day('FBL-000006', '2026-02-06')).toBeUndefined();
  });

  it('a match must be one of the company’s employees and one per scanner user ID', async () => {
    expect(await fails(as(HR, `insert into attendance_scanner_users (scanner_user_id, employee_number) values ('9', 'B-1')`))).toMatch(/Unknown employee/);
    expect(await fails(as(HR, `insert into attendance_scanner_users (scanner_user_id, employee_number) values ('6', 'FBL-000007')`))).toMatch(/duplicate key/);
    expect(await fails(as(HR, `insert into attendance_scanner_users (scanner_user_id, employee_number) values ('6 7', 'FBL-000007')`))).toMatch(/scanner user ID/);
  });
});

describe('scanners that may not send', () => {
  it('outside its IP lock: refused, the reason kept for HR', async () => {
    await as(HR, `update attendance_devices set allowed_ip = '41.90.12.0/24' where id = $1`, [deviceA]);
    expect(await receive([line('7', '2026-02-09 08:00:00')], SERIAL, '102.1.1.1')).toMatchObject({ accepted: false, stored: 0 });
    const [d] = await rows<{ last_error: string; last_ip: string }>(`select last_error, last_ip from attendance_devices where id = $1`, [deviceA]);
    expect(d.last_error).toMatch(/Refused a connection from 102\.1\.1\.1: this scanner is locked to 41\.90\.12\.0\/24/);
    expect(d.last_ip).toBe('41.90.12.34');
    // from the office again: accepted, the problem cleared
    expect(await receive([line('7', '2026-02-09 08:00:00')], SERIAL, '41.90.12.77')).toMatchObject({ accepted: true, stored: 1 });
    expect((await rows(`select last_error, last_ip from attendance_devices where id = $1`, [deviceA]))[0]).toEqual({ last_error: null, last_ip: '41.90.12.77' });
    await as(HR, `update attendance_devices set allowed_ip = null where id = $1`, [deviceA]);
  });

  it('a switched-off scanner stores nothing', async () => {
    await as(HR, `update attendance_devices set active = false where id = $1`, [deviceA]);
    expect(await receive([line('7', '2026-02-10 08:00:00')])).toMatchObject({ accepted: false, stored: 0 });
    expect(await seen(SERIAL)).toEqual({ accepted: false });
    await as(HR, `update attendance_devices set active = true where id = $1`, [deviceA]);
    expect(await seen(SERIAL)).toEqual({ accepted: true });
  });

  it('an unknown serial: nothing stored, only that it called; HR can ask about one serial, never list them', async () => {
    expect(await receive([line('1', '2026-02-10 08:00:00')], 'NEW0000001', '41.90.12.5')).toMatchObject({ accepted: false, stored: 0 });
    expect(await seen('junk serial!')).toEqual({ accepted: false });
    expect(await rows(`select serial_number, last_ip from attendance_scanner_unregistered`)).toEqual([{ serial_number: 'NEW0000001', last_ip: '41.90.12.5' }]);
    expect(await rows(`select 1 from attendance_scanner_punches where scanner_user_id = '1'`)).toEqual([]);
    expect((await as<{ r: { tried: boolean } }>(HR, `select public.attendance_scanner_tried(' new0000001') as r`))[0].r.tried).toBe(true);
    expect((await as<{ r: { tried: boolean } }>(HR, `select public.attendance_scanner_tried('OTHER123') as r`))[0].r.tried).toBe(false);
    expect(await fails(as(HR, `select * from attendance_scanner_unregistered`))).toMatch(/permission denied/);
    expect(await fails(as(ME, `select public.attendance_scanner_tried('NEW0000001')`))).toMatch(/Only HR/);
    // registering it clears it
    await as(ADMIN_B, `insert into attendance_devices (name, serial_number) values ('Gate', 'NEW0000001')`);
    expect(await rows(`select 1 from attendance_scanner_unregistered`)).toEqual([]);
  });
});

describe('who sees what', () => {
  it('companies never see each other’s scanners, matches or punches', async () => {
    expect(await as(ADMIN_B, `select serial_number from attendance_devices`)).toEqual([{ serial_number: 'NEW0000001' }]);
    expect(await as(ADMIN_B, `select 1 from attendance_scanner_users`)).toEqual([]);
    expect(await as(ADMIN_B, `select 1 from attendance_scanner_punches`)).toEqual([]);
    expect(await as(ADMIN_B, `select * from public.attendance_scanner_unmatched()`)).toEqual([]);
    expect(await as(ADMIN_B, `update attendance_devices set name = 'Taken' where id = $1 returning id`, [deviceA])).toEqual([]);
    expect(await as(ADMIN_B, `delete from attendance_scanner_users returning id`)).toEqual([]);
    // B's punches stay B's
    await receive([line('1', '2026-02-10 08:00:00')], 'NEW0000001');
    expect(await as(ADMIN_B, `select scanner_user_id from public.attendance_scanner_unmatched()`)).toEqual([{ scanner_user_id: '1' }]);
    expect(await as(HR, `select 1 from attendance_scanner_punches where scanner_user_id = '1'`)).toEqual([]);
  });

  it('staff see no punches or matches and can’t match or write punches', async () => {
    expect(await as(ME, `select 1 from attendance_scanner_punches`)).toEqual([]);
    expect(await as(ME, `select 1 from attendance_scanner_users`)).toEqual([]);
    expect(await fails(as(ME, `insert into attendance_scanner_users (scanner_user_id, employee_number) values ('99', 'FBL-000006')`))).toMatch(/row-level security/);
    expect(await fails(as(HR, `insert into attendance_scanner_punches (tenant_id, device_id, scanner_user_id, punched_at) values ($1, $2, '6', now())`, [A, deviceA])))
      .toMatch(/permission denied/);
    expect(await fails(as(HR, `update attendance_scanner_punches set employee_number = 'FBL-000007'`))).toMatch(/permission denied/);
  });

  it('the Reports module reads scanners but can’t change them', async () => {
    await db.exec(`update role_permissions set permissions = array['dashboard', 'reports'] where role_name = 'STAFF' and tenant_id = '${A}'`);
    try {
      expect(await as(REPORTS, `select serial_number from attendance_devices`)).toEqual([{ serial_number: SERIAL }]);
      expect(await as(REPORTS, `update attendance_devices set name = 'X' returning id`)).toEqual([]);
      expect(await fails(as(REPORTS, `insert into attendance_scanner_users (scanner_user_id, employee_number) values ('99', 'FBL-000006')`))).toMatch(/row-level security/);
    } finally {
      await db.exec(`update role_permissions set permissions = array['dashboard'] where role_name = 'STAFF' and tenant_id = '${A}'`);
    }
  });
});

describe('the migration', () => {
  it('runs again safely, keeping what is there', async () => {
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    expect(await as(HR, `select serial_number from attendance_devices`)).toEqual([{ serial_number: SERIAL }]);
    expect(await receive([line('8', '2026-02-11 08:00:00')])).toMatchObject({ accepted: true, stored: 1 });
  });
});
