// @vitest-environment node
//
// Figbloom Fleet + HR (20261112100000_platform_fleet_hr.sql, ERP/FLEET_HR_CONTRACT.md section 2): Fleet takes Schools'
// place, product id 'fleet'.
//   platform_enable_hr(..., 'fleet')   the company remembers its product; leave chain Leave Approver, then Company admin
//   platform_upsert_staff('fleet')     a draft employee per Fleet person, mapped with source 'fleet'
//   a company switched on without a hint takes the product of the first staff event (and that product's chain)
//   platform_staff_left('fleet')       HR's exit, in Fleet's words
//   hr.employee.left / hr.leave.*      queued for Fleet people too, data.source 'fleet'
//   my_hr_person / my_hr_approver      resolve the calling product's people only
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bootLiveDb } from './db';

const PT_FLEET = '5a1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c40';
const PT_GUESS = '5a1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c41'; // switched on with no hint: starts as schools
const PT_SCHOOL = '5a1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c42';
const OWNER = '00000000-0000-0000-0000-00000000f101';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the functions' JSON answers
type J = any;

let db: PGlite;
let fleet: string;
let guess: string;
let school: string;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const enable = async (pt: string, name: string, source?: string) =>
  (await rows<{ tenant_id: string }>(
    source ? `select tenant_id from platform_enable_hr($1, $2, null, '[]'::jsonb, $3)` : `select tenant_id from platform_enable_hr($1, $2, null, '[]'::jsonb)`,
    source ? [pt, name, source] : [pt, name]))[0].tenant_id;
const upsert = async (pt: string, source: string, person: string, first: string, last: string | null = null, title: string | null = null) =>
  (await rows<{ employee_number: string; created: boolean }>(
    `select * from platform_upsert_staff($1, $2, $3, $4, null, $5, null, null, $6)`, [pt, source, person, first, last, title]))[0];
const steps = async (tenant: string) =>
  (await rows<{ approver_type: string; approver_role: string | null; label: string | null }>(
    `select s.approver_type, s.approver_role, s.label from approval_steps s join approval_workflows w on w.id = s.workflow_id
     where w.tenant_id = $1 and w.kind = 'leave' order by s.position`, [tenant])).map((s) => [s.approver_type, s.approver_role, s.label]);
const source = async (tenant: string) => (await rows<{ s: string | null }>(`select platform_source s from tenants where id = $1`, [tenant]))[0].s;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`delete from holidays where source = 'auto'`);
  fleet = await enable(PT_FLEET, 'Swift Haulage Ltd', 'fleet');
  guess = await enable(PT_GUESS, 'Guessed Logistics');
  school = await enable(PT_SCHOOL, 'Hillside Primary');
}, 180000);

describe('platform.module.enabled for a Fleet company', () => {
  it('remembers the product and gives the Fleet leave chain: Leave Approver, then Company admin', async () => {
    expect(await source(fleet)).toBe('fleet');
    expect(await steps(fleet)).toEqual([['leave_approver', null, null], ['role', 'ADMIN', 'Company admin']]);
  });
  it('a school is unchanged: School admin', async () => {
    expect(await source(school)).toBe('schools');
    expect(await steps(school)).toEqual([['leave_approver', null, null], ['role', 'ADMIN', 'School admin']]);
  });
  it('an unknown product is treated as Schools, as before', async () => {
    const t = await enable('5a1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c49', 'Odd One', 'nope');
    expect(await source(t)).toBe('schools');
  });
  it('platform_leave_chain() is a no-op on the right chain', async () => {
    expect((await rows<{ v: J }>(`select platform_leave_chain($1) v`, [fleet]))[0].v).toMatchObject({ chain: 'already_set', source: 'fleet' });
  });
});

