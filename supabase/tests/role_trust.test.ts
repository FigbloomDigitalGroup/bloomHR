// @vitest-environment node
//
// A signed-in user must not be able to promote themselves by editing their own user_metadata:
// authorisation to change role_permissions comes from user_profiles.role, which only the backend writes.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const STAFF_A = '00000000-0000-0000-0000-00000000a001';
const ADMIN_A = '00000000-0000-0000-0000-00000000a002';
const ADMIN_B = '00000000-0000-0000-0000-00000000b001';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${STAFF_A}', 'staff@a.co'), ('${ADMIN_A}', 'admin@a.co'), ('${ADMIN_B}', 'admin@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${STAFF_A}', 'staff@a.co', 'STAFF', '${A}'),
      ('${ADMIN_A}', 'admin@a.co', 'ADMIN', '${A}'),
      ('${ADMIN_B}', 'admin@b.co', 'ADMIN', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('STAFF', array['dashboard'], '${A}'),
      ('STAFF', array['dashboard'], '${B}');
  `);
}, 120000);

const grant = `update role_permissions set permissions = array['dashboard','payroll','settings'] where role_name = 'STAFF' returning 1`;

describe('role_permissions writes are authorised by user_profiles.role', () => {
  it('a STAFF user cannot edit permissions, even with a forged ADMIN role in their metadata', async () => {
    await asUser(
      db,
      STAFF_A,
      async () => {
        expect(await rows(grant)).toEqual([]);
        await expect(
          db.query(`insert into role_permissions (role_name, permissions) values ('HR', array['payroll'])`)
        ).rejects.toThrow(/row-level security/);
        expect(await rows(`delete from role_permissions returning 1`)).toEqual([]);
      },
      { role: 'ADMIN' } // what a user can do to themselves with supabase.auth.updateUser
    );
    const [r] = await rows<{ permissions: string[] }>(`select permissions from role_permissions where role_name = 'STAFF' and tenant_id = '${A}'`);
    expect(r.permissions).toEqual(['dashboard']);
  });

  it('a real ADMIN can edit their own tenant’s permissions', async () => {
    await asUser(db, ADMIN_A, async () => {
      expect((await rows(grant)).length).toBe(1);
    });
    const [r] = await rows<{ permissions: string[] }>(`select permissions from role_permissions where role_name = 'STAFF' and tenant_id = '${A}'`);
    expect(r.permissions).toEqual(['dashboard', 'payroll', 'settings']);
  });

  it('…but never another tenant’s', async () => {
    await asUser(db, ADMIN_A, async () => {
      expect(await rows(`update role_permissions set permissions = '{}' where tenant_id = '${B}' returning 1`)).toEqual([]);
    });
    const [r] = await rows<{ permissions: string[] }>(`select permissions from role_permissions where tenant_id = '${B}'`);
    expect(r.permissions).toEqual(['dashboard']);
  });

  it('every signed-in user can still read their own tenant’s role permissions', async () => {
    await asUser(db, STAFF_A, async () => {
      expect((await rows(`select 1 from role_permissions`)).length).toBeGreaterThan(0);
    });
  });
});

describe('permission helpers use the trusted role', () => {
  it('has_permission ignores a role forged in user_metadata', async () => {
    await db.exec(`update auth.users set raw_user_meta_data = '{"role":"ADMIN"}' where id = '${STAFF_A}'`);
    await asUser(db, STAFF_A, async () => {
      const [r] = await rows<{ v: boolean }>(`select has_permission('${STAFF_A}', 'payroll') v`);
      // There is no 'ADMIN' row in role_permissions, so a lookup that believed the forged role would
      // return nothing. Getting STAFF's permissions back means the trusted profile role was used.
      expect(r.v).toBe(true);
      const perms = (await rows<{ v: string[] }>(`select get_user_permissions('${STAFF_A}') v`))[0].v;
      expect(perms).toEqual(['dashboard', 'payroll', 'settings']);
    });
  });
});
