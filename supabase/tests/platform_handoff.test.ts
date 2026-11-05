// @vitest-environment node
//
// Schools -> HR one-click sign-in (20261106100000): the functions the backend calls (platform_handoff_routes.js) and
// who may see what.
//   platform_handoff_begin()     linked -> switched into the company; no access; not linked -> a pending record
//   platform_handoff_complete()  this browser, unused, not expired, a member of that same company -> linked once
//   platform_handoff_unlink()    a person removes their own link
//   external_logins              each person reads their own; nobody writes but the backend; audited
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const PT = '7a1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c10'; // the school on the platform
const PT_OTHER = '8b2c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c11';
const HEAD = '00000000-0000-0000-0000-00000000c001'; // the school's head, an HR admin there
const BURSAR = '00000000-0000-0000-0000-00000000c002'; // another member of the school's company
const OUTSIDER = '00000000-0000-0000-0000-00000000c003'; // a member of another company only
const LEFT = '00000000-0000-0000-0000-00000000c004'; // was a member of the school's company, deactivated

let db: PGlite;
let school: string;
let other: string;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const h = (v: string) => createHash('sha256').update(v).digest('hex');

type Begin = { outcome: string; tenant_id: string | null; user_id: string | null };
const begin = async (person: string, token = `pending-${person}-${Math.random()}`, browser = 'browser-1', tenant = school, pt = PT, returnTo: string | null = '/payroll') =>
  (await rows<Begin>(`select * from platform_handoff_begin($1, $2, 'schools', $3, $4::jsonb, $5, $6, $7)`, [
    tenant, pt, person, JSON.stringify({ name: 'Mary Head', email: 'head@hillside.ac.ke', role: 'school_admin' }), returnTo, h(token), h(browser),
  ]))[0];

type Complete = { outcome: string; tenant_id: string | null; return_to: string | null; source: string | null; external_id: string | null; person_name: string | null; company_name: string | null };
const complete = async (token: string, browser: string, user: string | null, confirm: boolean) =>
  (await rows<Complete>(`select * from platform_handoff_complete($1, $2, $3, $4)`, [h(token), h(browser), user, confirm]))[0];

