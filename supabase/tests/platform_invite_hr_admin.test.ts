// @vitest-environment node
//
// "Invite admin" in the console (20261124200000_platform_invite_hr_admin.sql): platform_invite_hr_admin() queues an
// ADMIN invitation for a customer's HR company exactly as platform_enable_hr() does, once per address, records who
// asked in audit_log, and answers queued / already_invited / already_member / no_company. Server only; the actor must
// be a platform Owner or Admin.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const PT = '7c3e4a60-5d9f-4e3a-9c77-4fa0a2d9be01';
const PT_NONE = '7c3e4a60-5d9f-4e3a-9c77-4fa0a2d9be02'; // HR & Payroll never switched on
const STAFF_OWNER = '00000000-0000-0000-0000-00000000f301';
const STAFF_SUPPORT = '00000000-0000-0000-0000-00000000f302';
const MEMBER = '00000000-0000-0000-0000-00000000f303';
const STRANGER = '00000000-0000-0000-0000-00000000f304';

type Answer = { outcome: string; tenant_id: string | null; tenant_name: string | null; member_role: string | null };

let db: PGlite;
let company: string;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const invite = async (pt: string, email: string, actor = STAFF_OWNER, name: string | null = null) =>
  (await rows<Answer>(`select * from platform_invite_hr_admin($1, $2, $3, $4, $5)`, [pt, email, actor, 'staff@figbloom.org', name]))[0];
const queued = async () =>
  rows(`select email, role, requested_by, via_platform, status from invite_queue where tenant_id = $1 order by id`, [company]);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values
      ('${STAFF_OWNER}', 'staff@figbloom.org'), ('${STAFF_SUPPORT}', 'support@figbloom.org'),
      ('${MEMBER}', 'Head@Hillside.ac.ke'), ('${STRANGER}', 'someone@else.co');
    insert into platform_admins (user_id, role, note) values ('${STAFF_OWNER}', 'owner', 'o'), ('${STAFF_SUPPORT}', 'support', 's');
  `);
  company = (await rows<{ tenant_id: string }>(
    `select tenant_id from platform_enable_hr($1, 'Hillside Primary', null, '[{"email":"fake@nowhere.co"}]'::jsonb)`, [PT]))[0].tenant_id;
  await db.query(`insert into memberships (user_id, tenant_id, role, account_status) values ($1, $2, 'ADMIN', 'ACTIVE')`, [MEMBER, company]);
}, 180000);

describe('platform_invite_hr_admin', () => {
  it('queues an ADMIN invitation exactly as platform_enable_hr does, and audits it as console:<email>', async () => {
    const r = await invite(PT, '  New.Admin@Hillside.ac.ke ', STAFF_OWNER, '  Jane   Head ');
    expect(r).toEqual({ outcome: 'queued', tenant_id: company, tenant_name: 'Hillside Primary', member_role: null });
    expect(await queued()).toEqual([
      { email: 'fake@nowhere.co', role: 'ADMIN', requested_by: null, via_platform: true, status: 'queued' },
      { email: 'new.admin@hillside.ac.ke', role: 'ADMIN', requested_by: null, via_platform: true, status: 'queued' },
    ]);
    const audit = await rows<{ action_type: string; table_name: string; record_key: string; performed_by: string; new_data: Record<string, unknown> }>(
      `select action_type, table_name, record_key, performed_by, new_data from audit_log where tenant_id = $1 and action_type = 'PLATFORM_INVITE_ADMIN'`, [company]);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ table_name: 'invite_queue', record_key: 'new.admin@hillside.ac.ke', performed_by: STAFF_OWNER });
    expect(audit[0].new_data).toMatchObject({
      email: 'new.admin@hillside.ac.ke', name: 'Jane Head', role: 'ADMIN', platform_tenant_id: PT, actor: 'console:staff@figbloom.org',
    });
  });

  it('the same address again (any case) is already_invited while it waits, and nothing more is queued or audited', async () => {
    expect((await invite(PT, 'NEW.ADMIN@hillside.ac.ke')).outcome).toBe('already_invited');
    expect(await queued()).toHaveLength(2);
    expect((await rows(`select 1 from audit_log where tenant_id = $1 and action_type = 'PLATFORM_INVITE_ADMIN'`, [company]))).toHaveLength(1);
  });

  it('a sent invitation that is still open counts as already_invited; an expired or revoked one does not', async () => {
    await db.query(
      `insert into invitations (tenant_id, email, role, token_hash, status) values ($1, 'sent@hillside.ac.ke', 'ADMIN', 'h1', 'pending'),
         ($1, 'expired@hillside.ac.ke', 'ADMIN', 'h2', 'pending'), ($1, 'revoked@hillside.ac.ke', 'ADMIN', 'h3', 'revoked')`, [company]);
    await db.query(`update invitations set expires_at = now() - interval '1 day' where tenant_id = $1 and email = 'expired@hillside.ac.ke'`, [company]);
    expect((await invite(PT, 'sent@hillside.ac.ke')).outcome).toBe('already_invited');
    expect((await invite(PT, 'expired@hillside.ac.ke')).outcome).toBe('queued');
    expect((await invite(PT, 'revoked@hillside.ac.ke')).outcome).toBe('queued');
  });

  it('a sent (finished) queue row does not block a new invitation', async () => {
    await db.query(`update invite_queue set status = 'sent' where tenant_id = $1 and email = 'fake@nowhere.co'`, [company]);
    expect((await invite(PT, 'fake@nowhere.co')).outcome).toBe('queued');
  });

  it('someone who already has a login in the company is already_member, with their role', async () => {
    expect(await invite(PT, 'head@hillside.ac.ke')).toEqual({
      outcome: 'already_member', tenant_id: company, tenant_name: 'Hillside Primary', member_role: 'ADMIN',
    });
    expect((await queued()).some((q) => q.email === 'head@hillside.ac.ke')).toBe(false);
  });

  it('no_company when HR has no company for the platform tenant', async () => {
    expect(await invite(PT_NONE, 'a@b.co')).toEqual({ outcome: 'no_company', tenant_id: null, tenant_name: null, member_role: null });
  });

  it('refuses a malformed email', async () => {
    for (const bad of ['', 'nobody', 'a@b', 'a b@c.co', `${'x'.repeat(250)}@b.co`]) {
      await expect(invite(PT, bad)).rejects.toMatchObject({ code: '22023' });
    }
  });

  it('refuses an actor who is not a platform Owner or Admin (Support, or not staff at all)', async () => {
    await expect(invite(PT, 'x1@hillside.ac.ke', STAFF_SUPPORT)).rejects.toMatchObject({ code: '42501' });
    await expect(invite(PT, 'x2@hillside.ac.ke', STRANGER)).rejects.toMatchObject({ code: '42501' });
    await expect(db.query(`select * from platform_invite_hr_admin($1, 'x3@hillside.ac.ke', $2, '')`, [PT, STAFF_OWNER]))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('is for the server only: signed-in users and anon cannot call it', async () => {
    await expect(asUser(db, STAFF_OWNER, () => db.query(`select * from platform_invite_hr_admin($1, 'y@hillside.ac.ke', $2, 'staff@figbloom.org')`, [PT, STAFF_OWNER])))
      .rejects.toThrow(/permission denied/);
  });
});
