// @vitest-environment node
//
// Anonymous (not signed-in) users must not be able to read or write tenant data, and no policy on
// a tenant table should be granted to PUBLIC/anon by accident. Runs on the real (ziradev) schema.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, bootLiveDb } from './db';

let db: PGlite;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into hr_notifications (employee_number, employee_name, notification_type, title, message, tenant_id)
    values ('EMP-1', 'Alice', 'leave_approved', 'Leave approved', 'Your leave was approved', '00000000-0000-0000-0000-000000000001');
  `);
}, 120000);

describe('anonymous access', () => {
  it('cannot read hr_notifications', async () => {
    await asAnon(db, async () => {
      expect((await db.query('select * from hr_notifications')).rows).toEqual([]);
    });
  });

  it('cannot write hr_notifications', async () => {
    await asAnon(db, async () => {
      await expect(
        db.query(`insert into hr_notifications (employee_number, employee_name, notification_type, title, message) values ('X', 'Mallory', 'leave_approved', 't', 'hi')`)
      ).rejects.toThrow();
      expect((await db.query(`update hr_notifications set message = 'pwned' returning 1`)).rows).toEqual([]);
      expect((await db.query(`delete from hr_notifications returning 1`)).rows).toEqual([]);
    });
  });

  it('no policy on a tenant table is granted to PUBLIC or anon, apart from the known role_permissions ones', async () => {
    const granted = (
      await db.query<{ tablename: string; policyname: string }>(
        `select tablename, policyname from pg_policies
         where schemaname = 'public' and permissive = 'PERMISSIVE'
           and (roles && array['public', 'anon']::name[])
         order by 1, 2`
      )
    ).rows.map((p) => `${p.tablename}: ${p.policyname}`);

    // Allowed for now: role_permissions "view" is harmless (the tenant policy still blocks anon) and
    // its admin policy is tracked separately (it trusts user_metadata.role, see the RFC, risk 4).
    expect(granted).toEqual([
      'role_permissions: Anyone can view role permissions',
      'role_permissions: Only admins can modify role permissions',
    ]);
  });
});
