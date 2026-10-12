// @vitest-environment node
//
// Company agreements (20261012600000): HR publishes policies; each employee accepts each with its own checkbox (their
// signature, tied to the exact version); a new version is accepted again; required ones hold up onboarding.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const U = {
  STAFF: '00000000-0000-0000-0000-00000000c101', // E-ME
  HR: '00000000-0000-0000-0000-00000000c102',
  PAYROLL: '00000000-0000-0000-0000-00000000c103',
  OTHER_CO: '00000000-0000-0000-0000-00000000c104',
};

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const run = async (sql: string) => {
  try {
    await db.query(sql);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
let conduct = '';
const latestVersion = async (policy: string) =>
  (await rows<{ id: string; version: number; content_hash: string }>(`select id, version, content_hash from company_policy_versions where policy_id = '${policy}' order by version desc limit 1`))[0];
const checklist = (as: string) =>
  asUser(db, as, () => rows<{ title: string; version: number; accepted_at: string | null; required: boolean }>(`select title, version, accepted_at, required from policy_checklist()`));
const missing = async () =>
  (await asUser(db, U.STAFF, () => rows<{ employee_part: string[] }>(`select * from onboarding_missing_for()`)))[0].employee_part.filter((m) => m.startsWith('Agreement'));

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  for (const [id, email, role, t] of [[U.STAFF, 'me@a.co', 'STAFF', A], [U.HR, 'hr@a.co', 'HR', A], [U.PAYROLL, 'pay@a.co', 'PAYROLL', A], [U.OTHER_CO, 'x@b.co', 'ADMIN', B]]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${t}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('STAFF', array['dashboard'], '${A}'), ('HR', array['employees'], '${A}'), ('PAYROLL', array['payroll'], '${A}');
    insert into employees ("Employee Number", "First Name", "Work Email", tenant_id) values ('E-ME', 'Amina', 'me@a.co', '${A}');
  `);
}, 120000);

describe('publishing', () => {
  it('HR publishes a policy and its wording; staff and payroll cannot', async () => {
    await asUser(db, U.HR, async () => {
      conduct = (await rows<{ id: string }>(`insert into company_policies (title) values ('Code of conduct') returning id`))[0].id;
      expect(await run(`insert into company_policy_versions (policy_id, body) values ('${conduct}', 'Be honest.')`)).toBe('');
      expect(await run(`insert into company_policies (title, required) values ('Gym membership', false)`)).toBe('');
    });
    const gym = (await rows<{ id: string }>(`select id from company_policies where title = 'Gym membership'`))[0].id;
    await asUser(db, U.HR, () => run(`insert into company_policy_versions (policy_id, body) values ('${gym}', 'Optional.')`));
    expect(await asUser(db, U.STAFF, () => run(`insert into company_policies (title) values ('Mine')`))).toMatch(/row-level security/);
    expect(await asUser(db, U.PAYROLL, () => run(`insert into company_policy_versions (policy_id, body) values ('${conduct}', 'x')`))).toMatch(/row-level security/);
  });

  it('numbers each version, fingerprints its wording, and never lets it change', async () => {
    const v = await latestVersion(conduct);
    expect(v.version).toBe(1);
    expect(v.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await run(`update company_policy_versions set body = 'Be very honest.' where id = '${v.id}'`)).toMatch(/publish a new version/);
  });

  it('needs wording or a file', async () => {
    expect(await asUser(db, U.HR, () => run(`insert into company_policy_versions (policy_id, body) values ('${conduct}', '  ')`))).toMatch(/check/);
  });

  it('another company sees none of it', async () => {
    expect(await asUser(db, U.OTHER_CO, () => rows(`select 1 from company_policies`))).toEqual([]);
  });
});

describe('accepting', () => {
  it('a required policy not yet accepted holds up onboarding', async () => {
    expect(await missing()).toEqual(['Agreement: Code of conduct']);
    const list = await checklist(U.STAFF);
    expect(list.map((p) => [p.title, p.required, p.accepted_at])).toEqual([['Code of conduct', true, null], ['Gym membership', false, null]]);
  });

  it('the checkbox records who accepted which version, its fingerprint, when, and from which browser', async () => {
    const v = await latestVersion(conduct);
    expect(await asUser(db, U.STAFF, () => run(`select accept_policy('${v.id}', 'Mozilla/5.0 test')`))).toBe('');
    const [a] = await rows<{ accepted_by: string; content_hash: string; user_agent: string }>(`select accepted_by, content_hash, user_agent from policy_acceptances`);
    expect(a).toEqual({ accepted_by: U.STAFF, content_hash: v.content_hash, user_agent: 'Mozilla/5.0 test' });
    expect(await missing()).toEqual([]);
  });

  it('nobody else accepts for the employee, and an acceptance is never changed', async () => {
    const v = await latestVersion(conduct);
    expect(await asUser(db, U.HR, () => run(`select accept_policy('${v.id}')`))).toMatch(/Employee record not found/);
    expect(await asUser(db, U.STAFF, () => run(`insert into policy_acceptances (employee_id, version_id, content_hash)
      select id, '${v.id}', 'x' from employees`))).toMatch(/row-level security|permission/);
    expect(await asUser(db, U.STAFF, () => rows(`delete from policy_acceptances returning 1`))).toEqual([]);
    expect(await asUser(db, U.HR, () => rows(`update policy_acceptances set user_agent = 'x' returning 1`))).toEqual([]);
  });

  it('a new version must be accepted again, and the old one can no longer be', async () => {
    const old = await latestVersion(conduct);
    await asUser(db, U.HR, () => run(`insert into company_policy_versions (policy_id, body) values ('${conduct}', 'Be honest and kind.')`));
    expect((await latestVersion(conduct)).version).toBe(2);
    expect(await missing()).toEqual(['Agreement: Code of conduct']);
    expect(await asUser(db, U.STAFF, () => run(`select accept_policy('${old.id}')`))).toMatch(/newer version/);
  });

  it('HR sees who accepted what; an inactive policy is no longer asked for', async () => {
    expect((await asUser(db, U.HR, () => rows(`select 1 from policy_acceptances`))).length).toBe(1);
    await asUser(db, U.HR, () => run(`update company_policies set active = false where id = '${conduct}'`));
    expect(await missing()).toEqual([]);
  });
});
