// @vitest-environment node
//
// Door scanners' user names, scanner user 0 and "Not staff, ignore" (20261024000000, FIG-1198): the receiver (service_role
// only) keeps the name each scanner user ID has on each scanner from its user records, through the same serial and IP
// lock checks as punches; the check-in asks a scanner for its users at most once a day; scanner user 0 is never offered
// for matching; HR marks scanner users who aren't staff, their punches kept but never applied, and can undo it or match
// them later; companies never see each other's.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000e301';
const ME = '00000000-0000-0000-0000-00000000e302';
const ADMIN_B = '00000000-0000-0000-0000-00000000e304';
const FRONT = 'BRAV260421021';
const BACK = 'BACK0000001';
const GATE_B = 'GATEB000001';
const MIGRATION = join(__dirname, '..', 'migrations', '20261024000000_attendance_scanner_names.sql');

let db: PGlite;
let front: string;
let back: string;
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
const asService = async <T>(fn: () => Promise<T>) => {
  await db.exec('set role service_role');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
};
const receiveUsers = async (lines: string[], serial = FRONT, ip = '41.90.12.34') =>
  (await asService(() =>
    rows<{ r: { accepted: boolean; received: number; users: number } }>(`select public.attendance_scanner_receive_users($1, $2, $3) as r`, [serial, ip, lines.join('\n')])
  ))[0].r;
const poll = async (serial = FRONT, ip = '41.90.12.34') =>
  (await asService(() => rows<{ r: { accepted: boolean; commands: string[] } }>(`select public.attendance_scanner_poll($1, $2) as r`, [serial, ip])))[0].r;
const receive = async (lines: string[], serial = FRONT) =>
  (await asService(() => rows<{ r: { stored: number } }>(`select public.attendance_scanner_receive($1, '41.90.12.34', $2) as r`, [serial, lines.join('\n')])))[0].r;
const punch = (pin: string, at: string, status = 0) => `${pin}\t${at}\t${status}\t1\t0\t0\t0`;
/** a USERINFO record the way a ZKTeco sends it in an OPERLOG upload */
const user = (pin: string, name: string) => `USER PIN=${pin}\tName=${name}\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000\tVerify=0\tViceCard=`;
const names = async (device: string) =>
  (await rows<{ scanner_user_id: string; name: string }>(
    `select scanner_user_id, name from attendance_scanner_names where device_id = $1 order by scanner_user_id::int`, [device]));
const unmatched = async (who = HR) =>
  (await as<{ scanner_user_id: string }>(who, `select scanner_user_id from public.attendance_scanner_unmatched()`)).map((u) => u.scanner_user_id);
