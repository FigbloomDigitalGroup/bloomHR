// @vitest-environment node
//
// Figbloom Schools + HR, phase 1 (20261105100000): the functions the backend calls for the platform's events.
//   platform_enable_hr()             one active HR company per platform tenant, its admins queued for ADMIN invitations
//   platform_upsert_school_staff()   a draft employee per Schools person (HR's numbering), mapped in external_people,
//                                    never matched by email
//   platform_school_staff_left()     HR's exit flow for them
//   an exit ending a mapped employee's employment queues hr.employee.left once
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const PT = '7a1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c10'; // a school on the platform
const PT2 = '8b2c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c11';
const HR_USER = '00000000-0000-0000-0000-00000000e901';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

type Company = { tenant_id: string; slug: string; name: string; created: boolean; invited: number };
const enable = async (pt: string, name: string, slug: string | null, admins: unknown[]) =>
  (await rows<Company>(`select * from platform_enable_hr($1, $2, $3, $4::jsonb)`, [pt, name, slug, JSON.stringify(admins)]))[0];

type Upserted = { employee_number: string; created: boolean };
const upsert = async (pt: string, person: string, p: Partial<Record<'first' | 'middle' | 'last' | 'phone' | 'email' | 'title', string | null>>) =>
  (await rows<Upserted>(`select * from platform_upsert_school_staff($1, $2, $3, $4, $5, $6, $7, $8)`, [
    pt, person, p.first ?? null, p.middle ?? null, p.last ?? null, p.phone ?? null, p.email ?? null, p.title ?? null,
  ]))[0];

