// @vitest-environment node
//
// The company profile (20261015100000, FIG-825): everyone in the company reads it, ADMIN and Settings change it, one
// company never sees another's; existing companies get theirs from company_logo; company_logo stays in step.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootDb, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const ADMIN = '00000000-0000-0000-0000-00000000f801';
const SETTINGS = '00000000-0000-0000-0000-00000000f802'; // OPS with the settings module
const HR = '00000000-0000-0000-0000-00000000f803';
const STAFF = '00000000-0000-0000-0000-00000000f804';
const B_ADMIN = '00000000-0000-0000-0000-00000000f805';

let db: PGlite;
const run = async (sql: string) => {
  try {
    await db.query(sql);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const profile = async (user: string) =>
  (await asUser(db, user, () => db.query<Record<string, unknown>>(`select * from company_profile`))).rows;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  for (const [id, email, role, tenant] of [
    [ADMIN, 'adm@a.co', 'ADMIN', A], [SETTINGS, 'ops@a.co', 'OPS', A], [HR, 'hr@a.co', 'HR', A],
    [STAFF, 'staff@a.co', 'STAFF', A], [B_ADMIN, 'adm@b.co', 'ADMIN', B],
  ]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id, full_name) values ('${id}', '${email}', '${role}', '${tenant}', 'Name of ${email}');
    `);
  }
  await db.exec(`insert into role_permissions (role_name, permissions, tenant_id) values
    ('OPS', array['settings'], '${A}'), ('HR', array['employees'], '${A}'), ('STAFF', array['dashboard'], '${A}');`);
}, 120000);

describe('company profile access', () => {
  it('every company has its profile; a new one starts with its name', async () => {
    const [b] = await profile(B_ADMIN);
    expect(b.company_name).toBe('Other Co');
    expect(b.country).toBe('Kenya');
    expect(b.base_currency).toBe('KES');
    expect(b.fiscal_year_start_month).toBe(1);
    expect(b.week_start_day).toBe('monday');
  });

  it('ADMIN and people with Settings change it', async () => {
    expect(await asUser(db, ADMIN, () => run(`update company_profile set industry = 'ict', official_email = 'hello@a.co', primary_color = '#0F766E'`))).toBe('');
    expect(await asUser(db, SETTINGS, () => run(`update company_profile set city = 'Nairobi', fiscal_year_start_month = 7`))).toBe('');
    const [a] = await profile(ADMIN);
    expect(a).toMatchObject({ industry: 'ict', official_email: 'hello@a.co', city: 'Nairobi', fiscal_year_start_month: 7, updated_by: SETTINGS });
  });

  it('everyone else in the company reads it but cannot change it', async () => {
    for (const user of [HR, STAFF]) {
      const [a] = await profile(user);
      expect(a.city).toBe('Nairobi');
      const r = await asUser(db, user, () => db.query(`update company_profile set city = 'Mombasa' returning 1`));
      expect(r.rows).toEqual([]);
    }
    expect((await profile(ADMIN))[0].city).toBe('Nairobi');
  });

  it('nobody deletes it', async () => {
    const r = await asUser(db, ADMIN, () => db.query(`delete from company_profile returning 1`));
    expect(r.rows).toEqual([]);
  });

  it('a company sees and changes only its own', async () => {
    expect((await profile(STAFF)).map((r) => r.tenant_id)).toEqual([A]);
    const r = await asUser(db, B_ADMIN, () => db.query(`update company_profile set city = 'Kampala' where tenant_id = '${A}' returning 1`));
    expect(r.rows).toEqual([]);
    expect(await asUser(db, B_ADMIN, () => run(`insert into company_profile (tenant_id, company_name) values ('${A}', 'Hijack')`))).toMatch(/row-level security|duplicate/);
    expect(await asUser(db, B_ADMIN, () => run(`update company_profile set tenant_id = '${A}'`))).toMatch(/row-level security/);
  });

  it('checks the formats', async () => {
    for (const bad of [
      `official_email = 'not-an-email'`, `website = 'example'`, `official_phone = 'call me'`, `primary_color = 'red'`,
      `fiscal_year_start_month = 13`, `week_start_day = 'someday'`, `industry = 'mining-ish'`, `base_currency = 'kes'`, `company_name = ' '`,
    ]) {
      expect(await asUser(db, ADMIN, () => run(`update company_profile set ${bad}`))).toMatch(/check/);
    }
    expect(await asUser(db, ADMIN, () => run(`update company_profile set website = 'https://a.co', official_phone = '+254 712 345678'`))).toBe('');
  });

  it('the creator stays as it was and changes are audited', async () => {
    // the existing company A had no admin when it was backfilled; set one (past the trigger that keeps the creator)
    await db.exec(`set session_replication_role = replica; update company_profile set created_by = '${ADMIN}' where tenant_id = '${A}'; set session_replication_role = default;`);
    await asUser(db, SETTINGS, () => db.query(`update company_profile set created_by = '${SETTINGS}', postal_code = '00100'`));
    expect((await profile(ADMIN))[0].created_by).toBe(ADMIN);
    const [admin] = (await asUser(db, STAFF, () => db.query(`select * from company_profile_admin()`))).rows;
    expect(admin).toEqual({ full_name: 'Name of adm@a.co', email: 'adm@a.co' });
    const audit = (await db.query<{ new_data: Record<string, unknown> }>(
      `select new_data from audit_log where table_name = 'company_profile' and tenant_id = '${A}' order by performed_at`)).rows;
    expect(audit.some((r) => r.new_data.postal_code === '00100')).toBe(true);
  });
});

describe('company_logo kept in step', () => {
  it('saving the profile name and logo writes them to company_logo, and the P9 uses the name', async () => {
    await asUser(db, ADMIN, () => db.query(`update company_profile set company_name = 'Acme Ltd', logo_url = 'https://x/logo.png', tagline = 'We build'`));
    const logos = (await asUser(db, STAFF, () => db.query(`select company_name, image_url, company_tagline from company_logo`))).rows;
    expect(logos).toEqual([{ company_name: 'Acme Ltd', image_url: 'https://x/logo.png', company_tagline: 'We build' }]);
    const [tax] = (await asUser(db, STAFF, () => db.query<{ company_name: string }>(`select * from company_tax_details()`))).rows;
    expect(tax.company_name).toBe('Acme Ltd');
  });

  it('an old client writing company_logo updates the profile; a blank logo keeps the one there', async () => {
    await asUser(db, ADMIN, () => db.query(`update company_logo set company_name = 'Acme Kenya', image_url = null`));
    const [a] = await profile(STAFF);
    expect(a).toMatchObject({ company_name: 'Acme Kenya', logo_url: 'https://x/logo.png' });
  });

  it('a new company does not get a company_logo row until it saves its profile', async () => {
    const r = await asUser(db, B_ADMIN, () => db.query(`select 1 from company_logo`));
    expect(r.rows).toEqual([]);
  });
});

describe('backfill of existing companies (20261015100000)', () => {
  let old: PGlite;
  beforeAll(async () => {
    old = await bootDb({
      file: '20261015100000_company_profile.sql',
      seed: async (d) => {
        await d.exec(`
          insert into tenants (id, name, slug) values ('${B}', 'Bee Account', 'bee-account'), ('00000000-0000-0000-0000-0000000000c3', 'Cee Account', 'cee-account');
          insert into auth.users (id, email) values ('${B_ADMIN}', 'adm@b.co');
          insert into memberships (user_id, tenant_id, role) values ('${B_ADMIN}', '${B}', 'ADMIN');
          insert into company_logo (tenant_id, company_name, image_url, company_tagline) values
            ('${B}', 'Old Name', 'https://x/old.png', null), ('${B}', 'Bee Limited', 'https://x/bee.png', 'Buzz');
        `);
      },
    });
  }, 120000);

  it('takes the latest company_logo row, else the account name, and the creator from the first admin', async () => {
    const rows = (await old.query<Record<string, unknown>>(
      `select tenant_id, company_name, logo_url, tagline, created_by from company_profile where tenant_id <> '${A}' order by tenant_id`)).rows;
    expect(rows).toEqual([
      { tenant_id: B, company_name: 'Bee Limited', logo_url: 'https://x/bee.png', tagline: 'Buzz', created_by: B_ADMIN },
      { tenant_id: '00000000-0000-0000-0000-0000000000c3', company_name: 'Cee Account', logo_url: null, tagline: null, created_by: null },
    ]);
  });

  it('leaves company_logo as it was', async () => {
    const r = await old.query(`select company_name from company_logo order by id`);
    expect(r.rows).toEqual([{ company_name: 'Old Name' }, { company_name: 'Bee Limited' }]);
  });
});
