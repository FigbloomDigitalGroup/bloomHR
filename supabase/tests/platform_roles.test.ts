// @vitest-environment node
//
// Console roles (migration 20261103100000_platform_roles.sql): owner, admin, support and viewer. The permission matrix
// (companies, auto-approve, statutory rates, staff); the staff rules (admins never touch owners, nobody removes
// themselves, the last owner stays); every change logged; the SQL editor and service role still able to do everything;
// existing admins becoming owners; and running the migration again.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootDb, bootLiveDb } from './db';

const OWNER = '00000000-0000-0000-0000-00000000e901';
const OWNER2 = '00000000-0000-0000-0000-00000000e902';
const ADMIN = '00000000-0000-0000-0000-00000000e903';
const SUPPORT = '00000000-0000-0000-0000-00000000e904';
const VIEWER = '00000000-0000-0000-0000-00000000e905';
const OUTSIDER = '00000000-0000-0000-0000-00000000e906'; // a login, not a platform admin
const FOUNDER = '00000000-0000-0000-0000-00000000e907'; // creates companies
const ADMIN2 = '00000000-0000-0000-0000-00000000e908';

const MIGRATION = join(__dirname, '..', 'migrations', '20261103100000_platform_roles.sql');

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
const roleOf = async (user: string) => (await rows<{ role: string }>(`select role from platform_admins where user_id = '${user}'`))[0]?.role;
const setRole = (by: string, user: string, role: string, reason = 'test') => as(by, `select set_platform_admin_role('${user}', '${role}', '${reason}')`);
let companies = 0;
const newCompany = async () =>
  (await read<{ id: string }>(FOUNDER, `select create_company('Roles Co ${++companies}') id`))[0].id;
