// @vitest-environment node
//
// Offer letterhead (20261016600000): a company's own header and footer images for offer letters, kept on its company
// profile (ADMIN and Settings change them, each company only its own) and sent to the candidate's public offer page
// by offer_by_token with the rest of the branding.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const ADMIN = '00000000-0000-0000-0000-00000000e601';
const HR = '00000000-0000-0000-0000-00000000e602';
const STAFF = '00000000-0000-0000-0000-00000000e603';
const B_ADMIN = '00000000-0000-0000-0000-00000000e604';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) => asUser(db, user, () => rows<T>(sql, params));
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const letterhead = async (tenant: string) =>
  (await rows<{ h: string | null; f: string | null }>(
    `select letterhead_header_url h, letterhead_footer_url f from company_profile where tenant_id = $1`, [tenant]))[0];

beforeAll(async () => {
  db = await bootDb();
  await db.exec(`delete from public.role_permissions where tenant_id = '${A}'`);
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co')`);
  for (const [id, email, role, tenant] of [
    [ADMIN, 'adm@a.co', 'ADMIN', A], [HR, 'hr@a.co', 'HR', A], [STAFF, 'staff@a.co', 'STAFF', A], [B_ADMIN, 'adm@b.co', 'ADMIN', B],
  ]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${tenant}');
    `);
  }
  await db.exec(`insert into role_permissions (role_name, permissions, tenant_id) values
    ('HR', array['employees'], '${A}'), ('STAFF', array['dashboard'], '${A}')`);
}, 120000);

describe('letterhead images on the company profile', () => {
  it('start empty, so letters keep the generated letterhead', async () => {
    expect(await letterhead(A)).toEqual({ h: null, f: null });
    expect(await letterhead(B)).toEqual({ h: null, f: null });
  });

  it('ADMIN sets and clears them, only for their own company; others in the company only read them', async () => {
    await as(ADMIN, `update company_profile set letterhead_header_url = 'https://cdn.x/h.png', letterhead_footer_url = 'https://cdn.x/f.png'`);
    expect(await letterhead(A)).toEqual({ h: 'https://cdn.x/h.png', f: 'https://cdn.x/f.png' });
    expect(await letterhead(B)).toEqual({ h: null, f: null });
    expect(await as(STAFF, `select letterhead_header_url from company_profile`)).toEqual([{ letterhead_header_url: 'https://cdn.x/h.png' }]);
    // without Settings an update touches nothing
    await as(STAFF, `update company_profile set letterhead_header_url = null`);
    expect((await letterhead(A)).h).toBe('https://cdn.x/h.png');
    // another company's admin neither sees nor changes it
    expect(await as(B_ADMIN, `select 1 from company_profile where tenant_id = $1`, [A])).toHaveLength(0);
    await as(B_ADMIN, `update company_profile set letterhead_header_url = null where tenant_id = $1`, [A]);
    expect((await letterhead(A)).h).toBe('https://cdn.x/h.png');
    await as(ADMIN, `update company_profile set letterhead_footer_url = null`);
    expect((await letterhead(A)).f).toBeNull();
  });

  it('must be web addresses', async () => {
    expect(await fails(as(ADMIN, `update company_profile set letterhead_header_url = 'javascript:alert(1)'`))).toMatch(/letterhead_header_url/);
  });
});

describe('the public offer page', () => {
  it('gets the letterhead images with the branding', async () => {
    await as(ADMIN, `update company_profile set letterhead_header_url = 'https://cdn.x/h.png', letterhead_footer_url = 'https://cdn.x/f.png'`);
    const [{ id }] = await as<{ id: string }>(HR, `insert into job_offers (candidate_first_name, candidate_email, job_title, body, start_date, expiry_date)
      values ('Jane', 'jane@x.co', 'Clerk', 'Dear Jane', current_date + 30, current_date + 7) returning id`);
    const [{ t }] = await as<{ t: string }>(HR, `select send_offer($1) t`, [id]);
    const [{ o }] = await asAnon(db, () => rows<{ o: { company: Record<string, unknown> } }>(`select offer_by_token($1) o`, [t]));
    expect(o.company).toMatchObject({ letterhead_header_url: 'https://cdn.x/h.png', letterhead_footer_url: 'https://cdn.x/f.png' });

    await as(ADMIN, `update company_profile set letterhead_header_url = null, letterhead_footer_url = null`);
    const [{ o: again }] = await asAnon(db, () => rows<{ o: { company: Record<string, unknown> } }>(`select offer_by_token($1) o`, [t]));
    expect(again.company).toMatchObject({ letterhead_header_url: null, letterhead_footer_url: null, name: expect.any(String) });
  });
});