const currentCompany = async (user: string) => (await rows<{ tenant_id: string }>(`select tenant_id from user_profiles where user_id = $1`, [user]))[0]?.tenant_id;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into role_permissions (role_name, permissions, tenant_id) values
    ('ADMIN', array['dashboard', 'employees'], '00000000-0000-0000-0000-000000000001'),
    ('STAFF', array['dashboard'], '00000000-0000-0000-0000-000000000001')`);
  school = (await rows<{ tenant_id: string }>(`select tenant_id from platform_enable_hr($1, 'Hillside Primary', 'hillside', '[]')`, [PT]))[0].tenant_id;
  other = (await rows<{ tenant_id: string }>(`select tenant_id from platform_enable_hr($1, 'Other School', 'other-school', '[]')`, [PT_OTHER]))[0].tenant_id;
  const D = '00000000-0000-0000-0000-000000000001';
  await db.exec(`
    insert into auth.users (id, email) values
      ('${HEAD}', 'head@hillside.ac.ke'), ('${BURSAR}', 'bursar@hillside.ac.ke'), ('${OUTSIDER}', 'x@other.ac.ke'), ('${LEFT}', 'left@hillside.ac.ke');
    -- everyone starts in the default company, so a handoff visibly switches them
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HEAD}', 'head@hillside.ac.ke', 'ADMIN', '${D}'), ('${BURSAR}', 'bursar@hillside.ac.ke', 'STAFF', '${D}'),
      ('${OUTSIDER}', 'x@other.ac.ke', 'ADMIN', '${other}'), ('${LEFT}', 'left@hillside.ac.ke', 'STAFF', '${D}');
    insert into memberships (user_id, tenant_id, role, account_status) values
      ('${HEAD}', '${school}', 'ADMIN', 'ACTIVE'), ('${BURSAR}', '${school}', 'STAFF', 'ACTIVE'),
      ('${OUTSIDER}', '${other}', 'ADMIN', 'ACTIVE'), ('${LEFT}', '${school}', 'STAFF', 'DEACTIVATED')
      on conflict (user_id, tenant_id) do update set role = excluded.role, account_status = excluded.account_status;
  `);
}, 120000);

describe('not linked yet: a pending record, never a match by email', () => {
  it('a first handoff stores a pending record (hashes only, 10 minutes, the claims) and links nobody', async () => {
    const r = await begin('person-head', 'tok-1');
    expect(r).toEqual({ outcome: 'pending', tenant_id: school, user_id: null });
    const [p] = await rows<Record<string, unknown>>(
      `select token_hash, browser_hash, source, external_id, person, return_to, used_at,
              round(extract(epoch from (expires_at - created_at)))::int secs from platform_handoff_pending where token_hash = $1`, [h('tok-1')]);
    expect(p).toEqual({
      token_hash: h('tok-1'), browser_hash: h('browser-1'), source: 'schools', external_id: 'person-head',
      person: { name: 'Mary Head', email: 'head@hillside.ac.ke', role: 'school_admin' }, return_to: '/payroll', used_at: null, secs: 600,
    });
    // the claims carry the head's real address, yet nobody is linked by it
    expect(await rows(`select 1 from external_logins`)).toEqual([]);
  });

  it('a company that is not this school\'s is unknown_company', async () => {
    expect((await begin('p', 'tok-x', 'b', school, PT_OTHER)).outcome).toBe('unknown_company');
    expect((await begin('p', 'tok-y', 'b', '00000000-0000-0000-0000-0000000000ff', PT)).outcome).toBe('unknown_company');
  });
});

describe('finishing it after a normal sign-in', () => {
  it('only from the browser that started it', async () => {
    expect((await complete('tok-1', 'another-browser', HEAD, true)).outcome).toBe('other_browser');
    expect((await complete('no-such-token', 'browser-1', HEAD, true)).outcome).toBe('invalid');
  });

  it('a login of another company is told so, nothing is linked and the record stays for the right login', async () => {
    const r = await complete('tok-1', 'browser-1', OUTSIDER, true);
    expect(r).toMatchObject({ outcome: 'wrong_company', company_name: 'Hillside Primary' });
    expect((await complete('tok-1', 'browser-1', LEFT, true)).outcome).toBe('wrong_company'); // deactivated there
    expect(await rows(`select 1 from external_logins`)).toEqual([]);
    expect(await rows(`select used_at from platform_handoff_pending where token_hash = $1`, [h('tok-1')])).toEqual([{ used_at: null }]);
  });

  it('a look first changes nothing', async () => {
    const r = await complete('tok-1', 'browser-1', HEAD, false);
    expect(r).toMatchObject({ outcome: 'ready', person_name: 'Mary Head', company_name: 'Hillside Primary' });
    expect(await rows(`select 1 from external_logins`)).toEqual([]);
    expect(await currentCompany(HEAD)).not.toBe(school);
  });

  it('a member of that company is linked, the record used up, and they are switched into the company', async () => {
    const r = await complete('tok-1', 'browser-1', HEAD, true);
    expect(r).toMatchObject({ outcome: 'linked', tenant_id: school, return_to: '/payroll', source: 'schools', external_id: 'person-head' });
    expect(await rows(`select tenant_id, source, external_id, user_id from external_logins`)).toEqual([
      { tenant_id: school, source: 'schools', external_id: 'person-head', user_id: HEAD },
    ]);
    expect(await rows(`select used_by, used_at is not null used from platform_handoff_pending where token_hash = $1`, [h('tok-1')])).toEqual([
      { used_by: HEAD, used: true },
    ]);
    expect(await currentCompany(HEAD)).toBe(school);
  });

  it('the link is in the audit log', async () => {
    expect(await rows(`select table_name, action_type, tenant_id from audit_log where table_name = 'external_logins'`)).toEqual([
      { table_name: 'external_logins', action_type: 'INSERT', tenant_id: school },
    ]);
  });

  it('a pending record works once', async () => {
    expect((await complete('tok-1', 'browser-1', HEAD, true)).outcome).toBe('used');
    expect((await complete('tok-1', 'browser-1', HEAD, false)).outcome).toBe('used');
  });

  it('expires after 10 minutes', async () => {
    await begin('person-bursar', 'tok-old', 'browser-2');
    await db.query(`update platform_handoff_pending set expires_at = now() - interval '1 second' where token_hash = $1`, [h('tok-old')]);
    expect((await complete('tok-old', 'browser-2', BURSAR, true)).outcome).toBe('expired');
    expect(await rows(`select 1 from external_logins where user_id = $1`, [BURSAR])).toEqual([]);
  });

  it('one Schools person is one HR login, and one HR login one Schools person, per company', async () => {
    // someone else signing in for the head's Schools account
    await begin('person-head', 'tok-taken', 'browser-3');
    expect(await rows(`select outcome from platform_handoff_begin($1, $2, 'schools', 'person-head', '{}', null, $3, $4)`, [school, PT, h('t-z'), h('b-z')]))
      .toEqual([{ outcome: 'linked' }]); // linked already: no pending record at all
    await db.query(`insert into platform_handoff_pending (tenant_id, token_hash, browser_hash, source, platform_tenant_id, external_id, expires_at)
                    values ($1, $2, $3, 'schools', $4, 'person-head', now() + interval '5 minutes')`, [school, h('tok-taken2'), h('browser-3'), PT]);
    expect((await complete('tok-taken2', 'browser-3', BURSAR, true)).outcome).toBe('taken');
    // the head connecting a second Schools person
    await begin('person-second', 'tok-second', 'browser-4');
    expect((await complete('tok-second', 'browser-4', HEAD, true)).outcome).toBe('user_has_other');
    expect((await rows(`select 1 from external_logins`)).length).toBe(1);
  });
});

describe('linked: signing in', () => {
  it('a linked member is switched into the company and named for sign-in', async () => {
    await db.query(`update user_profiles set tenant_id = '00000000-0000-0000-0000-000000000001' where user_id = $1`, [HEAD]);
    const r = await begin('person-head', 'tok-again');
    expect(r).toEqual({ outcome: 'linked', tenant_id: school, user_id: HEAD });
    expect(await currentCompany(HEAD)).toBe(school);
    expect(await rows(`select 1 from platform_handoff_pending where token_hash = $1`, [h('tok-again')])).toEqual([]);
  });

  it('no access once they are no longer an active member, or the company is not active: nobody is switched', async () => {
    await db.query(`update user_profiles set tenant_id = '00000000-0000-0000-0000-000000000001' where user_id = $1`, [HEAD]);
    await db.query(`update memberships set account_status = 'SUSPENDED' where user_id = $1 and tenant_id = $2`, [HEAD, school]);
    expect(await begin('person-head')).toEqual({ outcome: 'no_access', tenant_id: school, user_id: HEAD });
    expect(await currentCompany(HEAD)).toBe('00000000-0000-0000-0000-000000000001');

    await db.query(`update memberships set account_status = 'ACTIVE' where user_id = $1 and tenant_id = $2`, [HEAD, school]);
    await db.query(`update tenants set status = 'suspended' where id = $1`, [school]);
    expect((await begin('person-head')).outcome).toBe('no_access');
    await db.query(`update tenants set status = 'active' where id = $1`, [school]);
    expect((await begin('person-head')).outcome).toBe('linked');
  });

  it('pending records over a day old are cleared on the way', async () => {
    await db.query(`update platform_handoff_pending set created_at = now() - interval '2 days' where token_hash = $1`, [h('tok-old')]);
    await begin('person-new', 'tok-new');
    expect(await rows(`select 1 from platform_handoff_pending where token_hash = $1`, [h('tok-old')])).toEqual([]);
  });
});

describe('who can see and change it', () => {
  it('a person reads their own link only; nobody writes it directly', async () => {
    await db.query(`insert into external_logins (tenant_id, source, external_id, user_id) values ($1, 'schools', 'person-bursar', $2)`, [school, BURSAR]);
    await db.query(`update user_profiles set tenant_id = $1 where user_id in ($2, $3)`, [school, HEAD, BURSAR]);
    await asUser(db, HEAD, async () => {
      expect(await rows(`select external_id from external_logins`)).toEqual([{ external_id: 'person-head' }]);
      await expect(db.query(`insert into external_logins (tenant_id, source, external_id, user_id) values ($1, 'schools', 'evil', $2)`, [school, HEAD]))
        .rejects.toThrow(/permission denied/);
      await expect(db.query(`update external_logins set user_id = $1`, [HEAD])).rejects.toThrow(/permission denied/);
      await expect(db.query(`delete from external_logins`)).rejects.toThrow(/permission denied/);
    });
    await asUser(db, BURSAR, async () => {
      expect(await rows(`select external_id from external_logins`)).toEqual([{ external_id: 'person-bursar' }]);
    });
    await asUser(db, OUTSIDER, async () => {
      expect(await rows(`select 1 from external_logins`)).toEqual([]);
    });
  });

  it('pending records, the log and the functions are the backend\'s only', async () => {
    await db.query(`insert into platform_handoff_log (outcome, source, tenant_id) values ('signed_in', 'schools', $1)`, [school]);
    await asUser(db, HEAD, async () => {
      await expect(db.query(`select * from platform_handoff_pending`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`select * from platform_handoff_log`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`select * from platform_handoff_begin($1, $2, 'schools', 'x', '{}', null, $3, $4)`, [school, PT, h('a'), h('b')]))
        .rejects.toThrow(/permission denied/);
      await expect(db.query(`select * from platform_handoff_complete($1, $2, $3, true)`, [h('a'), h('b'), HEAD])).rejects.toThrow(/permission denied/);
      await expect(db.query(`select platform_handoff_unlink($1, $2, 'schools')`, [BURSAR, school])).rejects.toThrow(/permission denied/);
      await expect(db.query(`select platform_handoff_enter($1, $2)`, [school, HEAD])).rejects.toThrow(/permission denied/);
    });
    await asAnon(db, async () => {
      await expect(db.query(`select * from external_logins`)).rejects.toThrow(/permission denied/);
    });
  });

  it('unlinking removes only that person\'s own link in that company, and is audited', async () => {
    expect(await rows(`select platform_handoff_unlink($1, $2, 'schools') n`, [HEAD, other])).toEqual([{ n: 0 }]);
    expect(await rows(`select platform_handoff_unlink($1, $2, 'schools') n`, [HEAD, school])).toEqual([{ n: 1 }]);
    expect(await rows(`select user_id from external_logins order by 1`)).toEqual([{ user_id: BURSAR }]);
    expect((await rows(`select 1 from audit_log where table_name = 'external_logins' and action_type = 'DELETE'`)).length).toBe(1);
  });
});
