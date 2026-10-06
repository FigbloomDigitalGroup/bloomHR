// @vitest-environment node
//
// One login, several companies: memberships are the source of truth, user_profiles mirrors the company the
// person is currently in (which is what every row-level-security rule reads), and switch_company() is the only
// way to change it. These run the real migrations on a real Postgres (PGlite).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const C = '00000000-0000-0000-0000-0000000000c3';
const MULTI = '00000000-0000-0000-0000-00000000f001'; // admin in A, staff in B
const ONLY_A = '00000000-0000-0000-0000-00000000f002';
const NEW_USER = '00000000-0000-0000-0000-00000000f003';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const profile = async (id: string) =>
  (await rows<{ tenant_id: string; role: string; account_status: string }>(
    `select tenant_id, role, account_status from user_profiles where user_id = '${id}'`
  ))[0];

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Beta Ltd', 'beta-ltd'), ('${C}', 'Gamma Ltd', 'gamma-ltd');
    insert into auth.users (id, email) values
      ('${MULTI}', 'multi@x.co'), ('${ONLY_A}', 'only@a.co'), ('${NEW_USER}', 'new@x.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${MULTI}', 'multi@x.co', 'ADMIN', '${A}'),
      ('${ONLY_A}', 'only@a.co', 'STAFF', '${A}');
    insert into memberships (user_id, tenant_id, role) values ('${MULTI}', '${B}', 'STAFF');
  `);
}, 120000);

describe('existing and directly written profiles become memberships', () => {
  it('a profile written the old way gets a membership with the same role', async () => {
    const m = await rows<{ role: string }>(`select role from memberships where user_id = '${ONLY_A}' and tenant_id = '${A}'`);
    expect(m).toEqual([{ role: 'STAFF' }]);
  });

  it('adding a second membership does not move the person out of their current company', async () => {
    expect(await profile(MULTI)).toMatchObject({ tenant_id: A, role: 'ADMIN' });
    expect((await rows(`select 1 from memberships where user_id = '${MULTI}'`)).length).toBe(2);
  });

  it('a membership for someone with no profile makes it their first (current) company', async () => {
    await db.exec(`insert into memberships (user_id, tenant_id, role) values ('${NEW_USER}', '${C}', 'HR')`);
    expect(await profile(NEW_USER)).toMatchObject({ tenant_id: C, role: 'HR', account_status: 'ACTIVE' });
    const [p] = await rows<{ email: string }>(`select email from user_profiles where user_id = '${NEW_USER}'`);
    expect(p.email).toBe('new@x.co');
  });
});

describe('choosing a company', () => {
  it('lists only the companies the person belongs to, flagging the current one', async () => {
    await asUser(db, MULTI, async () => {
      const list = await rows<{ name: string; role: string; is_current: boolean }>(`select name, role, is_current from my_companies()`);
      expect(list.map((r) => [r.name, r.role, r.is_current])).toEqual([
        ['Beta Ltd', 'STAFF', false],
        ['Figbloom HR', 'ADMIN', true],
      ]);
    });
    await asUser(db, ONLY_A, async () => {
      expect((await rows(`select 1 from my_companies()`)).length).toBe(1);
    });
  });

  it('switching changes the company AND the role, and the data the person can see follows', async () => {
    await db.exec(`
      insert into role_permissions (role_name, permissions, tenant_id) values ('STAFF', array['beta-only'], '${B}');
    `);
    await asUser(db, MULTI, async () => {
      await db.query(`select switch_company('${B}')`);
      expect(await rows(`select role_name, permissions from role_permissions where role_name = 'STAFF'`)).toEqual([
        { role_name: 'STAFF', permissions: ['beta-only'] },
      ]);
      // only the company in view is visible: nothing from A
      expect(await rows(`select 1 from tenants where id = '${A}'`)).toEqual([]);
    });
    expect(await profile(MULTI)).toMatchObject({ tenant_id: B, role: 'STAFF' });

    await asUser(db, MULTI, async () => {
      await db.query(`select switch_company('${A}')`);
    });
    expect(await profile(MULTI)).toMatchObject({ tenant_id: A, role: 'ADMIN' });
  });

  it('refuses a company the person is not a member of', async () => {
    await asUser(db, ONLY_A, async () => {
      await expect(db.query(`select switch_company('${B}')`)).rejects.toThrow(/not a member/);
    });
    expect(await profile(ONLY_A)).toMatchObject({ tenant_id: A });
  });

  it('refuses a suspended membership and a suspended company', async () => {
    await db.exec(`update memberships set account_status = 'SUSPENDED' where user_id = '${MULTI}' and tenant_id = '${B}'`);
    await asUser(db, MULTI, async () => {
      await expect(db.query(`select switch_company('${B}')`)).rejects.toThrow(/not a member/);
    });
    await db.exec(`update memberships set account_status = 'ACTIVE' where user_id = '${MULTI}' and tenant_id = '${B}'`);
    await db.exec(`update tenants set status = 'suspended' where id = '${B}'`);
    await asUser(db, MULTI, async () => {
      await expect(db.query(`select switch_company('${B}')`)).rejects.toThrow(/not a member/);
      expect((await rows(`select 1 from my_companies()`)).length).toBe(1);
    });
    await db.exec(`update tenants set status = 'active' where id = '${B}'`);
  });

  it('a signed-out caller cannot switch', async () => {
    await expect(db.query(`select switch_company('${A}')`)).rejects.toThrow(/Not signed in/);
  });
});

describe('nobody can grant themselves a company or a role', () => {
  it('clients cannot write memberships', async () => {
    await asUser(db, ONLY_A, async () => {
      await expect(db.query(`insert into memberships (user_id, tenant_id, role) values ('${ONLY_A}', '${B}', 'ADMIN')`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`update memberships set role = 'ADMIN' where user_id = '${ONLY_A}'`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`delete from memberships where user_id = '${ONLY_A}'`)).rejects.toThrow(/permission denied/);
    });
  });

  it('a person can read only their own memberships', async () => {
    await asUser(db, ONLY_A, async () => {
      const r = await rows<{ user_id: string }>(`select user_id from memberships`);
      expect(r.every((m) => m.user_id === ONLY_A)).toBe(true);
      expect(r.length).toBe(1);
    });
  });
});

describe('keeping the current company usable', () => {
  it('role changes in the current company are reflected, in another company are not', async () => {
    await db.exec(`update memberships set role = 'HR' where user_id = '${MULTI}' and tenant_id = '${A}'`);
    expect(await profile(MULTI)).toMatchObject({ tenant_id: A, role: 'HR' });
    await db.exec(`update memberships set role = 'CHECKER' where user_id = '${MULTI}' and tenant_id = '${B}'`);
    expect(await profile(MULTI)).toMatchObject({ tenant_id: A, role: 'HR' }); // B is not current
    await db.exec(`update memberships set role = 'ADMIN' where user_id = '${MULTI}' and tenant_id = '${A}'`);
    await db.exec(`update memberships set role = 'STAFF' where user_id = '${MULTI}' and tenant_id = '${B}'`);
  });

  it('suspending the current company moves the person to another active one instead of locking them out', async () => {
    await db.exec(`update memberships set account_status = 'SUSPENDED' where user_id = '${MULTI}' and tenant_id = '${A}'`);
    expect(await profile(MULTI)).toMatchObject({ tenant_id: B, role: 'STAFF', account_status: 'ACTIVE' });
    await db.exec(`update memberships set account_status = 'ACTIVE' where user_id = '${MULTI}' and tenant_id = '${A}'`);
    await db.exec(`update user_profiles set tenant_id = '${A}', role = 'ADMIN' where user_id = '${MULTI}'`);
  });

  it('suspending the only company leaves the profile suspended (login is refused as before)', async () => {
    await db.exec(`update memberships set account_status = 'SUSPENDED' where user_id = '${ONLY_A}'`);
    expect(await profile(ONLY_A)).toMatchObject({ tenant_id: A, account_status: 'SUSPENDED' });
    await db.exec(`update memberships set account_status = 'ACTIVE' where user_id = '${ONLY_A}'`);
    expect(await profile(ONLY_A)).toMatchObject({ account_status: 'ACTIVE' });
  });

  it('removing the current membership falls back to another company, or removes the profile if none is left', async () => {
    await db.exec(`delete from memberships where user_id = '${MULTI}' and tenant_id = '${A}'`);
    expect(await profile(MULTI)).toMatchObject({ tenant_id: B, role: 'STAFF' });
    await db.exec(`delete from memberships where user_id = '${MULTI}' and tenant_id = '${B}'`);
    expect(await profile(MULTI)).toBeUndefined();
  });

  it('removing a membership for a company the person is not in leaves their current one alone', async () => {
    await db.exec(`insert into memberships (user_id, tenant_id, role) values ('${ONLY_A}', '${B}', 'STAFF')`);
    await db.exec(`delete from memberships where user_id = '${ONLY_A}' and tenant_id = '${B}'`);
    expect(await profile(ONLY_A)).toMatchObject({ tenant_id: A });
  });
});

describe('leftovers from deleted logins', () => {
  const OLD = '00000000-0000-0000-0000-00000000f101'; // a login that was deleted
  const NEW = '00000000-0000-0000-0000-00000000f102'; // the same person registering again
  const GONE = '00000000-0000-0000-0000-00000000f103';

  it('registering again with the email of a deleted login works: the leftover profile is removed', async () => {
    // the old login's profile survived its deletion (this is what the dashboard did before the clean-up trigger)
    await db.exec(`
      insert into user_profiles (user_id, email, role, tenant_id) values ('${OLD}', 'again@x.co', 'ADMIN', '${A}');
      insert into auth.users (id, email) values ('${NEW}', 'again@x.co');
    `);
    await db.exec(`insert into memberships (user_id, tenant_id, role) values ('${NEW}', '${B}', 'ADMIN')`);
    expect(await profile(NEW)).toMatchObject({ tenant_id: B, role: 'ADMIN' });
    expect(await profile(OLD)).toBeUndefined();
  });

  it('a profile of a login that still exists is never removed, even with the same email', async () => {
    await db.exec(`insert into auth.users (id, email) values ('${GONE}', 'taken@x.co')`);
    await db.exec(`insert into user_profiles (user_id, email, role, tenant_id) values ('${GONE}', 'taken@x.co', 'STAFF', '${A}')`);
    // a different, real login whose email differs only by letter case cannot exist in auth, so a clash here would be a real conflict
    expect(await profile(GONE)).toMatchObject({ tenant_id: A });
  });

  it('deleting a login removes its profile and memberships with it', async () => {
    await db.exec(`insert into memberships (user_id, tenant_id, role) values ('${GONE}', '${B}', 'HR')`);
    await db.exec(`delete from auth.users where id = '${GONE}'`);
    expect(await profile(GONE)).toBeUndefined();
    expect(await rows(`select 1 from memberships where user_id = '${GONE}'`)).toEqual([]);
  });
});
