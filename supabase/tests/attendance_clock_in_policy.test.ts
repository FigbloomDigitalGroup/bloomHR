// @vitest-environment node
//
// Where people may clock in from in the app (20261024100000, FIG-1200): each company's policy (anywhere, from an office
// network or near a branch, or scanner only) and each person's work arrangement on top of it (on site, hybrid on their
// remote weekdays, remote, field with the location recorded). The rule is enforced on every app clock-in and clock-out;
// scanner punches and HR corrections don't go through it. Every app clock-in is tagged by place. Only HR sets the
// policy and arrangements; companies never see each other's. The days carry the schedule's end time and where the
// clock-out came from (scanner, app, HR) so a scanner's last scan can show as "Last scan" until the day ends.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000e301';
const ON = '00000000-0000-0000-0000-00000000e302';
const HY = '00000000-0000-0000-0000-00000000e303';
const RE = '00000000-0000-0000-0000-00000000e304';
const FI = '00000000-0000-0000-0000-00000000e305';
const ADMIN_B = '00000000-0000-0000-0000-00000000e306';
const MIGRATION = join(__dirname, '..', 'migrations', '20261024100000_attendance_clock_in_policy.sql');

// Nairobi branch; a point ~70 m away; Eldoret, ~250 km away
const NAIROBI = { lat: -1.2864, lon: 36.8172 };
const NEAR = { latitude: -1.287, longitude: 36.8175, accuracy: 15 };
const FAR = { latitude: 0.5143, longitude: 35.2698, accuracy: 15 };
// Wednesday and Thursday mornings (Nairobi 09:00)
const WED = '2026-10-21T06:00:00Z';
const THU = '2026-10-22T06:00:00Z';

let db: PGlite;
let nairobi: string;
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

interface Check { ok: boolean; place: string | null; detail: string | null; message: string | null }
const check = async (emp: string, opts: { kind?: 'in' | 'out'; loc?: unknown; ip?: string | null; at?: string } = {}) =>
  (await rows<{ c: Check }>(`select public.attendance_clock_check($1, $2, $3, $4, $5, $6) as c`, [
    A, emp, opts.kind ?? 'in', opts.loc ? JSON.stringify(opts.loc) : null, opts.ip ?? null, opts.at ?? THU,
  ]))[0].c;
const appPunch = (emp: string, kind: 'in' | 'out', at: string, loc: unknown = null, ip: string | null = null) =>
  rows(`select public.attendance_app_punch($1, $2, $3, $4, $5, $6)`, [A, emp, kind, loc ? JSON.stringify(loc) : null, ip, at]);
const setPolicy = (policy: string) => db.query(`update attendance_settings set clock_in_policy = $1 where tenant_id = $2`, [policy, A]);
const setArrangement = (emp: string, arrangement: string, days: number[] = []) =>
  db.query(`update employees set work_arrangement = $1, remote_days = $2 where tenant_id = $3 and "Employee Number" = $4`, [arrangement, days, A, emp]);
