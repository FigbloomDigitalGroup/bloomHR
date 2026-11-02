// @vitest-environment node
//
// Platform organisations (migration 20261029100000_platform_organisations.sql): a new company waits for a Figbloom
// platform admin's approval unless approval is automatic; approving, rejecting, suspending and reactivating (audited,
// a reason needed to reject); only platform admins decide, change the switch or see every company; a company that is
// not active is shut out (invites, payroll, its data) while its people's other companies carry on; the emails queued
// to platform admins and the owner; existing companies stay active; and running the migration again.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootDb, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001'; // an existing company
const PLAT = '00000000-0000-0000-0000-00000000c901'; // a Figbloom platform admin (staff of A)
const ADMIN_A = '00000000-0000-0000-0000-00000000c902'; // administrator of A
const FOUNDER = '00000000-0000-0000-0000-00000000c903'; // signs up and creates a company
const FOUNDER2 = '00000000-0000-0000-0000-00000000c904';
const MULTI = '00000000-0000-0000-0000-00000000c905'; // payroll at A, then creates a company of their own

const MIGRATION = join(__dirname, '..', 'migrations', '20261029100000_platform_organisations.sql');

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const createCompany = async (user: string, name: string) =>
  (await read<{ id: string }>(user, `select create_company('${name}') id`))[0].id;
const statusOf = async (id: string) => (await rows<{ status: string }>(`select status from tenants where id = '${id}'`))[0].status;
const decide = (user: string, id: string, action: string, reason: string | null = null) =>
  read<{ s: string }>(user, `select set_company_status('${id}', '${action}', ${reason === null ? 'null' : `'${reason}'`}) s`).then((r) => r[0].s);
