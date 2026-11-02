// @vitest-environment node
//
// Platform staff (migration 20261102100000_platform_staff.sql): platform admins see each other (with whether they also
// belong to a company), add one on another admin's behalf from the backend, remove one with a reason (never themselves,
// never the last one), and every change is logged; nobody else sees or changes any of it; the existing
// grant_platform_admin() and revoke_platform_admin() keep working and now log too; and running the migration again.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001'; // an existing company
const OPS = '00000000-0000-0000-0000-00000000d901'; // a platform admin in no company
const STAFF_OPS = '00000000-0000-0000-0000-00000000d902'; // a platform admin who is also staff of A
const NEWBIE = '00000000-0000-0000-0000-00000000d903'; // a login with no company, invited from the console
const ADMIN_A = '00000000-0000-0000-0000-00000000d904'; // administrator of A, not a platform admin
const OTHER = '00000000-0000-0000-0000-00000000d905';

const MIGRATION = join(__dirname, '..', 'migrations', '20261102100000_platform_staff.sql');

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const asService = async <T>(fn: () => Promise<T>) => {
  await db.exec('set role service_role');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
};
const changes = () =>
  rows<{ user_id: string | null; email: string; action: string; note: string | null; changed_by: string | null }>(
    `select user_id, email, action, note, changed_by from platform_admin_changes order by changed_at, action, email`
  );

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data, last_sign_in_at) values
      ('${OPS}', 'ops@figbloom.org', '{}', now() - interval '1 day'),
      ('${STAFF_OPS}', 'mary@figbloom.org', '{}', now() - interval '2 days'),
      ('${NEWBIE}', 'New.Person@Figbloom.org', '{}', null),
      ('${ADMIN_A}', 'admin@a.co', '{}', now()),
      ('${OTHER}', 'other@figbloom.org', '{}', null);
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${STAFF_OPS}', 'mary@figbloom.org', 'STAFF', '${A}'), ('${ADMIN_A}', 'admin@a.co', 'ADMIN', '${A}');
    insert into memberships (user_id, tenant_id, role) values ('${STAFF_OPS}', '${A}', 'STAFF'), ('${ADMIN_A}', '${A}', 'ADMIN')
      on conflict do nothing;
    select grant_platform_admin('${OPS}', 'Figbloom ops');
  `);
}, 120000);

describe('adding a platform admin', () => {
  it('from the SQL editor, as before, and it is logged', async () => {
    expect(await changes()).toEqual([
      { user_id: OPS, email: 'ops@figbloom.org', action: 'added', note: 'Figbloom ops', changed_by: null },
    ]);
  });

  it('by another platform admin through grant_platform_admin(), logged with who did it', async () => {
    await as(OPS, `select grant_platform_admin('${STAFF_OPS}', 'Payroll lead')`);
    // granting again only updates the note: no second log entry
    await as(OPS, `select grant_platform_admin('${STAFF_OPS}')`);
    const log = (await changes()).filter((c) => c.user_id === STAFF_OPS);
    expect(log).toEqual([{ user_id: STAFF_OPS, email: 'mary@figbloom.org', action: 'added', note: 'Payroll lead', changed_by: OPS }]);
    const [row] = await rows<{ note: string; added_by: string }>(`select note, added_by from platform_admins where user_id = '${STAFF_OPS}'`);
    expect(row).toEqual({ note: 'Payroll lead', added_by: OPS });
  });

  it('on an admin\'s behalf from the backend (service role), by email, logged as that admin', async () => {
    const [{ r }] = await asService(() =>
      rows<{ r: { user_id: string; email: string; added: boolean } }>(`select grant_platform_admin_as('${OPS}', ' new.person@figbloom.ORG ', 'Support') r`)
    );
    expect(r).toEqual({ user_id: NEWBIE, email: 'new.person@figbloom.org', added: true });
    const log = (await changes()).filter((c) => c.user_id === NEWBIE);
    expect(log).toEqual([{ user_id: NEWBIE, email: 'New.Person@Figbloom.org', action: 'added', note: 'Support', changed_by: OPS }]);
    const [again] = await asService(() => rows<{ r: { added: boolean } }>(`select grant_platform_admin_as('${OPS}', 'new.person@figbloom.org') r`));
    expect(again.r.added).toBe(false);
    expect((await changes()).filter((c) => c.user_id === NEWBIE)).toHaveLength(1);
  });

  it('the backend says when there is no login with that email yet', async () => {
    await expect(asService(() => db.exec(`select grant_platform_admin_as('${OPS}', 'nobody@figbloom.org')`))).rejects.toThrow(/No login with this email/);
  });

  it('only on behalf of a platform admin, and only from the backend', async () => {
    await expect(asService(() => db.exec(`select grant_platform_admin_as('${ADMIN_A}', 'other@figbloom.org')`))).rejects.toThrow(
      /Only a platform admin can add a platform admin/
    );
    // a signed-in platform admin cannot claim to be someone else
    await expect(as(OPS, `select grant_platform_admin_as('${STAFF_OPS}', 'other@figbloom.org')`)).rejects.toThrow(/permission denied/);
    await expect(as(ADMIN_A, `select grant_platform_admin('${ADMIN_A}')`)).rejects.toThrow(/Only a platform admin can add a platform admin/);
    expect((await rows(`select 1 from platform_admins where user_id in ('${OTHER}', '${ADMIN_A}')`))).toEqual([]);
  });

  it('nobody calls the internal helpers', async () => {
    await expect(as(OPS, `select platform_admin_add('${OTHER}', null, '${OPS}')`)).rejects.toThrow(/permission denied/);
    await expect(as(OPS, `select platform_admin_remove('${STAFF_OPS}', null, '${OPS}')`)).rejects.toThrow(/permission denied/);
  });
});

describe('the Staff page', () => {
  it('lists every platform admin with who added them, their last sign-in and whether they are in a company', async () => {
    const list = await read<{
      email: string; note: string | null; added_by_email: string | null; last_sign_in_at: string | null; in_company: boolean; companies: number;
    }>(OPS, `select email, note, added_by_email, last_sign_in_at, in_company, companies from platform_staff() order by lower(email)`);
    expect(list.map((s) => s.email)).toEqual(['mary@figbloom.org', 'New.Person@Figbloom.org', 'ops@figbloom.org']);
    const by = Object.fromEntries(list.map((s) => [s.email, s]));
    expect(by['ops@figbloom.org']).toMatchObject({ note: 'Figbloom ops', added_by_email: null, in_company: false, companies: 0 });
    expect(by['ops@figbloom.org'].last_sign_in_at).not.toBeNull();
    expect(by['mary@figbloom.org']).toMatchObject({ added_by_email: 'ops@figbloom.org', in_company: true, companies: 1 });
    expect(by['New.Person@Figbloom.org']).toMatchObject({ note: 'Support', in_company: false, last_sign_in_at: null });
  });

  it('is for platform admins only: not a company administrator, not the service role', async () => {
    await expect(read(ADMIN_A, `select * from platform_staff()`)).rejects.toThrow(/Only a platform admin can see the platform admins/);
    await expect(read(ADMIN_A, `select * from platform_admin_changes_recent()`)).rejects.toThrow(/Only a platform admin/);
    await expect(asService(() => db.exec(`select * from platform_staff()`))).rejects.toThrow();
    await expect(asService(() => db.exec(`select * from platform_admin_changes_recent()`))).rejects.toThrow();
    // and the log itself is hidden from them and written by nobody directly
    expect(await read(ADMIN_A, `select * from platform_admin_changes`)).toEqual([]);
    await expect(as(OPS, `insert into platform_admin_changes (action) values ('added')`)).rejects.toThrow(/permission denied/);
    await expect(as(OPS, `delete from platform_admin_changes`)).rejects.toThrow(/permission denied/);
  });
});

describe('removing a platform admin', () => {
  it('needs a reason', async () => {
    await expect(as(OPS, `select remove_platform_admin('${NEWBIE}', null)`)).rejects.toThrow(/Say why/);
    await expect(as(OPS, `select remove_platform_admin('${NEWBIE}', '   ')`)).rejects.toThrow(/Say why/);
  });

  it('is for platform admins only', async () => {
    await expect(as(ADMIN_A, `select remove_platform_admin('${NEWBIE}', 'no')`)).rejects.toThrow(/Only a platform admin can remove/);
    await expect(asService(() => db.exec(`select remove_platform_admin('${NEWBIE}', 'no')`))).rejects.toThrow();
  });

  it('never yourself', async () => {
    await expect(as(OPS, `select remove_platform_admin('${OPS}', 'leaving')`)).rejects.toThrow(/cannot remove yourself/);
    await expect(as(OPS, `select revoke_platform_admin('${OPS}')`)).rejects.toThrow(/cannot remove yourself/);
  });

  it('refuses someone who is not a platform admin', async () => {
    await expect(as(OPS, `select remove_platform_admin('${ADMIN_A}', 'typo')`)).rejects.toThrow(/Not a platform admin/);
  });

  it('removes another admin and logs the reason and who did it', async () => {
    await as(OPS, `select remove_platform_admin('${NEWBIE}', 'Left the support team')`);
    expect((await read<{ ok: boolean }>(NEWBIE, `select is_platform_admin() ok`))[0].ok).toBe(false);
    const recent = await read<{ email: string; action: string; note: string; changed_by_email: string }>(
      OPS,
      `select email, action, note, changed_by_email from platform_admin_changes_recent(1)`
    );
    expect(recent).toEqual([{ email: 'New.Person@Figbloom.org', action: 'removed', note: 'Left the support team', changed_by_email: 'ops@figbloom.org' }]);
  });

  it('revoke_platform_admin() is guarded and logged the same way, with a default reason', async () => {
    await as(OPS, `select grant_platform_admin('${OTHER}')`);
    await as(OPS, `select revoke_platform_admin('${OTHER}')`);
    const log = (await changes()).filter((c) => c.user_id === OTHER).map((c) => [c.action, c.changed_by, c.note]);
    expect(log).toEqual([['added', OPS, null], ['removed', OPS, 'Removed with revoke_platform_admin()']]);
  });

  it('never the last platform admin', async () => {
    await as(OPS, `select remove_platform_admin('${STAFF_OPS}', 'Moved to payroll only')`);
    expect(await rows<{ user_id: string }>(`select user_id from platform_admins`)).toEqual([{ user_id: OPS }]);
    // OPS is the last one: they can't remove themselves, and nobody else is left to do it
    await expect(as(OPS, `select remove_platform_admin('${OPS}', 'bye')`)).rejects.toThrow(/cannot remove yourself/);
    expect((await rows<{ n: number }>(`select count(*)::int n from platform_admins`))[0].n).toBe(1);
  });

  it('the recent changes come newest first, with a limit', async () => {
    const recent = await read<{ action: string }>(OPS, `select action from platform_admin_changes_recent(3)`);
    expect(recent).toHaveLength(3);
    expect(recent[0].action).toBe('removed');
    const all = await read(OPS, `select * from platform_admin_changes_recent()`);
    expect(all.length).toBe((await changes()).length);
  });
});

describe('running the migration again', () => {
  it('changes nothing', async () => {
    const q = {
      admins: `select user_id, note, added_by from platform_admins order by user_id`,
      log: `select user_id, email, action, note, changed_by from platform_admin_changes order by changed_at, id`,
    };
    const before = { admins: await rows(q.admins), log: await rows(q.log) };
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    expect(await rows(q.admins)).toEqual(before.admins);
    expect(await rows(q.log)).toEqual(before.log);
  });
});