const device = async (id: string) =>
  (await rows<{ requested: string | null; received: string | null }>(
    `select users_requested_at as requested, users_received_at as received from attendance_devices where id = $1`, [id]))[0];

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  for (const [id, email, role, tenant] of [[HR, 'hr@a.co', 'HR', A], [ME, 'me@a.co', 'STAFF', A], [ADMIN_B, 'admin@b.co', 'ADMIN', B]]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${tenant}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values ('HR', array['employees'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into attendance_settings (tenant_id, tracking_from) values ('${A}', '2026-02-01'), ('${B}', '2026-01-01')
      on conflict (tenant_id) do update set tracking_from = excluded.tracking_from;
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Status", "Start Date", tenant_id) values
      ('FBL-000003', 'Victor', 'Ogola', 'victor@a.co', 'Active', '2025-01-06', '${A}'),
      ('FBL-000010', 'Esther', 'Nalenyi', 'esther@a.co', 'Active', '2025-01-06', '${A}');
  `);
  [{ id: front }] = await as<{ id: string }>(HR, `insert into attendance_devices (name, serial_number) values ('Front door', $1) returning id`, [FRONT]);
  [{ id: back }] = await as<{ id: string }>(HR, `insert into attendance_devices (name, serial_number, allowed_ip) values ('Back door', $1, '41.90.12.0/24') returning id`, [BACK]);
  await as(ADMIN_B, `insert into attendance_devices (name, serial_number) values ('Gate', $1)`, [GATE_B]);
}, 120000);

describe('names from the scanner', () => {
  it('keeps the name in each user record, in both forms, and nothing else the upload carries', async () => {
    const r = await receiveUsers([
      user('1', 'Onyii'),
      user('3', 'Esther'),
      'PIN=9\tName=Franciskiprono\tPri=0\tPasswd=\tCard=\tGrp=1', // a USERINFO upload's form
      user('0', 'Door'), // not a person
      'FP PIN=3\tFID=6\tSize=1184\tValid=1\tTMP=TbNTUzIxAAAEKCsECAUHCc7QAAAcKWkBAAAAhP0c', // a fingerprint template
      'OPLOG 4\t0\t2026-10-22 08:00:00\t0\t0\t0\t0',
      user('22', 'Beatr\u0007ice'), // a control character
      '',
    ]);
    expect(r).toEqual({ accepted: true, received: 7, users: 4 });
    expect(await names(front)).toEqual([
      { scanner_user_id: '1', name: 'Onyii' },
      { scanner_user_id: '3', name: 'Esther' },
      { scanner_user_id: '9', name: 'Franciskiprono' },
      { scanner_user_id: '22', name: 'Beatrice' },
    ]);
    expect((await device(front)).received).not.toBeNull();
  });

  it('a renamed user is updated (the last line for an ID counts); a user with no name forgets the one kept', async () => {
    await receiveUsers([user('1', 'Onyi'), user('1', 'Onyii'), user('9', ''), user('3', 'Esther')]);
    expect(await names(front)).toEqual([
      { scanner_user_id: '1', name: 'Onyii' },
      { scanner_user_id: '3', name: 'Esther' },
      { scanner_user_id: '22', name: 'Beatrice' },
    ]);
    await receiveUsers([user('9', 'Franciskiprono')]);
  });

  it('names are per scanner: the same ID can have another name on another scanner', async () => {
    await receiveUsers([user('3', 'Mark')], BACK, '41.90.12.50');
    expect(await names(back)).toEqual([{ scanner_user_id: '3', name: 'Mark' }]);
    expect((await names(front)).find((n) => n.scanner_user_id === '3')).toEqual({ scanner_user_id: '3', name: 'Esther' });
  });

  it('respects the IP lock and unknown serials: nothing kept', async () => {
    expect(await receiveUsers([user('4', 'Zilpar')], BACK, '102.1.1.1')).toEqual({ accepted: false, received: 1, users: 0 });
    expect((await rows<{ last_error: string }>(`select last_error from attendance_devices where id = $1`, [back]))[0].last_error)
      .toMatch(/Refused a connection from 102\.1\.1\.1/);
    expect(await receiveUsers([user('4', 'Zilpar')], 'NOBODY00001')).toMatchObject({ accepted: false, users: 0 });
    expect(await rows(`select 1 from attendance_scanner_names where name = 'Zilpar'`)).toEqual([]);
    await receiveUsers([], BACK, '41.90.12.50'); // from the office again: the error clears
  });

  it('a different scanner under the same record (serial changed) starts over', async () => {
    const [{ id }] = await as<{ id: string }>(HR, `insert into attendance_devices (name, serial_number) values ('Side', 'SIDE0000001') returning id`);
    await receiveUsers([user('5', 'Given')], 'SIDE0000001');
    expect(await names(id)).toEqual([{ scanner_user_id: '5', name: 'Given' }]);
    await as(HR, `update attendance_devices set serial_number = 'SIDE0000002' where id = $1`, [id]);
    expect(await names(id)).toEqual([]);
    expect(await device(id)).toEqual({ requested: null, received: null });
    await as(HR, `delete from attendance_devices where id = $1`, [id]);
  });
});

describe('asking the scanner for its users', () => {
  it('asks once, on a check-in, when the scanner hasn’t sent them in a day; never more than once a day', async () => {
    await rows(`update attendance_devices set users_received_at = null, users_requested_at = null where id = $1`, [front]);
    // two people punched who have no name yet, and one who has
    await receive([punch('7', '2026-02-02 08:00:00'), punch('12', '2026-02-02 08:30:00'), punch('3', '2026-02-02 07:59:00')]);
    const first = await poll();
    expect(first.accepted).toBe(true);
    const [all, ...each] = first.commands;
    expect(all).toMatch(/^C:\d+:DATA QUERY USERINFO$/);
    expect(each.map((c) => c.replace(/^C:\d+:/, ''))).toEqual(['DATA QUERY USERINFO PIN=12', 'DATA QUERY USERINFO PIN=7']);
    // each command has its own ID
    expect(new Set(first.commands.map((c) => c.split(':')[1])).size).toBe(3);
    // the scanner ignored it: not asked again today
    expect(await poll()).toEqual({ accepted: true, commands: [] });
    // a day later, still nothing received: asked again
    await rows(`update attendance_devices set users_requested_at = now() - interval '25 hours' where id = $1`, [front]);
    expect((await poll()).commands.length).toBeGreaterThan(0);
  });

  it('not while the users were received in the last day', async () => {
    await rows(`update attendance_devices set users_requested_at = null where id = $1`, [front]);
    await receiveUsers([user('7', 'Luke'), user('12', 'Ruth')]);
    expect(await poll()).toEqual({ accepted: true, commands: [] });
    await rows(`update attendance_devices set users_received_at = now() - interval '2 days', users_requested_at = now() - interval '2 hours' where id = $1`, [front]);
    expect(await poll()).toEqual({ accepted: true, commands: [] });
    await rows(`update attendance_devices set users_requested_at = now() - interval '2 days' where id = $1`, [front]);
    // everyone who punched has a name now: only the question for all users
    expect((await poll()).commands.map((c) => c.replace(/^C:\d+:/, ''))).toEqual(['DATA QUERY USERINFO']);
  });

  it('an unknown serial, or a scanner outside its IP lock, is asked nothing', async () => {
    expect(await poll('NOBODY00001')).toEqual({ accepted: false, commands: [] });
    expect(await poll(BACK, '102.1.1.1')).toEqual({ accepted: false, commands: [] });
    expect((await device(back)).requested).toBeNull();
  });
});

describe('scanner user 0', () => {
  it('is never offered for matching, can’t be matched or ignored, and its punches are kept', async () => {
    await receive([punch('0', '2026-02-03 09:00:00', 201), punch('00', '2026-02-03 09:01:00', 201)]);
    expect(await rows(`select count(*)::int as n from attendance_scanner_punches where scanner_user_id in ('0', '00')`)).toEqual([{ n: 2 }]);
    const waiting = await unmatched();
    expect(waiting).not.toContain('0');
    expect(waiting).not.toContain('00');
    expect(await fails(as(HR, `insert into attendance_scanner_users (scanner_user_id, employee_number) values (' 0 ', 'FBL-000003')`)))
      .toMatch(/Scanner user 0 isn't a person/);
    expect(await fails(as(HR, `insert into attendance_scanner_ignored (scanner_user_id, reason) values ('0', 'Door')`))).toMatch(/isn't a person/);
    expect(await rows(`select 1 from attendance_scanner_names where scanner_user_id ~ '^0+$'`)).toEqual([]);
  });
});

describe('"Not staff, ignore"', () => {
  it('HR marks a scanner user as not staff, with a reason; they leave "Waiting for a match" and their punches never count', async () => {
    await receive([punch('22', '2026-02-04 06:30:00')]);
    expect(await unmatched()).toContain('22');
    expect(await fails(as(HR, `insert into attendance_scanner_ignored (scanner_user_id, reason) values ('22', '  ')`))).toMatch(/Say why/);
    const [i] = await as<{ scanner_user_id: string; reason: string; ignored_by: string }>(HR,
      `insert into attendance_scanner_ignored (scanner_user_id, reason) values (' 22 ', ' The cook ') returning scanner_user_id, reason, ignored_by`);
    expect(i).toEqual({ scanner_user_id: '22', reason: 'The cook', ignored_by: HR });
    expect(await unmatched()).not.toContain('22');
    // more punches: kept, never applied, still not offered
    await receive([punch('22', '2026-02-05 06:31:00')]);
    expect(await rows(`select count(*)::int as n, count(applied_at)::int as applied from attendance_scanner_punches where scanner_user_id = '22'`))
      .toEqual([{ n: 2, applied: 0 }]);
    expect(await unmatched()).not.toContain('22');
    expect(await fails(as(HR, `insert into attendance_scanner_ignored (scanner_user_id, reason) values ('22', 'Again')`))).toMatch(/duplicate key|attendance_scanner_ignored_key/);
  });

  it('Undo: they wait for a match again', async () => {
    await as(HR, `delete from attendance_scanner_ignored where scanner_user_id = '22'`);
    expect(await unmatched()).toContain('22');
  });

  it('matching an ignored scanner user later is allowed: no longer ignored, their waiting punches count', async () => {
    await as(HR, `insert into attendance_scanner_ignored (scanner_user_id, reason) values ('22', 'The cook')`);
    await as(HR, `insert into attendance_scanner_users (scanner_user_id, employee_number) values ('22', 'FBL-000010')`);
    expect(await as(HR, `select 1 from attendance_scanner_ignored where scanner_user_id = '22'`)).toEqual([]);
    expect(await rows(`select count(applied_at)::int as applied from attendance_scanner_punches where scanner_user_id = '22'`)).toEqual([{ applied: 2 }]);
    expect(await rows(`select work_date::text from attendance_logs where employee_number = 'FBL-000010' and source = 'scanner' order by work_date`))
      .toEqual([{ work_date: '2026-02-04' }, { work_date: '2026-02-05' }]);
  });

  it('a matched scanner user can’t be ignored without removing the match', async () => {
    expect(await fails(as(HR, `insert into attendance_scanner_ignored (scanner_user_id, reason) values ('22', 'The cook')`))).toMatch(/Remove the match first/);
  });

  it('only HR manages it: staff can’t see or write it; people can’t forge who or when', async () => {
    expect(await fails(as(ME, `insert into attendance_scanner_ignored (scanner_user_id, reason) values ('12', 'x')`))).toMatch(/row-level security/);
    expect(await as(ME, `select 1 from attendance_scanner_ignored`)).toEqual([]);
    expect(await as(ME, `select 1 from attendance_scanner_names`)).toEqual([]);
    expect(await fails(as(HR, `insert into attendance_scanner_ignored (scanner_user_id, reason, ignored_by) values ('12', 'x', $1)`, [ME])))
      .toMatch(/permission denied/);
  });
});

describe('who may do what', () => {
  it('the receiver’s functions are the server’s only', async () => {
    for (const sql of [
      `select public.attendance_scanner_receive_users('${FRONT}', '1.1.1.1', '')`,
      `select public.attendance_scanner_poll('${FRONT}', '1.1.1.1')`,
    ]) {
      expect(await fails(as(HR, sql))).toMatch(/permission denied/);
      expect(await fails(asAnon(db, () => rows(sql)))).toMatch(/permission denied/);
    }
  });

  it('people can read the names but never write them', async () => {
    expect((await as(HR, `select 1 from attendance_scanner_names`)).length).toBeGreaterThan(0);
    expect(await fails(as(HR, `insert into attendance_scanner_names (device_id, scanner_user_id, tenant_id, name) values ($1, '50', $2, 'X')`, [front, A])))
      .toMatch(/permission denied/);
    expect(await fails(as(HR, `update attendance_scanner_names set name = 'X'`))).toMatch(/permission denied/);
    expect(await fails(as(HR, `update attendance_devices set users_received_at = now() where id = $1`, [front]))).toMatch(/permission denied/);
  });

  it('another company sees none of ours', async () => {
    await receiveUsers([user('1', 'Bo')], GATE_B);
    await as(HR, `insert into attendance_scanner_ignored (scanner_user_id, reason) values ('12', 'Visitor')`);
    expect(await as(ADMIN_B, `select scanner_user_id, name from attendance_scanner_names`)).toEqual([{ scanner_user_id: '1', name: 'Bo' }]);
    expect(await as(ADMIN_B, `select 1 from attendance_scanner_ignored`)).toEqual([]);
    expect(await as(ADMIN_B, `delete from attendance_scanner_ignored returning id`)).toEqual([]);
    expect(await as(HR, `select scanner_user_id from attendance_scanner_ignored`)).toEqual([{ scanner_user_id: '12' }]);
  });
});

describe('the migration', () => {
  it('runs again safely, keeping what is there', async () => {
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    await db.exec('reset search_path');
    expect((await names(front)).map((n) => n.name)).toEqual(['Onyii', 'Esther', 'Luke', 'Franciskiprono', 'Ruth', 'Beatrice']);
    expect(await as(HR, `select scanner_user_id from attendance_scanner_ignored`)).toEqual([{ scanner_user_id: '12' }]);
    expect(await receiveUsers([user('13', 'Mark')])).toMatchObject({ accepted: true, users: 1 });
    expect(await unmatched()).not.toContain('0');
  });
});
