// @vitest-environment node
//
// Figbloom Property + HR (20261124100000_platform_property_hr.sql, ERP/PROPERTY_HR_CONTRACT.md section 2): Property
// takes Fleet's place, product id 'property'.
//   platform_enable_hr(..., 'property')   the company remembers its product; leave chain Leave Approver, then
//                                         "Property manager" (HR's ADMIN role)
//   platform_upsert_staff('property')     a draft employee per property manager or caretaker, mapped with source 'property'
//   a company switched on without a hint takes the product of the first staff event (and that product's chain)
//   platform_staff_left('property')       HR's exit, in Property's words
//   hr.employee.left / hr.leave.*         queued for Property people too, data.source 'property'
//   my_hr_person / my_hr_approver         resolve the calling product's people only
//   Fleet and Schools are unchanged
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bootLiveDb } from './db';

const PT_PROPERTY = '6b2d3b5f-4c8e-4d2f-8b66-3e9f1f8cad50';
const PT_GUESS = '6b2d3b5f-4c8e-4d2f-8b66-3e9f1f8cad51'; // switched on with no hint: starts as schools
const PT_FLEET = '6b2d3b5f-4c8e-4d2f-8b66-3e9f1f8cad52';
const OWNER = '00000000-0000-0000-0000-00000000f201';
// Property's person ids are User.id uuids
const CARETAKER = 'a1b2c3d4-0000-4000-8000-000000000001';
const MANAGER = 'a1b2c3d4-0000-4000-8000-000000000002';
const CREATOR = 'a1b2c3d4-0000-4000-8000-000000000003';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the functions' JSON answers
type J = any;

let db: PGlite;
let property: string;
let guess: string;
let fleet: string;
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
  property = await enable(PT_PROPERTY, 'Kilimani Homes', 'property');
  guess = await enable(PT_GUESS, 'Guessed Lettings');
  fleet = await enable(PT_FLEET, 'Swift Haulage Ltd', 'fleet');
}, 180000);

describe('platform.module.enabled for a Property workspace', () => {
  it('remembers the product and gives the Property leave chain: Leave Approver, then Property manager', async () => {
    expect(await source(property)).toBe('property');
    expect(await steps(property)).toEqual([['leave_approver', null, null], ['role', 'ADMIN', 'Property manager']]);
  });
  it('Fleet is unchanged: Company admin', async () => {
    expect(await source(fleet)).toBe('fleet');
    expect(await steps(fleet)).toEqual([['leave_approver', null, null], ['role', 'ADMIN', 'Company admin']]);
  });
  it('platform_sources() names all three products', async () => {
    expect((await rows<{ s: string[] }>(`select platform_sources() s`))[0].s).toEqual(['schools', 'fleet', 'property']);
  });
  it('platform_leave_chain() is a no-op on the right chain', async () => {
    expect((await rows<{ v: J }>(`select platform_leave_chain($1) v`, [property]))[0].v).toMatchObject({ chain: 'already_set', source: 'property' });
  });
});

describe('property.staff.*', () => {
  it('a caretaker becomes a draft employee mapped with source property', async () => {
    const r = await upsert(PT_PROPERTY, 'property', CARETAKER, 'Cate', 'Caretaker', 'Caretaker, Riverside Court');
    expect(r.created).toBe(true);
    expect(await rows(`select source, external_id from external_people where tenant_id = $1`, [property]))
      .toEqual([{ source: 'property', external_id: CARETAKER }]);
    expect(await rows(`select onboarding_status, "Job Title" t from employees where tenant_id = $1 and "Employee Number" = $2`, [property, r.employee_number]))
      .toEqual([{ onboarding_status: 'draft', t: 'Caretaker, Riverside Court' }]);
    expect((await upsert(PT_PROPERTY, 'property', CARETAKER, 'Catherine', 'Caretaker')).created).toBe(false);
  });
  it('a property manager too', async () => {
    expect((await upsert(PT_PROPERTY, 'property', MANAGER, 'Mary', 'Manager', 'Property manager')).created).toBe(true);
  });
  it('a company switched on without a hint takes Property from its first Property person, with the Property chain', async () => {
    expect(await source(guess)).toBe('schools');
    await upsert(PT_GUESS, 'property', 'a1b2c3d4-0000-4000-8000-0000000000aa', 'Gina', 'Guess');
    expect(await source(guess)).toBe('property');
    expect(await steps(guess)).toEqual([['leave_approver', null, null], ['role', 'ADMIN', 'Property manager']]);
  });
  it('left: HR\'s exit starts, in Property\'s words', async () => {
    const [r] = await rows<{ employee_number: string; outcome: string }>(`select * from platform_staff_left($1, 'property', $2, '2026-11-20')`, [PT_PROPERTY, CARETAKER]);
    expect(r.outcome).toBe('exit_started');
    expect(await rows(`select reason from employee_exits where tenant_id = $1`, [property]))
      .toEqual([{ reason: 'Left the workspace in Figbloom Property on 20 Nov 2026' }]);
    expect(await rows(`select outcome from platform_staff_left($1, 'fleet', $2, null)`, [PT_PROPERTY, CARETAKER])).toEqual([{ outcome: 'unknown' }]);
  });
  it('Fleet\'s words are unchanged', async () => {
    await upsert(PT_FLEET, 'fleet', 'ckdriver0009', 'Dan', 'Driver');
    await rows(`select * from platform_staff_left($1, 'fleet', 'ckdriver0009', '2026-11-10')`, [PT_FLEET]);
    expect(await rows(`select reason from employee_exits where tenant_id = $1`, [fleet])).toEqual([{ reason: 'Left the company in Figbloom Fleet on 10 Nov 2026' }]);
  });
});