describe('fleet.staff.*', () => {
  it('a driver becomes a draft employee mapped with source fleet', async () => {
    const r = await upsert(PT_FLEET, 'fleet', 'ckdriver0001', 'Dan', 'Driver', 'Driver');
    expect(r.created).toBe(true);
    expect(await rows(`select source, external_id from external_people where tenant_id = $1`, [fleet]))
      .toEqual([{ source: 'fleet', external_id: 'ckdriver0001' }]);
    expect(await rows(`select onboarding_status, "Job Title" t from employees where tenant_id = $1 and "Employee Number" = $2`, [fleet, r.employee_number]))
      .toEqual([{ onboarding_status: 'draft', t: 'Driver' }]);
    expect((await upsert(PT_FLEET, 'fleet', 'ckdriver0001', 'Daniel', 'Driver')).created).toBe(false);
  });
  it('an unknown product is refused', async () => {
    await expect(upsert(PT_FLEET, 'crm', 'x', 'X')).rejects.toMatchObject({ code: '22023' });
  });
  it('a company switched on without a hint takes Fleet from its first Fleet person, with the Fleet chain', async () => {
    expect(await source(guess)).toBe('schools');
    await upsert(PT_GUESS, 'fleet', 'ckops0001', 'Olive', 'Operator');
    expect(await source(guess)).toBe('fleet');
    expect(await steps(guess)).toEqual([['leave_approver', null, null], ['role', 'ADMIN', 'Company admin']]);
  });
  it('a school with Schools people keeps its product', async () => {
    await upsert(PT_SCHOOL, 'schools', 'person-1', 'Tina', 'Teacher');
    await upsert(PT_SCHOOL, 'fleet', 'ckbus0001', 'Ben', 'Bus');
    expect(await source(school)).toBe('schools');
  });
  it('left: HR\'s exit starts, in Fleet\'s words', async () => {
    const [r] = await rows<{ employee_number: string; outcome: string }>(`select * from platform_staff_left($1, 'fleet', 'ckdriver0001', '2026-11-10')`, [PT_FLEET]);
    expect(r.outcome).toBe('exit_started');
    expect(await rows(`select reason from employee_exits where tenant_id = $1`, [fleet])).toEqual([{ reason: 'Left the company in Figbloom Fleet on 10 Nov 2026' }]);
    expect(await rows(`select outcome from platform_staff_left($1, 'schools', 'ckdriver0001', null)`, [PT_FLEET])).toEqual([{ outcome: 'unknown' }]);
  });
});

describe('events back to Fleet', () => {
  it('hr.employee.left carries the Fleet person and source fleet', async () => {
    const [{ id, n }] = await rows<{ id: string; n: string }>(`select id, employee_number n from employee_exits where tenant_id = $1`, [fleet]);
    await db.query(`update employee_exits set status = 'approved' where id = $1`, [id]);
    await db.query(`select end_exit_access($1)`, [id]);
    expect(await rows(`select event_type, dedupe_key, data from platform_event_outbox where tenant_id = $1`, [fleet])).toEqual([
      { event_type: 'hr.employee.left', dedupe_key: `${id}:fleet`, data: { employee_number: n, external_id: 'ckdriver0001', source: 'fleet', left_on: '2026-11-10' } },
    ]);
  });
  it('approved leave of a Fleet person is hr.leave.approved with source fleet', async () => {
    const { employee_number: n } = await upsert(PT_FLEET, 'fleet', 'ckmech0001', 'Mo', 'Mechanic');
    await db.query(`update employees set onboarding_status = 'approved', "Start Date" = '2024-01-01' where tenant_id = $1 and "Employee Number" = $2`, [fleet, n]);
    const [{ id }] = await rows<{ id: string }>(
      `insert into leave_application (tenant_id, "Employee Number", name, "Leave Type", "Start Date", "End Date", days, type, reason, status, time_added)
       values ($1, $2, 'Mo Mechanic', 'Annual Leave', '2026-12-01', '2026-12-01', 1, 'Full Day', 'Family matters', 'approved', now()) returning id`, [fleet, n]);
    const out = await rows<{ event_type: string; data: J }>(
      `select event_type, data from platform_event_outbox where tenant_id = $1 and data ->> 'application_id' = $2`, [fleet, id]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ event_type: 'hr.leave.approved', data: { external_id: 'ckmech0001', source: 'fleet', status: 'approved' } });
  });
});

describe('My HR resolves the calling product\'s people', () => {
  it('my_hr_person: fleet finds the Fleet person, schools does not', async () => {
    const found = await rows(`select outcome from my_hr_person($1, $2, 'ckmech0001', 'fleet')`, [fleet, PT_FLEET]);
    expect(found).toEqual([{ outcome: 'found' }]);
    expect(await rows(`select outcome from my_hr_person($1, $2, 'ckmech0001')`, [fleet, PT_FLEET])).toEqual([{ outcome: 'not_linked' }]);
  });
  it('my_hr_approver: only the product\'s own link', async () => {
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@swift.co.ke');
      insert into memberships (user_id, tenant_id, role, account_status) values ('${OWNER}', '${fleet}', 'ADMIN', 'ACTIVE');
      insert into external_logins (tenant_id, source, external_id, user_id) values ('${fleet}', 'fleet', 'ckowner0001', '${OWNER}')`);
    expect(await rows(`select outcome, user_id from my_hr_approver($1, $2, 'ckowner0001', 'fleet')`, [fleet, PT_FLEET]))
      .toEqual([{ outcome: 'found', user_id: OWNER }]);
    expect(await rows(`select outcome from my_hr_approver($1, $2, 'ckowner0001')`, [fleet, PT_FLEET])).toEqual([{ outcome: 'not_linked' }]);
  });
});