const queued = (purpose: string) =>
  rows<{ subject: string; html: string; to_email: string }>(
    `select b.subject, b.html, r.to_email from bulk_emails b join bulk_email_recipients r on r.bulk_email_id = b.id where b.purpose = '${purpose}' order by r.to_email`
  );

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data, last_sign_in_at) values
      ('${PLAT}', 'ops@figbloom.org', '{}', now() - interval '1 day'),
      ('${ADMIN_A}', 'admin@a.co', '{}', now() - interval '2 days'),
      ('${FOUNDER}', 'founder@startup.co', '{"full_name": "Wanjiru Founder"}', now() - interval '3 days'),
      ('${FOUNDER2}', 'second@other.co', '{}', null),
      ('${MULTI}', 'pay@a.co', '{}', now() - interval '30 days');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${PLAT}', 'ops@figbloom.org', 'STAFF', '${A}'), ('${ADMIN_A}', 'admin@a.co', 'ADMIN', '${A}'), ('${MULTI}', 'pay@a.co', 'FINANCE', '${A}');
    insert into memberships (user_id, tenant_id, role) values
      ('${PLAT}', '${A}', 'STAFF'), ('${ADMIN_A}', '${A}', 'ADMIN'), ('${MULTI}', '${A}', 'FINANCE')
      on conflict do nothing;
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('STAFF', array['dashboard'], '${A}'), ('FINANCE', array['work-records', 'payroll'], '${A}');
    select grant_platform_admin('${PLAT}', 'Figbloom ops');
  `);
}, 120000);

describe('existing companies', () => {
  it('stay active when the migration runs', async () => {
    const seeded = await bootDb({
      file: '20261029100000_platform_organisations.sql',
      seed: async (d) => {
        await d.exec(`
          insert into tenants (id, name, slug, status) values
            ('00000000-0000-0000-0000-0000000c9a01', 'Old Co', 'old-co-c9', 'active'),
            ('00000000-0000-0000-0000-0000000c9a02', 'Paused Co', 'paused-co-c9', 'suspended');
        `);
      },
    });
    const list = (await seeded.query<{ slug: string; status: string }>(`select slug, status from tenants where slug like '%-c9' order by slug`)).rows;
    expect(list).toEqual([
      { slug: 'old-co-c9', status: 'active' },
      { slug: 'paused-co-c9', status: 'suspended' },
    ]);
    expect((await seeded.query<{ s: string }>(`select status s from tenants where id = '${A}'`)).rows[0].s).toBe('active');
    await seeded.close();
  }, 120000);
});

describe('signing up', () => {
  let company: string;

  it('creates the company waiting for approval by default, and its owner is told nothing is open yet', async () => {
    company = await createCompany(FOUNDER, 'Startup Ltd');
    expect(await statusOf(company)).toBe('pending');
    expect((await rows<{ created_by: string }>(`select created_by from tenants where id = '${company}'`))[0].created_by).toBe(FOUNDER);
    const [me] = await read<{ tenant_id: string; status: string; other_active_companies: number }>(FOUNDER, `select * from my_company_status()`);
    expect(me).toMatchObject({ tenant_id: company, status: 'pending', other_active_companies: 0 });
    // the database shows a pending company nothing, not even itself
    expect(await read(FOUNDER, `select * from tenants`)).toEqual([]);
    expect((await read<{ id: string | null }>(FOUNDER, `select current_tenant_id() id`))[0].id).toBeNull();
  });

  it('emails every platform admin, with a link to the organisations page', async () => {
    const mail = await queued('platform-new-company');
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ to_email: 'ops@figbloom.org', subject: 'New company waiting for approval: Startup Ltd' });
    expect(mail[0].html).toContain('href="/platform/organisations"');
    expect(mail[0].html).toContain('founder@startup.co');
  });

  it('cannot invite anyone or run payroll while pending', async () => {
    await expect(as(FOUNDER, `select create_invitation('new@startup.co', 'STAFF')`)).rejects.toThrow(/Only an administrator or HR can invite/);
    await expect(as(FOUNDER, `select * from enqueue_invitations('[{"email": "new@startup.co", "role": "STAFF"}]'::jsonb)`)).rejects.toThrow();
    expect((await read<{ ok: boolean }>(FOUNDER, `select has_module('payroll') ok`))[0].ok).toBe(false);
    await expect(
      as(FOUNDER, `insert into salary_history (employee_id, employee_name, pay_period, gross_pay, net_pay, tenant_id) values ('X', 'X', '2026-10', 1, 1, '${company}')`)
    ).rejects.toThrow();
    await expect(
      as(FOUNDER, `insert into employees ("Employee Number", "First Name", tenant_id) values ('S1', 'Sam', '${company}')`)
    ).rejects.toThrow();
  });

  it('approved: the company opens, its owner is emailed, and the decision is recorded', async () => {
    expect(await decide(PLAT, company, 'approve')).toBe('active');
    expect((await read<{ ok: boolean }>(FOUNDER, `select has_module('payroll') ok`))[0].ok).toBe(true);
    expect(await read<{ name: string }>(FOUNDER, `select name from tenants`)).toEqual([{ name: 'Startup Ltd' }]);
    await as(FOUNDER, `select create_invitation('new@startup.co', 'STAFF')`);
    const mail = await queued('platform-company-approved');
    expect(mail).toEqual([expect.objectContaining({ to_email: 'founder@startup.co', subject: 'Your company Startup Ltd is approved' })]);
    const [t] = await rows<{ status_changed_by: string; status_changed_at: string | null }>(`select status_changed_by, status_changed_at from tenants where id = '${company}'`);
    expect(t.status_changed_by).toBe(PLAT);
    expect(t.status_changed_at).not.toBeNull();
    const audit = await read<{ old_status: string | null; new_status: string; performed_by: string }>(
      PLAT,
      `select old_status, new_status, performed_by from tenant_status_changes where tenant_id = '${company}' order by performed_at, old_status nulls first`
    );
    expect(audit).toEqual([
      { old_status: null, new_status: 'pending', performed_by: FOUNDER },
      { old_status: 'pending', new_status: 'active', performed_by: PLAT },
    ]);
    // a company never reads the platform's audit
    expect(await read(FOUNDER, `select * from tenant_status_changes`)).toEqual([]);
  });

  it('suspended: shut out again with the reason kept; reactivated: open again', async () => {
    expect(await decide(PLAT, company, 'suspend', 'Unpaid invoice')).toBe('suspended');
    expect((await read<{ status: string; status_reason: string }>(FOUNDER, `select status, status_reason from my_company_status()`))[0]).toEqual({
      status: 'suspended', status_reason: 'Unpaid invoice',
    });
    expect((await read<{ ok: boolean }>(FOUNDER, `select has_module('payroll') ok`))[0].ok).toBe(false);
    await expect(as(FOUNDER, `select create_invitation('other@startup.co', 'STAFF')`)).rejects.toThrow(/Only an administrator or HR can invite/);
    expect(await decide(PLAT, company, 'reactivate')).toBe('active');
    expect((await rows<{ r: string | null }>(`select status_reason r from tenants where id = '${company}'`))[0].r).toBeNull();
  });
});

describe('the approval state machine', () => {
  let company: string;

  beforeAll(async () => {
    company = await createCompany(FOUNDER2, 'Second Co');
  });

  it('rejecting needs a reason', async () => {
    await expect(decide(PLAT, company, 'reject')).rejects.toThrow(/Say why the company is rejected/);
    await expect(decide(PLAT, company, 'reject', '  ')).rejects.toThrow(/Say why/);
    expect(await decide(PLAT, company, 'reject', 'Not a real business')).toBe('rejected');
    const [t] = await rows<{ status_reason: string }>(`select status_reason from tenants where id = '${company}'`);
    expect(t.status_reason).toBe('Not a real business');
    expect(
      (await read<{ reason: string }>(PLAT, `select reason from tenant_status_changes where tenant_id = '${company}' and new_status = 'rejected'`))[0].reason
    ).toBe('Not a real business');
  });

  it('refuses moves that make no sense', async () => {
    await expect(decide(PLAT, company, 'suspend')).rejects.toThrow(/A company that is rejected cannot be suspended/);
    await expect(decide(PLAT, company, 'reactivate')).rejects.toThrow(/cannot be reactivated/);
    await expect(decide(PLAT, company, 'reject', 'again')).rejects.toThrow(/cannot be rejected/);
    await expect(decide(PLAT, company, 'delete')).rejects.toThrow(/Unknown action/);
    await expect(decide(PLAT, '00000000-0000-0000-0000-0000000c9fff', 'approve')).rejects.toThrow(/No such company/);
    await expect(decide(PLAT, A, 'approve')).rejects.toThrow(/A company that is active cannot be approved/);
  });

  it('a rejected company can still be approved later', async () => {
    expect(await decide(PLAT, company, 'approve')).toBe('active');
    expect(await decide(PLAT, company, 'suspend')).toBe('suspended');
  });
});

describe('only platform admins', () => {
  it('decide on companies, see them all, or change the switch', async () => {
    const company = (await rows<{ id: string }>(`select id from tenants where name = 'Startup Ltd'`))[0].id;
    for (const user of [ADMIN_A, FOUNDER]) {
      await expect(decide(user, company, 'suspend')).rejects.toThrow(/Only a platform admin/);
      await expect(read(user, `select * from platform_organisations()`)).rejects.toThrow(/Only a platform admin/);
      await expect(read(user, `select platform_organisation_totals()`)).rejects.toThrow(/Only a platform admin/);
      await expect(read(user, `select set_auto_approve_companies(true)`)).rejects.toThrow(/Only a platform admin/);
      expect(await read(user, `select * from platform_settings`)).toEqual([]);
    }
    // nobody changes a status, the settings or the audit directly
    await expect(as(ADMIN_A, `update tenants set status = 'suspended' where id = '${A}'`)).rejects.toThrow(/permission denied/);
    expect(await statusOf(A)).toBe('active');
    await expect(as(PLAT, `update platform_settings set auto_approve_companies = true`)).rejects.toThrow(/permission denied/);
    await expect(as(PLAT, `insert into tenant_status_changes (tenant_id, new_status) values ('${A}', 'active')`)).rejects.toThrow(/permission denied/);
    // internal helpers are not for signed-in people
    await expect(read(ADMIN_A, `select queue_platform_email('${A}', 'x', 'x', 'x', array['a@b.co'])`)).rejects.toThrow(/permission denied/);
    await expect(read(ADMIN_A, `select company_last_activity('${A}')`)).rejects.toThrow(/permission denied/);
  });
});

describe('the organisations page', () => {
  it('lists every company with its owner, counts and last activity', async () => {
    await db.exec(`insert into employees ("Employee Number", "First Name", tenant_id) values ('E1', 'Amina', '${A}'), ('E2', 'Brian', '${A}')`);
    const list = await read<Record<string, unknown>>(PLAT, `select * from platform_organisations()`);
    const startup = list.find((c) => c.name === 'Startup Ltd')!;
    expect(startup).toMatchObject({
      status: 'active', plan: 'trial', owner_id: FOUNDER, owner_name: 'Wanjiru Founder', owner_email: 'founder@startup.co',
      users: 1, employees: 0, payroll_runs: 0, status_changed_by_email: 'ops@figbloom.org',
    });
    expect(startup.last_activity).not.toBeNull();
    const a = list.find((c) => c.id === A)!;
    expect(a).toMatchObject({ status: 'active', users: 3, employees: 2 });
    // the latest sign-in of its members (the platform admin, a day ago)
    expect(new Date(String(a.last_activity)).getTime()).toBeGreaterThan(Date.now() - 2 * 86400000 + 60000);
    const second = list.find((c) => c.name === 'Second Co')!;
    expect(second).toMatchObject({ status: 'suspended', owner_email: 'second@other.co', last_activity: null });
  });

  it('totals companies by status, sign-ups per week and companies active this week', async () => {
    const [{ t }] = await read<{ t: { by_status: Record<string, number>; signups_by_week: { week: string; count: number }[]; active_last_7_days: number; auto_approve: boolean } }>(
      PLAT,
      `select platform_organisation_totals(4) t`
    );
    const total = (await rows<{ n: number }>(`select count(*)::int n from tenants`))[0].n;
    expect(t.by_status.total).toBe(total);
    expect(t.by_status.suspended).toBe(1);
    expect(t.by_status.pending).toBe(0);
    expect(t.signups_by_week).toHaveLength(4);
    expect(t.signups_by_week[3].count).toBeGreaterThanOrEqual(2);
    // A (signed in a day ago) and Startup Ltd (three days ago); Second Co's owner never signed in
    expect(t.active_last_7_days).toBe(2);
    expect(t.auto_approve).toBe(false);
  });
});

describe('the auto-approve switch', () => {
  it('turned on, new companies are active straight away (and platform admins are still told)', async () => {
    expect((await read<{ ok: boolean }>(PLAT, `select set_auto_approve_companies(true) ok`))[0].ok).toBe(true);
    expect(await read(PLAT, `select auto_approve_companies, updated_by from platform_settings`)).toEqual([{ auto_approve_companies: true, updated_by: PLAT }]);
    const company = await createCompany(MULTI, 'Auto Co');
    expect(await statusOf(company)).toBe('active');
    const mail = await queued('platform-new-company');
    expect(mail.map((m) => m.subject)).toContain('New company signed up: Auto Co');
  });

  it('turned off again, the next one waits', async () => {
    await as(PLAT, `select set_auto_approve_companies(false)`);
    const company = await createCompany(MULTI, 'Manual Co');
    expect(await statusOf(company)).toBe('pending');
  });
});

describe('someone in an active company and a pending one', () => {
  it('works in the pending one only after approval, and switches back to the active one meanwhile', async () => {
    // MULTI just created Manual Co (pending) and was switched into it
    const [me] = await read<{ name: string; status: string; other_active_companies: number }>(MULTI, `select name, status, other_active_companies from my_company_status()`);
    expect(me).toEqual({ name: 'Manual Co', status: 'pending', other_active_companies: 2 });
    // the pending company is not offered as a company to work in
    const companies = await read<{ tenant_id: string; name: string }>(MULTI, `select tenant_id, name from my_companies()`);
    expect(companies.map((c) => c.name)).toContain('Auto Co');
    expect(companies.map((c) => c.tenant_id)).toContain(A);
    expect(companies.map((c) => c.name)).not.toContain('Manual Co');
    await as(MULTI, `select switch_company('${A}')`);
    expect((await read<{ ok: boolean }>(MULTI, `select has_module('payroll') ok`))[0].ok).toBe(true);
    expect((await read<{ status: string }>(MULTI, `select status from my_company_status()`))[0].status).toBe('active');
  });

  it("the platform admin's own work is unaffected", async () => {
    expect((await read<{ ok: boolean }>(PLAT, `select is_platform_admin() ok`))[0].ok).toBe(true);
    expect((await read<{ id: string }>(PLAT, `select current_tenant_id() id`))[0].id).toBe(A);
  });
});

describe('running the migration again', () => {
  it('changes nothing', async () => {
    const q = {
      tenants: `select id, status, status_reason, status_changed_by, created_by from tenants order by id`,
      settings: `select auto_approve_companies from platform_settings`,
      audit: `select count(*)::int n from tenant_status_changes`,
    };
    const before = { tenants: await rows(q.tenants), settings: await rows(q.settings), audit: await rows(q.audit) };
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    expect(await rows(q.tenants)).toEqual(before.tenants);
    expect(await rows(q.settings)).toEqual(before.settings);
    expect(await rows(q.audit)).toEqual(before.audit);
  });
});