describe('events back to Property', () => {
  it('hr.employee.left carries the Property person and source property', async () => {
    const [{ id, n }] = await rows<{ id: string; n: string }>(`select id, employee_number n from employee_exits where tenant_id = $1`, [property]);
    await db.query(`update employee_exits set status = 'approved' where id = $1`, [id]);
    await db.query(`select end_exit_access($1)`, [id]);
    expect(await rows(`select event_type, dedupe_key, data from platform_event_outbox where tenant_id = $1`, [property])).toEqual([
      { event_type: 'hr.employee.left', dedupe_key: `${id}:property`, data: { employee_number: n, external_id: CARETAKER, source: 'property', left_on: '2026-11-20' } },
    ]);
  });
  it('approved leave of a Property person is hr.leave.approved with source property', async () => {
    const [{ n }] = await rows<{ n: string }>(`select employee_number n from external_people where tenant_id = $1 and external_id = $2`, [property, MANAGER]);
    await db.query(`update employees set onboarding_status = 'approved', "Start Date" = '2024-01-01' where tenant_id = $1 and "Employee Number" = $2`, [property, n]);
    const [{ id }] = await rows<{ id: string }>(
      `insert into leave_application (tenant_id, "Employee Number", name, "Leave Type", "Start Date", "End Date", days, type, reason, status, time_added)
       values ($1, $2, 'Mary Manager', 'Annual Leave', '2026-12-01', '2026-12-01', 1, 'Full Day', 'Family matters', 'approved', now()) returning id`, [property, n]);
    const out = await rows<{ event_type: string; data: J }>(
      `select event_type, data from platform_event_outbox where tenant_id = $1 and data ->> 'application_id' = $2`, [property, id]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ event_type: 'hr.leave.approved', data: { external_id: MANAGER, source: 'property', status: 'approved' } });
  });
});

describe('My HR resolves the calling product\'s people', () => {
  it('my_hr_person: property finds the Property person, fleet does not', async () => {
    expect(await rows(`select outcome from my_hr_person($1, $2, $3, 'property')`, [property, PT_PROPERTY, MANAGER])).toEqual([{ outcome: 'found' }]);
    expect(await rows(`select outcome from my_hr_person($1, $2, $3, 'fleet')`, [property, PT_PROPERTY, MANAGER])).toEqual([{ outcome: 'not_linked' }]);
  });
  it('my_hr_approver: only the product\'s own link (the creator, HR\'s admin)', async () => {
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@kilimani.co.ke');
      insert into memberships (user_id, tenant_id, role, account_status) values ('${OWNER}', '${property}', 'ADMIN', 'ACTIVE');
      insert into external_logins (tenant_id, source, external_id, user_id) values ('${property}', 'property', '${CREATOR}', '${OWNER}')`);
    expect(await rows(`select outcome, user_id from my_hr_approver($1, $2, $3, 'property')`, [property, PT_PROPERTY, CREATOR]))
      .toEqual([{ outcome: 'found', user_id: OWNER }]);
    expect(await rows(`select outcome from my_hr_approver($1, $2, $3)`, [property, PT_PROPERTY, CREATOR])).toEqual([{ outcome: 'not_linked' }]);
  });
  it('my_hr_leave_import labels leave from Property', async () => {
    const v = (await rows<{ v: J }>(`select my_hr_leave_import($1, $2, $3::jsonb, true, 'property') v`, [property, PT_PROPERTY,
      JSON.stringify([{ source_id: 'l-1', external_id: MANAGER, leave_type_name: 'Sabbatical', start_date: '2026-12-10', end_date: '2026-12-10', days: 1, status: 'approved' }])]))[0].v;
    expect(v.results[0]).toMatchObject({ outcome: 'would_import', leave_type: 'Imported from Property', type_mapped: true });
  });
});