let company: Company;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into role_permissions (role_name, permissions, tenant_id) values
    ('ADMIN', array['dashboard', 'employees'], '00000000-0000-0000-0000-000000000001'),
    ('STAFF', array['dashboard'], '00000000-0000-0000-0000-000000000001')`);
  company = await enable(PT, 'Hillside Primary School', 'hillside-primary', [
    { email: 'Head@Hillside.ac.ke', name: 'Head', role: 'school_admin' },
    { email: 'not an email' },
    { email: 'bursar@hillside.ac.ke' },
  ]);
}, 120000);

describe('platform.module.enabled: the school\'s HR company', () => {
  it('creates an active company for the platform tenant, with the school\'s address, roles, channel and leave types', async () => {
    expect(company).toMatchObject({ slug: 'hillside-primary', name: 'Hillside Primary School', created: true, invited: 2 });
    const [t] = await rows(`select status, platform_tenant_id, plan from tenants where id = $1`, [company.tenant_id]);
    expect(t).toEqual({ status: 'active', platform_tenant_id: PT, plan: 'trial' });
    expect((await rows(`select 1 from role_permissions where tenant_id = $1`, [company.tenant_id])).length).toBeGreaterThan(0);
    expect(await rows(`select name from channels where tenant_id = $1 and is_default`, [company.tenant_id])).toEqual([{ name: 'general' }]);
  });

  it('queues an ADMIN invitation for each valid admin email, from the platform (no sender)', async () => {
    const q = await rows(`select email, role, requested_by, via_platform, status from invite_queue where tenant_id = $1 order by email`, [company.tenant_id]);
    expect(q).toEqual([
      { email: 'bursar@hillside.ac.ke', role: 'ADMIN', requested_by: null, via_platform: true, status: 'queued' },
      { email: 'head@hillside.ac.ke', role: 'ADMIN', requested_by: null, via_platform: true, status: 'queued' },
    ]);
  });

  it('a repeat for the same platform tenant creates nothing and queues nothing', async () => {
    const again = await enable(PT, 'Hillside Primary School', 'hillside-primary', [{ email: 'someone.else@hillside.ac.ke' }]);
    expect(again).toMatchObject({ tenant_id: company.tenant_id, created: false, invited: 0 });
    expect((await rows(`select 1 from tenants where platform_tenant_id = $1`, [PT])).length).toBe(1);
    expect((await rows(`select 1 from invite_queue where tenant_id = $1`, [company.tenant_id])).length).toBe(2);
  });

  it('makes another address when the school\'s is taken or not valid here', async () => {
    const other = await enable(PT2, 'Hillside Primary School', 'hillside-primary', []);
    expect(other.created).toBe(true);
    expect(other.slug).not.toBe('hillside-primary');
    expect(other.slug).toMatch(/^[a-z0-9-]{3,40}$/);
  });

  it('the send-invites job claims the platform\'s invitations (nobody in the company could have sent them)', async () => {
    const claimed = await rows<{ email: string; role: string; inviter_email: string | null; company_name: string }>(
      `select email, role, inviter_email, company_name from claim_invitations(100) where tenant_id = $1 order by email`, [company.tenant_id]);
    expect(claimed).toEqual([
      { email: 'bursar@hillside.ac.ke', role: 'ADMIN', inviter_email: null, company_name: 'Hillside Primary School' },
      { email: 'head@hillside.ac.ke', role: 'ADMIN', inviter_email: null, company_name: 'Hillside Primary School' },
    ]);
    expect(await rows(`select role, status from invitations where tenant_id = $1 order by email`, [company.tenant_id])).toEqual([
      { role: 'ADMIN', status: 'pending' },
      { role: 'ADMIN', status: 'pending' },
    ]);
  });

  it('an invitation someone queued without a sender, not from the platform, is still refused', async () => {
    await db.query(`insert into invite_queue (tenant_id, batch_id, email, role) values ($1, gen_random_uuid(), 'x@y.co', 'ADMIN')`, [company.tenant_id]);
    expect(await rows(`select * from claim_invitations(100) where tenant_id = $1`, [company.tenant_id])).toEqual([]);
    expect(await rows(`select status from invite_queue where tenant_id = $1 and email = 'x@y.co'`, [company.tenant_id])).toEqual([{ status: 'failed' }]);
  });
});

describe('schools.staff.created / .updated: draft employees', () => {
  it('creates a draft employee with the company\'s next number, and maps the Schools person to them', async () => {
    const r = await upsert(PT, 'person-1', { first: 'Grace', middle: 'Wanjiru', last: 'Otieno', phone: '+254712345678', email: 'grace@gmail.com', title: 'Teacher' });
    expect(r.created).toBe(true);
    expect(r.employee_number).toMatch(/^MCL-\d{6}$/);
    const [e] = await rows(
      `select "First Name" f, "Middle Name" m, "Last Name" l, "Mobile Number" p, "Work Email" w, "Job Title" j, onboarding_status, tenant_id
       from employees where tenant_id = $1 and "Employee Number" = $2`, [company.tenant_id, r.employee_number]);
    expect(e).toEqual({ f: 'Grace', m: 'Wanjiru', l: 'Otieno', p: '+254712345678', w: 'grace@gmail.com', j: 'Teacher', onboarding_status: 'draft', tenant_id: company.tenant_id });
    expect(await rows(`select employee_number, source, external_id from external_people where tenant_id = $1`, [company.tenant_id])).toEqual([
      { employee_number: r.employee_number, source: 'schools', external_id: 'person-1' },
    ]);
  });

  it('the same event again changes nothing; an update renames the same employee', async () => {
    const first = await upsert(PT, 'person-1', { first: 'Grace', middle: 'Wanjiru', last: 'Otieno', title: 'Teacher' });
    expect(first.created).toBe(false);
    const renamed = await upsert(PT, 'person-1', { first: 'Grace', last: 'Achieng', title: 'Deputy head' });
    expect(renamed).toEqual({ employee_number: first.employee_number, created: false });
    expect(await rows(`select "First Name" f, "Middle Name" m, "Last Name" l, "Job Title" j, "Work Email" w, "Mobile Number" p from employees
                       where tenant_id = $1 and "Employee Number" = $2`, [company.tenant_id, first.employee_number])).toEqual([
      // phone and email were not sent this time: what HR has stays
      { f: 'Grace', m: null, l: 'Achieng', j: 'Deputy head', w: 'grace@gmail.com', p: '+254712345678' },
    ]);
    expect((await rows(`select 1 from employees where tenant_id = $1`, [company.tenant_id])).length).toBe(1);
  });

  it('never matches by email: another person with the same email is another employee, without the email', async () => {
    const r = await upsert(PT, 'person-2', { first: 'Grace', last: 'Other', email: 'GRACE@gmail.com', phone: 'not a phone' });
    expect(r.created).toBe(true);
    const [e] = await rows(`select "Work Email" w, "Mobile Number" p from employees where tenant_id = $1 and "Employee Number" = $2`, [company.tenant_id, r.employee_number]);
    expect(e).toEqual({ w: null, p: null });
    expect((await rows(`select 1 from external_people where tenant_id = $1`, [company.tenant_id])).length).toBe(2);
  });

  it('draft employees are not paid: a payslip for one is refused', async () => {
    const [{ n }] = await rows<{ n: string }>(`select employee_number n from external_people where external_id = 'person-1'`);
    await db.exec(`insert into auth.users (id, email) values ('${HR_USER}', 'hr@hillside.ac.ke');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${HR_USER}', 'hr@hillside.ac.ke', 'ADMIN', '${company.tenant_id}');
      insert into memberships (user_id, tenant_id, role, account_status) values ('${HR_USER}', '${company.tenant_id}', 'ADMIN', 'ACTIVE')
        on conflict do nothing;`);
    await expect(
      asUser(db, HR_USER, () => db.query(`insert into salary_history (employee_id, pay_period, tenant_id) values ($1, '2026-11', $2)`, [n, company.tenant_id]))
    ).rejects.toThrow(/onboarding is draft/);
  });

  it('a school with no HR company is P0002 (the backend answers "try later")', async () => {
    await expect(upsert('9c3d2a4e-3b7d-4c1e-9a55-2d8f0e7b9c12', 'p', { first: 'X' })).rejects.toMatchObject({ code: 'P0002' });
  });
});

describe('schools.staff.left and hr.employee.left', () => {
  it('starts HR\'s exit for the mapped employee (requested, last working day the day they left); nothing is deleted', async () => {
    const [r] = await rows<{ employee_number: string; outcome: string }>(`select * from platform_school_staff_left($1, 'person-2', '2026-11-04')`, [PT]);
    expect(r.outcome).toBe('exit_started');
    expect(await rows(`select kind, status, reason_category, to_char(last_working_day, 'YYYY-MM-DD') d from employee_exits
                       where tenant_id = $1 and employee_number = $2`, [company.tenant_id, r.employee_number])).toEqual([
      { kind: 'termination', status: 'requested', reason_category: 'other', d: '2026-11-04' },
    ]);
    const again = await rows(`select outcome from platform_school_staff_left($1, 'person-2', '2026-11-04')`, [PT]);
    expect(again).toEqual([{ outcome: 'exit_open' }]);
    expect(await rows(`select outcome from platform_school_staff_left($1, 'nobody', null)`, [PT])).toEqual([{ outcome: 'unknown' }]);
  });

  it('when the exit ends their employment, hr.employee.left is queued once for the platform', async () => {
    const [{ id, n }] = await rows<{ id: string; n: string }>(
      `select x.id, x.employee_number n from employee_exits x join external_people m on m.tenant_id = x.tenant_id and m.employee_number = x.employee_number
       where m.external_id = 'person-2'`);
    await db.query(`update employee_exits set status = 'approved' where id = $1`, [id]);
    await db.query(`select end_exit_access($1)`, [id]);
    await db.query(`select end_exit_access($1)`, [id]);
    const out = await rows(`select event_type, data, status, tenant_id from platform_event_outbox`);
    expect(out).toEqual([
      { event_type: 'hr.employee.left', data: { employee_number: n, external_id: 'person-2', source: 'schools', left_on: '2026-11-04' }, status: 'pending', tenant_id: company.tenant_id },
    ]);
    expect(await rows(`select "Status" s from employees where tenant_id = $1 and "Employee Number" = $2`, [company.tenant_id, n])).toEqual([{ s: 'Terminated' }]);
    expect(await rows(`select outcome from platform_school_staff_left($1, 'person-2', null)`, [PT])).toEqual([{ outcome: 'already_left' }]);
  });

  it('an exit of someone not from Schools queues nothing', async () => {
    await db.query(`insert into employees (tenant_id, "First Name") values ($1, 'Local')`, [company.tenant_id]);
    const [{ n }] = await rows<{ n: string }>(`select "Employee Number" n from employees where tenant_id = $1 and "First Name" = 'Local'`, [company.tenant_id]);
    const [{ id }] = await rows<{ id: string }>(
      `insert into employee_exits (tenant_id, employee_number, kind, notice_given_on, notice_days, last_working_day)
       values ($1, $2, 'resignation', current_date, 0, current_date) returning id`, [company.tenant_id, n]);
    await db.query(`update employee_exits set status = 'approved' where id = $1`, [id]);
    await db.query(`select end_exit_access($1)`, [id]);
    expect((await rows(`select 1 from platform_event_outbox`)).length).toBe(1);
  });

  it('the outbox is claimed once, retried with backoff, then sent', async () => {
    const claimed = await rows<{ id: string; attempts: number }>(`select id, attempts from claim_platform_events(10)`);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].attempts).toBe(1);
    expect(await rows(`select * from claim_platform_events(10)`)).toEqual([]);
    expect(await rows(`select finish_platform_event($1, false, 'platform down', true) r`, [claimed[0].id])).toEqual([{ r: 'pending' }]);
    const [o] = await rows<{ status: string; later: boolean }>(`select status, next_attempt_at > now() later from platform_event_outbox`);
    expect(o).toEqual({ status: 'pending', later: true });
    await db.exec(`update platform_event_outbox set next_attempt_at = now()`);
    const [again] = await rows<{ id: string }>(`select id from claim_platform_events(10)`);
    expect(await rows(`select finish_platform_event($1, true) r`, [again.id])).toEqual([{ r: 'sent' }]);
    expect(await rows(`select status, sent_at is not null sent from platform_event_outbox`)).toEqual([{ status: 'sent', sent: true }]);
  });
});

describe('who can see it', () => {
  it('signed-in users can\'t read deliveries or the outbox, nor call the functions; HR sees its own mapping', async () => {
    await db.query(`insert into platform_event_receipts (delivery_id, event_type, result) values ('d1', 'schools.staff.created', 'created')`);
    await db.query(`insert into role_permissions (role_name, permissions, tenant_id) values ('ADMIN', array['dashboard', 'employees'], $1)
                    on conflict do nothing`, [company.tenant_id]);
    await asUser(db, HR_USER, async () => {
      await expect(db.query(`select * from platform_event_receipts`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`select * from platform_event_outbox`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`select * from platform_enable_hr($1, 'X School', null, '[]')`, [PT2])).rejects.toThrow(/permission denied/);
      await expect(db.query(`select * from platform_upsert_school_staff($1, 'p', 'X', null, null, null, null, null)`, [PT])).rejects.toThrow(/permission denied/);
      await expect(db.query(`insert into external_people (tenant_id, employee_number, source, external_id) values ($1, 'MCL-000001', 'schools', 'z')`, [company.tenant_id]))
        .rejects.toThrow(/permission denied/);
      const seen = await rows<{ external_id: string }>(`select external_id from external_people order by 1`);
      expect(seen.map((r) => r.external_id)).toEqual(['person-1', 'person-2']);
    });
  });
});
