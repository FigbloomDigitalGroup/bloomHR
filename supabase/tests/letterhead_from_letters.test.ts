// @vitest-environment node
//
// The letterhead from the letter screens (20261026300000): HR, Recruitment and Settings set the letterhead images, and
// only those two columns; staff can't; each company only its own.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000e101';
const REC = '00000000-0000-0000-0000-00000000e102';
const STAFF = '00000000-0000-0000-0000-00000000e103';
const HRB = '00000000-0000-0000-0000-00000000e104';
const HEAD = 'https://cdn.example/head.png';
const FOOT = 'https://cdn.example/foot.png';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const set = (user: string, header: string | null, footer: string | null) =>
  asUser(db, user, () => rows(`select * from set_company_letterhead($1, $2)`, [header, footer])).then((r) => r[0], (e) => (e as Error).message);
const profile = async (tenant: string) =>
  (await rows(`select company_name, letterhead_header_url, letterhead_footer_url, updated_by from company_profile where tenant_id = $1`, [tenant]))[0];

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${REC}', 'rec@a.co'), ('${STAFF}', 's@a.co'), ('${HRB}', 'hr@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${REC}', 'rec@a.co', 'RECRUITER', '${A}'), ('${STAFF}', 's@a.co', 'STAFF', '${A}'),
      ('${HRB}', 'hr@b.co', 'HR', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['hr-lifecycle'], '${A}'), ('RECRUITER', array['recruitment'], '${A}'), ('STAFF', array['dashboard'], '${A}'),
      ('HR', array['employees'], '${B}');
    delete from company_profile where tenant_id = '${B}';
  `);
}, 120000);

describe('set_company_letterhead', () => {
  it('HR (without Settings) sets the header and footer, and nothing else of the profile', async () => {
    const before = await profile(A);
    expect(await set(HR, HEAD, FOOT)).toEqual({ letterhead_header_url: HEAD, letterhead_footer_url: FOOT });
    expect(await profile(A)).toEqual({ ...before, letterhead_header_url: HEAD, letterhead_footer_url: FOOT, updated_by: HR });
  });

  it('Recruitment may too; removing one leaves the other', async () => {
    expect(await set(REC, null, FOOT)).toEqual({ letterhead_header_url: null, letterhead_footer_url: FOOT });
  });

  it('staff can’t; only uploaded images (web addresses) are taken', async () => {
    expect(await set(STAFF, HEAD, null)).toMatch(/Only HR, Recruitment or Settings/);
    expect(await set(HR, 'javascript:alert(1)', null)).toMatch(/must be an uploaded image/);
  });

  it('a company with no profile yet gets one, named as the company is; the other company is untouched', async () => {
    expect(await set(HRB, HEAD, null)).toEqual({ letterhead_header_url: HEAD, letterhead_footer_url: null });
    expect(await profile(B)).toMatchObject({ company_name: 'Other Co', letterhead_header_url: HEAD });
    expect(await profile(A)).toMatchObject({ letterhead_header_url: null, letterhead_footer_url: FOOT });
  });
});