const record = async (emp: string, day: string) =>
  (await rows<{ place: string | null; place_detail: string | null; source: string; geolocation: Record<string, unknown> | null }>(
    `select place, place_detail, source, geolocation from attendance_logs where tenant_id = $1 and employee_number = $2 and work_date = $3 and source <> 'legacy'`,
    [A, emp, day]))[0];

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  for (const [id, email, role, tenant] of [
    [HR, 'hr@a.co', 'HR', A], [ON, 'on@a.co', 'STAFF', A], [HY, 'hy@a.co', 'STAFF', A], [RE, 're@a.co', 'STAFF', A],
    [FI, 'fi@a.co', 'STAFF', A], [ADMIN_B, 'admin@b.co', 'ADMIN', B],
  ]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${tenant}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into attendance_settings (tenant_id, tracking_from) values ('${A}', '2025-01-01'), ('${B}', '2025-01-01')
      on conflict (tenant_id) do update set tracking_from = excluded.tracking_from;
    insert into employees ("Employee Number", "First Name", "Work Email", "Status", "Start Date", tenant_id) values
      ('A-HR', 'Hana', 'hr@a.co', 'Active', '2025-01-06', '${A}'),
      ('A-ON', 'Ona', 'on@a.co', 'Active', '2025-01-06', '${A}'),
      ('A-HY', 'Hy', 'hy@a.co', 'Active', '2025-01-06', '${A}'),
      ('A-RE', 'Rei', 're@a.co', 'Active', '2025-01-06', '${A}'),
      ('A-FI', 'Fia', 'fi@a.co', 'Active', '2025-01-06', '${A}'),
      ('B-1', 'Bo', 'admin@b.co', 'Active', '2025-01-06', '${B}');
  `);
  nairobi = (await rows<{ id: string }>(`select id from branches where tenant_id = $1 and is_default`, [A]))[0]?.id
    ?? (await rows<{ id: string }>(`insert into branches (tenant_id, name, is_default) values ($1, 'Nairobi', true) returning id`, [A]))[0].id;
  await db.query(`update branches set name = 'Nairobi' where id = $1`, [nairobi]);
  await setArrangement('A-RE', 'remote');
  await setArrangement('A-FI', 'field');
}, 120000);

describe('before a company chooses', () => {
  it('everyone is on site, the policy is anywhere: the app clocks in as before, with no place it can tell', async () => {
    expect((await rows(`select work_arrangement, remote_days from employees where "Employee Number" = 'A-ON'`))[0])
      .toEqual({ work_arrangement: 'on_site', remote_days: [] });
    expect((await rows(`select clock_in_policy, office_networks, office_radius_m from attendance_settings where tenant_id = $1`, [A]))[0])
      .toEqual({ clock_in_policy: 'anywhere', office_networks: [], office_radius_m: 300 });
    expect(await check('A-ON', { loc: FAR })).toEqual({ ok: true, place: null, detail: null, message: null });
    await appPunch('A-ON', 'in', '2026-10-12T05:00:00Z');
    expect(await record('A-ON', '2026-10-12')).toMatchObject({ place: null, source: 'app' });
  });
});

describe('the company’s offices', () => {
  it('HR lists office networks: tidied, each once; private, too wide and junk refused', async () => {
    await as(HR, `update attendance_settings set office_networks = array['41.90.12.7', ' 102.68.0.9/24 ', '41.90.12.7']`);
    expect((await rows(`select office_networks from attendance_settings where tenant_id = $1`, [A]))[0].office_networks)
      .toEqual(['41.90.12.7', '102.68.0.0/24']);
    expect(await fails(as(HR, `update attendance_settings set office_networks = array['192.168.1.0/24']`))).toMatch(/private address/);
    expect(await fails(as(HR, `update attendance_settings set office_networks = array['41.0.0.0/8']`))).toMatch(/too wide/);
    expect(await fails(as(HR, `update attendance_settings set office_networks = array['the office']`))).toMatch(/isn't an IP address/);
    expect(await fails(as(HR, `update attendance_settings set office_radius_m = 10`))).toMatch(/office_radius_check/);
  });

  it('HR sets a branch’s location; staff and other companies can’t', async () => {
    await as(HR, `select public.attendance_set_branch_location($1, $2, $3)`, [nairobi, NAIROBI.lat, NAIROBI.lon]);
    expect((await rows(`select latitude, longitude from branches where id = $1`, [nairobi]))[0]).toEqual({ latitude: NAIROBI.lat, longitude: NAIROBI.lon });
    expect(await fails(as(ON, `select public.attendance_set_branch_location($1, 0, 0)`, [nairobi]))).toMatch(/Only HR/);
    expect(await fails(as(ADMIN_B, `select public.attendance_set_branch_location($1, 0, 0)`, [nairobi]))).toMatch(/Unknown branch/);
    expect(await fails(as(HR, `select public.attendance_set_branch_location($1, 95, 0)`, [nairobi]))).toMatch(/latitude from -90/);
  });
});

describe('policy × arrangement', () => {
  it('anywhere: allowed for everyone; tagged office on the office network or near the branch, else remote', async () => {
    await setPolicy('anywhere');
    expect(await check('A-ON', { ip: '41.90.12.7' })).toMatchObject({ ok: true, place: 'office', detail: 'Office network' });
    expect(await check('A-ON', { loc: NEAR })).toMatchObject({ ok: true, place: 'office', detail: expect.stringMatching(/^Near Nairobi \(\d+ m\)$/) });
    expect(await check('A-ON', { loc: FAR })).toMatchObject({ ok: true, place: 'remote' });
    expect(await check('A-RE', { loc: FAR })).toMatchObject({ ok: true, place: 'remote' });
    expect(await check('A-FI')).toMatchObject({ ok: true, place: 'field', detail: 'No location' });
  });

  it('office: on site needs an office network (address or range) or to be near a branch', async () => {
    await setPolicy('office');
    expect(await check('A-ON', { ip: '41.90.12.7' })).toMatchObject({ ok: true, place: 'office', detail: 'Office network' });
    expect(await check('A-ON', { ip: '102.68.0.200' })).toMatchObject({ ok: true, place: 'office' });
    expect(await check('A-ON', { ip: '41.90.12.8', loc: NEAR })).toMatchObject({ ok: true, place: 'office', detail: expect.stringMatching(/^Near Nairobi/) });
    expect(await check('A-ON', { ip: '41.90.12.8' })).toMatchObject({ ok: false, message: 'Turn on location to clock in on site' });
    expect(await check('A-ON', { loc: FAR })).toMatchObject({ ok: false, message: expect.stringMatching(/^Clock in from the office, or ask HR\. You're \d+\.\d km from Nairobi\.$/) });
    // a poor reading doesn't stretch the radius past 100 m more
    expect((await check('A-ON', { loc: { ...NEAR, latitude: -1.2864 + 0.0045, accuracy: 5000 } })).ok).toBe(false);
  });

  it('office: remote and field from anywhere; field without a location is still taken, noted', async () => {
    expect(await check('A-RE', { loc: FAR })).toMatchObject({ ok: true, place: 'remote' });
    expect(await check('A-FI', { loc: FAR })).toEqual({ ok: true, place: 'field', detail: null, message: null });
    expect(await check('A-FI')).toEqual({ ok: true, place: 'field', detail: 'No location', message: null });
  });

  it('hybrid: from anywhere on the remote weekdays, the policy on the others', async () => {
    await setArrangement('A-HY', 'hybrid', [3]);
    expect(await check('A-HY', { at: WED, loc: FAR })).toMatchObject({ ok: true, place: 'remote', detail: 'Remote day' });
    expect(await check('A-HY', { at: THU, loc: FAR })).toMatchObject({ ok: false, message: expect.stringMatching(/^Clock in from the office/) });
    expect(await check('A-HY', { at: THU, ip: '41.90.12.7' })).toMatchObject({ ok: true, place: 'office' });
  });

  it('scanner only: the app is refused for on site (and hybrid office days); remote, field and remote days still allowed', async () => {
    await setPolicy('scanner_only');
    expect(await check('A-ON', { ip: '41.90.12.7', loc: NEAR })).toMatchObject({ ok: false, message: 'Clock in at the office scanner' });
    expect(await check('A-HY', { at: THU, ip: '41.90.12.7' })).toMatchObject({ ok: false, message: 'Clock in at the office scanner' });
    expect(await check('A-HY', { at: WED })).toMatchObject({ ok: true, place: 'remote' });
    expect(await check('A-RE')).toMatchObject({ ok: true, place: 'remote' });
    expect(await check('A-FI', { loc: FAR })).toMatchObject({ ok: true, place: 'field' });
  });

  it('no offices listed under office: "Clock in from the office, or ask HR"', async () => {
    const c = '00000000-0000-0000-0000-0000000000c3';
    await db.exec(`insert into tenants (id, name, slug) values ('${c}', 'C Co', 'c-co');
      insert into attendance_settings (tenant_id, tracking_from, clock_in_policy) values ('${c}', '2025-01-01', 'office');
      insert into employees ("Employee Number", "First Name", "Status", tenant_id) values ('C-1', 'Ci', 'Active', '${c}');`);
    const r = (await rows<{ c: Check }>(`select public.attendance_clock_check($1, 'C-1', 'in', null, '41.90.12.7', now()) as c`, [c]))[0].c;
    expect(r).toMatchObject({ ok: false, message: 'Clock in from the office, or ask HR' });
  });
});

describe('enforced when clocking in and out', () => {
  it('a refusal is raised with the reason (hint clock_policy) and nothing is recorded', async () => {
    await setPolicy('office');
    expect(await fails(appPunch('A-ON', 'in', '2026-10-13T05:00:00Z', FAR))).toMatch(/^Clock in from the office, or ask HR/);
    const err = await db.query(`select public.attendance_app_punch($1, 'A-ON', 'in', null, null, '2026-10-13T05:00:00Z')`, [A]).catch((e) => e);
    expect(err.hint).toBe('clock_policy');
    expect(await record('A-ON', '2026-10-13')).toBeUndefined();
  });

  it('the place is stored with the clock-in: office, remote, field with its location, field with none', async () => {
    await appPunch('A-ON', 'in', '2026-10-14T05:00:00Z', null, '41.90.12.7');
    expect(await record('A-ON', '2026-10-14')).toMatchObject({ place: 'office', place_detail: 'Office network', source: 'app' });
    await appPunch('A-RE', 'in', '2026-10-14T05:00:00Z');
    expect(await record('A-RE', '2026-10-14')).toMatchObject({ place: 'remote', place_detail: null });
    await appPunch('A-FI', 'in', '2026-10-14T05:00:00Z', FAR);
    expect(await record('A-FI', '2026-10-14')).toMatchObject({ place: 'field', place_detail: null, geolocation: { in: FAR } });
    await appPunch('A-FI', 'in', '2026-10-15T05:00:00Z');
    expect(await record('A-FI', '2026-10-15')).toMatchObject({ place: 'field', place_detail: 'No location' });
    // HR's day view shows it
    const [d] = await as<Record<string, unknown>>(HR, `select place, place_detail, place_location, clock_out_via from public.attendance_days('2026-10-14', '2026-10-14', 'A-FI')`);
    expect(d).toEqual({ place: 'field', place_detail: null, place_location: FAR, clock_out_via: null });
  });

  it('clock-out: the same rule, but a day clocked in from away always clocks out', async () => {
    // on site clocked in at the office: away from it, the clock-out is refused; at the office it goes through
    expect(await fails(appPunch('A-ON', 'out', '2026-10-14T14:00:00Z', FAR))).toMatch(/^Clock out from the office, or ask HR/);
    await appPunch('A-ON', 'out', '2026-10-14T14:00:00Z', NEAR);
    // field and remote clock out from anywhere, even with the policy now scanner only
    await setPolicy('scanner_only');
    await appPunch('A-FI', 'out', '2026-10-14T14:00:00Z', FAR);
    await appPunch('A-RE', 'out', '2026-10-14T14:00:00Z');
    // a hybrid person who clocked in on their remote Wednesday clocks out from anywhere
    await appPunch('A-HY', 'in', WED);
    await setArrangement('A-HY', 'hybrid', [5]);
    await appPunch('A-HY', 'out', '2026-10-21T14:00:00Z');
    await setArrangement('A-HY', 'hybrid', [3]);
    const outs = await rows<{ e: string; out: string | null }>(
      `select employee_number e, logout_time::text as out from attendance_logs where tenant_id = $1 and work_date in ('2026-10-14', '2026-10-21') order by 1`, [A]);
    expect(outs.every((o) => o.out !== null)).toBe(true);
  });

  it('switched to scanner only after an app clock-in at the office: clocks out from the office, not from away', async () => {
    await setPolicy('office');
    await appPunch('A-ON', 'in', '2026-10-16T05:00:00Z', null, '41.90.12.7');
    await setPolicy('scanner_only');
    expect(await fails(appPunch('A-ON', 'out', '2026-10-16T14:00:00Z', FAR))).toMatch(/^Clock out from the office/);
    await appPunch('A-ON', 'out', '2026-10-16T14:00:00Z', null, '41.90.12.7');
    expect((await rows(`select logout_time is not null as out from attendance_logs where employee_number = 'A-ON' and work_date = '2026-10-16'`))[0].out).toBe(true);
  });

  it('scanner only: scanner punches still work, and the app can’t clock out a scanner day', async () => {
    const dev = (await rows<{ id: string }>(`insert into attendance_devices (tenant_id, name, serial_number) values ($1, 'Front door', 'FIG1200A') returning id`, [A]))[0].id;
    const punch = async (at: string) => {
      const id = (await rows<{ id: string }>(
        `insert into attendance_scanner_punches (tenant_id, device_id, scanner_user_id, punched_at, employee_number) values ($1, $2, '2', $3, 'A-ON') returning id`,
        [A, dev, at]))[0].id;
      await rows(`select public.attendance_scanner_apply($1)`, [id]);
    };
    await punch('2026-10-19T04:55:00Z');
    await punch('2026-10-19T11:48:00Z');
    expect(await record('A-ON', '2026-10-19')).toMatchObject({ source: 'scanner', place: null });
    expect(await fails(appPunch('A-ON', 'out', '2026-10-19T14:00:00Z', NEAR, '41.90.12.7'))).toBe('Clock out at the office scanner');
    const [d] = await rows<Record<string, unknown>>(
      `select to_char(clock_out at time zone 'Africa/Nairobi', 'HH24:MI') as out, clock_out_via, end_time::text, place from public.attendance_days_for($1, '2026-10-19', '2026-10-19', 'A-ON', '2026-10-22')`, [A]);
    expect(d).toEqual({ out: '14:48', clock_out_via: 'scanner', end_time: '17:00:00', place: null });
  });

  it('an app Clock out after the scanner’s last scan moves the clock-out later; the day says app', async () => {
    await setPolicy('anywhere');
    await appPunch('A-ON', 'out', '2026-10-19T14:05:00Z');
    const [d] = await rows<Record<string, unknown>>(
      `select to_char(clock_out at time zone 'Africa/Nairobi', 'HH24:MI') as out, clock_out_via from public.attendance_days_for($1, '2026-10-19', '2026-10-19', 'A-ON', '2026-10-22')`, [A]);
    expect(d).toEqual({ out: '17:05', clock_out_via: 'app' });
  });

  it('HR corrections are unaffected by the policy, and say hr', async () => {
    await setPolicy('scanner_only');
    await as(HR, `select public.attendance_set_day('A-ON', '2026-10-20', '2026-10-20T05:00:00Z', '2026-10-20T14:00:00Z', 'At a client')`);
    const [d] = await rows<Record<string, unknown>>(
      `select source, clock_out_via, place from public.attendance_days_for($1, '2026-10-20', '2026-10-20', 'A-ON', '2026-10-22')`, [A]);
    expect(d).toEqual({ source: 'hr', clock_out_via: 'hr', place: null });
  });
});

describe('the signed-in person and the backend', () => {
  it('attendance_clock_in (no address) is refused by scanner only; the card is told why', async () => {
    await setPolicy('scanner_only');
    expect(await fails(as(ON, `select public.attendance_clock_in('{"latitude": -1.287, "longitude": 36.8175}')`))).toBe('Clock in at the office scanner');
    expect((await as<{ r: Record<string, unknown> }>(ON, `select public.attendance_my_clock_rules() as r`))[0].r)
      .toMatchObject({ policy: 'scanner_only', arrangement: 'on_site', mode: 'scanner', wants_location: false });
    expect((await as<{ r: Record<string, unknown> }>(FI, `select public.attendance_my_clock_rules() as r`))[0].r)
      .toMatchObject({ arrangement: 'field', mode: 'anywhere', wants_location: true });
    const t = (await as<{ t: Record<string, unknown> }>(FI, `select public.attendance_clock_in() as t`))[0].t;
    expect(t).toMatchObject({ place: 'field', place_detail: 'No location', end_time: '17:00' });
  });

  it('office policy from the browser: only the branch-location route (its own address is never known)', async () => {
    await setPolicy('office');
    await db.query(`delete from attendance_logs where employee_number = 'A-ON' and work_date = (now() at time zone 'Africa/Nairobi')::date`);
    expect(await fails(as(ON, `select public.attendance_clock_in()`))).toBe('Turn on location to clock in on site');
    const t = (await as<{ t: Record<string, unknown> }>(ON, `select public.attendance_clock_in($1) as t`, [JSON.stringify(NEAR)]))[0].t;
    expect(t).toMatchObject({ place: 'office' });
  });

  it('the backend’s function takes the address, is service_role only, and finds the person from their login', async () => {
    await db.query(`delete from attendance_logs where employee_number = 'A-HY' and work_date = (now() at time zone 'Africa/Nairobi')::date`);
    await setArrangement('A-HY', 'on_site');
    const t = (await asService(() => rows<{ t: Record<string, unknown> }>(`select public.attendance_clock_for_user($1, 'in', null, '102.68.0.44') as t`, [HY])))[0].t;
    expect(t).toMatchObject({ employee_number: 'A-HY', place: 'office', place_detail: 'Office network' });
    expect(await fails(asService(() => rows(`select public.attendance_clock_for_user($1, 'in', null, '8.8.8.8')`, [HR]))))
      .toMatch(/^Turn on location/);
    expect(await fails(as(HY, `select public.attendance_clock_for_user($1, 'in', null, '41.90.12.7')`, [HY]))).toMatch(/permission denied/);
    expect(await fails(asAnon(db, () => rows(`select public.attendance_clock_for_user($1, 'in', null, '41.90.12.7')`, [HY])))).toMatch(/permission denied/);
    expect(await fails(as(HY, `select public.attendance_clock_check($1, 'A-HY', 'in', null, '41.90.12.7', now())`, [A]))).toMatch(/permission denied/);
    expect(await fails(as(HY, `select public.attendance_app_punch($1, 'A-HY', 'in', null, '41.90.12.7', now())`, [A]))).toMatch(/permission denied/);
    expect(await fails(asService(() => rows(`select public.attendance_clock_for_user(gen_random_uuid(), 'in', null, '41.90.12.7')`)))).toMatch(/Sign in first/);
  });
});

describe('only HR sets the policy and arrangements', () => {
  it('staff can’t change the policy or their own arrangement; HR can; hybrid needs its days', async () => {
    await as(ON, `update attendance_settings set clock_in_policy = 'anywhere'`);
    expect((await rows(`select clock_in_policy from attendance_settings where tenant_id = $1`, [A]))[0].clock_in_policy).toBe('office');
    expect(await fails(as(ON, `update employees set work_arrangement = 'remote' where "Employee Number" = 'A-ON'`)))
      .toMatch(/^$|Only HR can change a work arrangement|only change your own personal details|row-level security|permission denied/);
    expect((await rows(`select work_arrangement from employees where "Employee Number" = 'A-ON'`))[0].work_arrangement).toBe('on_site');
    await as(HR, `update employees set work_arrangement = 'hybrid', remote_days = '{5,1,1}' where "Employee Number" = 'A-ON'`);
    expect((await rows(`select work_arrangement, remote_days from employees where "Employee Number" = 'A-ON'`))[0])
      .toEqual({ work_arrangement: 'hybrid', remote_days: [1, 5] });
    expect(await fails(as(HR, `update employees set remote_days = '{}' where "Employee Number" = 'A-ON'`))).toMatch(/Choose the days/);
    expect(await fails(as(HR, `update employees set work_arrangement = 'beach' where "Employee Number" = 'A-ON'`))).toMatch(/work_arrangement_check/);
    // leaving hybrid clears the days
    await as(HR, `update employees set work_arrangement = 'on_site' where "Employee Number" = 'A-ON'`);
    expect((await rows(`select remote_days from employees where "Employee Number" = 'A-ON'`))[0].remote_days).toEqual([]);
    await as(HR, `update attendance_settings set clock_in_policy = 'scanner_only'`);
    expect(await fails(as(HR, `update attendance_settings set clock_in_policy = 'nowhere'`))).toMatch(/clock_in_policy_check/);
  });

  it('an edit that leaves the arrangement alone saves as before', async () => {
    const before = await rows(`select work_arrangement from employees where "Employee Number" = 'A-FI'`);
    await as(HR, `update employees set "Mobile Number" = '0712345678' where "Employee Number" = 'A-FI'`);
    expect(await rows(`select work_arrangement from employees where "Employee Number" = 'A-FI'`)).toEqual(before);
  });
});

describe('companies are kept apart', () => {
  it('another company reads none of A’s settings, can’t change A’s, and A’s policy doesn’t apply to it', async () => {
    expect(await as(ADMIN_B, `select clock_in_policy from attendance_settings`)).toEqual([{ clock_in_policy: 'anywhere' }]);
    await as(ADMIN_B, `update attendance_settings set clock_in_policy = 'anywhere' where tenant_id = $1`, [A]);
    expect((await rows(`select clock_in_policy from attendance_settings where tenant_id = $1`, [A]))[0].clock_in_policy).toBe('scanner_only');
    const t = (await as<{ t: Record<string, unknown> }>(ADMIN_B, `select public.attendance_clock_in() as t`))[0].t;
    expect(t).toMatchObject({ employee_number: 'B-1', place: null });
    expect(await as(ADMIN_B, `select place from attendance_logs where tenant_id = $1`, [A])).toEqual([]);
  });
});

describe('the migration', () => {
  it('can run again without changing anything', async () => {
    const snapshot = async () => ({
      settings: await rows(`select tenant_id, clock_in_policy, office_networks, office_radius_m from attendance_settings order by tenant_id`),
      employees: await rows(`select "Employee Number", work_arrangement, remote_days from employees order by 1`),
      branches: await rows(`select id, latitude, longitude from branches order by id`),
      logs: await rows(`select id, place, place_detail, logout_time::text from attendance_logs order by id`),
    });
    const before = await snapshot();
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    await db.exec('reset search_path');
    expect(await snapshot()).toEqual(before);
    expect((await check('A-FI')).place).toBe('field');
  });
});