const decide = (user: string, id: string, action: string, reason = 'because') =>
  read<{ s: string }>(user, `select set_company_status('${id}', '${action}', '${reason}') s`).then((r) => r[0].s);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values
      ('${OWNER}', 'owner@figbloom.org'), ('${OWNER2}', 'owner2@figbloom.org'), ('${ADMIN}', 'admin@figbloom.org'),
      ('${SUPPORT}', 'support@figbloom.org'), ('${VIEWER}', 'viewer@figbloom.org'), ('${OUTSIDER}', 'someone@a.co'),
      ('${FOUNDER}', 'founder@startup.co'), ('${ADMIN2}', 'admin2@figbloom.org');
    -- the SQL editor sets up the first owner (no role given: owner)
    select grant_platform_admin('${OWNER}', 'Figbloom founder');
  `);
  await as(OWNER, `
    select grant_platform_admin('${ADMIN}', null, 'admin');
    select grant_platform_admin('${SUPPORT}', null, 'support');
    select grant_platform_admin('${VIEWER}');
  `);
}, 120000);

describe('roles', () => {
  it('the SQL editor adds an owner by default; a signed-in owner adds a viewer by default', async () => {
    expect(await roleOf(OWNER)).toBe('owner');
    expect(await roleOf(VIEWER)).toBe('viewer');
    expect(await roleOf(ADMIN)).toBe('admin');
  });

  it('platform_role() is the signed-in person\'s role, or null', async () => {
    for (const [user, role] of [[OWNER, 'owner'], [ADMIN, 'admin'], [SUPPORT, 'support'], [VIEWER, 'viewer'], [OUTSIDER, null]] as const) {
      expect((await read<{ r: string | null }>(user, `select platform_role() r`))[0].r).toBe(role);
    }
  });

  it('the permission matrix', async () => {
    const perms = ['view', 'suspend_companies', 'approve_companies', 'edit_rates', 'manage_staff'];
    const matrix: Record<string, boolean[]> = {};
    for (const [name, user] of [['owner', OWNER], ['admin', ADMIN], ['support', SUPPORT], ['viewer', VIEWER], ['none', OUTSIDER]]) {
      matrix[name] = [];
      for (const p of perms) matrix[name].push((await read<{ ok: boolean }>(user, `select has_platform_permission('${p}') ok`))[0].ok);
    }
    expect(matrix).toEqual({
      owner: [true, true, true, true, true],
      admin: [true, true, true, true, true],
      support: [true, true, false, false, false],
      viewer: [true, false, false, false, false],
      none: [false, false, false, false, false],
    });
    await expect(read(OWNER, `select has_platform_permission('delete_everything')`)).rejects.toThrow(/Unknown platform permission/);
  });

  it('every role still counts as a platform admin and can view everything', async () => {
    for (const user of [OWNER, ADMIN, SUPPORT, VIEWER]) {
      expect((await read<{ ok: boolean }>(user, `select is_platform_admin() ok`))[0].ok).toBe(true);
      await read(user, `select * from platform_organisations()`);
      await read(user, `select platform_organisation_totals()`);
      await read(user, `select * from platform_staff()`);
      await read(user, `select * from platform_admin_changes_recent()`);
      await read(user, `select platform_latest_approved_month('Kenya')`);
    }
    const staff = await read<{ email: string; role: string }>(VIEWER, `select email, role from platform_staff() order by email`);
    expect(staff).toContainEqual({ email: 'support@figbloom.org', role: 'support' });
  });
});

describe('companies', () => {
  it('approving and rejecting: owner and admin only', async () => {
    const c1 = await newCompany();
    await expect(decide(SUPPORT, c1, 'approve')).rejects.toThrow(/Only an owner or admin can approve or reject/);
    await expect(decide(VIEWER, c1, 'reject')).rejects.toThrow(/Only an owner or admin/);
    expect(await decide(ADMIN, c1, 'approve')).toBe('active');
    const c2 = await newCompany();
    expect(await decide(OWNER, c2, 'reject', 'Not real')).toBe('rejected');
  });

  it('suspending and reactivating: owner, admin and support; never a viewer', async () => {
    const c = await newCompany();
    await decide(OWNER, c, 'approve');
    await expect(decide(VIEWER, c, 'suspend')).rejects.toThrow(/Only an owner, admin or support can suspend/);
    expect(await decide(SUPPORT, c, 'suspend', 'Unpaid')).toBe('suspended');
    await expect(decide(VIEWER, c, 'reactivate')).rejects.toThrow(/Only an owner, admin or support/);
    expect(await decide(SUPPORT, c, 'reactivate')).toBe('active');
    expect(await decide(ADMIN, c, 'suspend')).toBe('suspended');
  });

  it('the auto-approve switch: owner and admin only', async () => {
    for (const user of [SUPPORT, VIEWER]) {
      await expect(read(user, `select set_auto_approve_companies(true)`)).rejects.toThrow(/Only a platform admin can change how companies are approved/);
    }
    expect((await read<{ v: boolean }>(ADMIN, `select set_auto_approve_companies(true) v`))[0].v).toBe(true);
    expect((await read<{ v: boolean }>(OWNER, `select set_auto_approve_companies(false) v`))[0].v).toBe(false);
  });

  it('the SQL editor and the service role still decide anything', async () => {
    const c = await newCompany();
    expect((await rows<{ s: string }>(`select set_company_status('${c}', 'approve') s`))[0].s).toBe('active');
    expect((await asService(() => rows<{ s: string }>(`select set_company_status('${c}', 'suspend') s`)))[0].s).toBe('suspended');
    await asService(() => db.exec(`select set_auto_approve_companies(false)`));
  });
});

describe('statutory rates', () => {
  const add = (user: string, from: string) =>
    as(user, `select add_platform_rate('Kenya', 'roles_test_rate', 0.1, null, '${from}', 'Test Act')`);

  it('owner and admin edit them; support and viewer only read', async () => {
    await expect(add(SUPPORT, '2040-01-01')).rejects.toThrow(/Only a platform admin can change the platform rates/);
    await expect(add(VIEWER, '2040-01-01')).rejects.toThrow(/Only a platform admin can change the platform rates/);
    await add(ADMIN, '2040-01-01');
    await add(OWNER, '2041-01-01');
    await rows(`select add_platform_rate('Kenya', 'roles_test_rate', 0.2, null, '2042-01-01', 'Test Act')`); // SQL editor
    expect((await rows<{ n: number }>(`select count(*)::int n from statutory_rates where code = 'roles_test_rate' and tenant_id is null`))[0].n).toBe(3);
    // and nobody writes a platform row directly
    await expect(
      as(OWNER, `insert into statutory_rates (tenant_id, country, code, value, effective_from) values (null, 'Kenya', 'x_rate', 0.1, '2043-01-01')`)
    ).rejects.toThrow();
  });
});

describe('staff: support and viewer manage nobody', () => {
  it('cannot add, remove or change roles', async () => {
    for (const user of [SUPPORT, VIEWER]) {
      await expect(as(user, `select grant_platform_admin('${OUTSIDER}')`)).rejects.toThrow(/Only a platform admin can add a platform admin/);
      await expect(as(user, `select remove_platform_admin('${VIEWER}', 'x')`)).rejects.toThrow(/Only a platform admin can remove/);
      await expect(as(user, `select revoke_platform_admin('${VIEWER}')`)).rejects.toThrow(/Only a platform admin can remove/);
      await expect(setRole(user, VIEWER, 'support')).rejects.toThrow(/Only a platform admin can change roles/);
    }
    await expect(
      asService(() => db.exec(`select grant_platform_admin_as('${SUPPORT}', 'someone@a.co', null, 'viewer')`))
    ).rejects.toThrow(/Only a platform admin can add a platform admin/);
  });
});

describe('staff: admins never touch owners', () => {
  it('an admin invites as admin, support or viewer, never as owner', async () => {
    await expect(asService(() => db.exec(`select grant_platform_admin_as('${ADMIN}', 'admin2@figbloom.org', null, 'owner')`))).rejects.toThrow(
      /Only an owner can make someone an owner/
    );
    await expect(as(ADMIN, `select grant_platform_admin('${ADMIN2}', null, 'owner')`)).rejects.toThrow(/Only an owner can make someone an owner/);
    const [{ r }] = await asService(() => rows<{ r: { role: string; added: boolean } }>(`select grant_platform_admin_as('${ADMIN}', 'admin2@figbloom.org', 'Ops', 'admin') r`));
    expect(r).toMatchObject({ added: true, role: 'admin' });
    const [log] = await rows<{ action: string; new_role: string; changed_by: string }>(
      `select action, new_role, changed_by from platform_admin_changes where user_id = '${ADMIN2}'`
    );
    expect(log).toEqual({ action: 'added', new_role: 'admin', changed_by: ADMIN });
  });

  it('an admin cannot remove, demote or promote to owner', async () => {
    await expect(as(ADMIN, `select remove_platform_admin('${OWNER}', 'x')`)).rejects.toThrow(/Only an owner can remove an owner/);
    await expect(as(ADMIN, `select revoke_platform_admin('${OWNER}')`)).rejects.toThrow(/Only an owner can remove an owner/);
    await expect(setRole(ADMIN, OWNER, 'viewer')).rejects.toThrow(/Only an owner can/);
    await expect(setRole(ADMIN, SUPPORT, 'owner')).rejects.toThrow(/Only an owner can/);
    await expect(setRole(ADMIN, ADMIN, 'owner')).rejects.toThrow(/Only an owner can/);
    expect(await roleOf(OWNER)).toBe('owner');
  });

  it('an admin changes roles between admin, support and viewer, with a reason, logged', async () => {
    await expect(setRole(ADMIN, VIEWER, 'support', ' ')).rejects.toThrow(/Say why the role changes/);
    await setRole(ADMIN, VIEWER, 'support', 'Handles tickets now');
    expect(await roleOf(VIEWER)).toBe('support');
    const [log] = await read<{ action: string; old_role: string; new_role: string; note: string; changed_by_email: string }>(
      OWNER,
      `select action, old_role, new_role, note, changed_by_email from platform_admin_changes_recent(1)`
    );
    expect(log).toEqual({ action: 'role_changed', old_role: 'viewer', new_role: 'support', note: 'Handles tickets now', changed_by_email: 'admin@figbloom.org' });
    await setRole(ADMIN, VIEWER, 'viewer', 'Back to viewing');
    await expect(setRole(ADMIN, VIEWER, 'viewer')).rejects.toThrow(/already have that role/);
  });

  it('an admin removes a non-owner, never themselves, and may lower their own role', async () => {
    await expect(as(ADMIN2, `select remove_platform_admin('${ADMIN2}', 'leaving')`)).rejects.toThrow(/cannot remove yourself/);
    await setRole(ADMIN2, ADMIN2, 'support', 'Stepping back');
    expect(await roleOf(ADMIN2)).toBe('support');
    // ...and then has no staff management left
    await expect(setRole(ADMIN2, ADMIN2, 'admin')).rejects.toThrow(/Only a platform admin can change roles/);
    await as(ADMIN, `select remove_platform_admin('${ADMIN2}', 'Left Figbloom')`);
    expect(await roleOf(ADMIN2)).toBeUndefined();
    const [log] = await rows<{ action: string; old_role: string }>(
      `select action, old_role from platform_admin_changes where user_id = '${ADMIN2}' order by changed_at desc limit 1`
    );
    expect(log).toEqual({ action: 'removed', old_role: 'support' });
  });
});

describe('staff: owners, and the last owner', () => {
  it('the only owner cannot be demoted, nor demote themselves', async () => {
    await expect(setRole(OWNER, OWNER, 'admin')).rejects.toThrow(/The last owner cannot be given another role/);
    expect(await roleOf(OWNER)).toBe('owner');
  });

  it('an owner invites and promotes owners', async () => {
    await asService(() => db.exec(`select grant_platform_admin_as('${OWNER}', 'owner2@figbloom.org', null, 'viewer')`));
    await setRole(OWNER, OWNER2, 'owner', 'Co-founder');
    expect(await roleOf(OWNER2)).toBe('owner');
  });

  it('granting someone who is already an admin never changes their role', async () => {
    const [{ r }] = await asService(() => rows<{ r: { added: boolean; role: string } }>(`select grant_platform_admin_as('${OWNER}', 'viewer@figbloom.org', 'New note', 'admin') r`));
    expect(r).toMatchObject({ added: false, role: 'viewer' });
    await as(OWNER, `select grant_platform_admin('${VIEWER}', null, 'owner')`);
    expect(await roleOf(VIEWER)).toBe('viewer');
  });

  it('with another owner, an owner may demote themselves; then the last owner stays', async () => {
    await setRole(OWNER2, OWNER2, 'admin', 'Day-to-day only');
    expect(await roleOf(OWNER2)).toBe('admin');
    // OWNER is the last owner again: OWNER2 (now an admin) can't touch them, and they can't step down
    await expect(as(OWNER2, `select remove_platform_admin('${OWNER}', 'x')`)).rejects.toThrow(/Only an owner can remove an owner/);
    await expect(setRole(OWNER, OWNER, 'viewer')).rejects.toThrow(/last owner/);
  });

  it('an owner removes an owner, but never the last one', async () => {
    await setRole(OWNER, OWNER2, 'owner', 'Back as owner');
    await as(OWNER, `select remove_platform_admin('${OWNER2}', 'Left')`);
    expect(await roleOf(OWNER2)).toBeUndefined();
    expect((await rows<{ n: number }>(`select count(*)::int n from platform_admins where role = 'owner'`))[0].n).toBe(1);
  });

  it('the SQL editor can still change anyone, the last owner included (the way back in)', async () => {
    await rows(`select set_platform_admin_role('${SUPPORT}', 'owner', 'Recovery')`);
    expect(await roleOf(SUPPORT)).toBe('owner');
    await rows(`select set_platform_admin_role('${SUPPORT}', 'support', 'Recovery done')`);
    const [log] = await rows<{ changed_by: string | null; new_role: string }>(
      `select changed_by, new_role from platform_admin_changes where user_id = '${SUPPORT}' order by changed_at desc limit 1`
    );
    expect(log).toEqual({ changed_by: null, new_role: 'support' });
  });

  it('a company administrator who is no platform admin changes nothing', async () => {
    await expect(setRole(OUTSIDER, VIEWER, 'owner')).rejects.toThrow(/Only a platform admin can change roles/);
    await expect(read(OUTSIDER, `select * from platform_staff()`)).rejects.toThrow(/Only a platform admin/);
  });
});

describe('existing platform admins', () => {
  it('become owners when the migration runs', async () => {
    const seeded = await bootDb({
      file: '20261103100000_platform_roles.sql',
      seed: async (d) => {
        await d.exec(`
          insert into auth.users (id, email) values ('${OWNER}', 'owner@figbloom.org'), ('${VIEWER}', 'v@figbloom.org');
          insert into platform_admins (user_id, note) values ('${OWNER}', 'one'), ('${VIEWER}', 'two');
        `);
      },
    });
    expect((await seeded.query<{ role: string }>(`select role from platform_admins order by user_id`)).rows).toEqual([{ role: 'owner' }, { role: 'owner' }]);
    await seeded.close();
  }, 120000);
});

describe('running the migration again', () => {
  it('changes nothing', async () => {
    const q = {
      admins: `select user_id, note, role, added_by from platform_admins order by user_id`,
      log: `select user_id, action, old_role, new_role, changed_by from platform_admin_changes order by changed_at, id`,
    };
    const before = { admins: await rows(q.admins), log: await rows(q.log) };
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    expect(await rows(q.admins)).toEqual(before.admins);
    expect(await rows(q.log)).toEqual(before.log);
  });
});
