// @vitest-environment node
//
// A staff member may add their own primary mobile number once, while the record has none; after that, changing it
// (or any other company-controlled field) still needs HR.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const NEW_STAFF = '00000000-0000-0000-0000-00000000d001'; // E-NEW, no mobile number yet
const OLD_STAFF = '00000000-0000-0000-0000-00000000d002'; // E-OLD, already has one
const BLANK_STAFF = '00000000-0000-0000-0000-00000000d003'; // E-BLANK, mobile is just spaces
const HR = '00000000-0000-0000-0000-00000000d004';

let db: PGlite;
const attempt = async (sql: string) => {
  try {
    await db.query(sql);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
};
const mobile = async (number: string) => (await db.query<{ m: string | null }>(`select "Mobile Number" m from employees where "Employee Number" = '${number}'`)).rows[0].m;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values
      ('${NEW_STAFF}', 'new@a.co'), ('${OLD_STAFF}', 'old@a.co'), ('${BLANK_STAFF}', 'blank@a.co'), ('${HR}', 'hr@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${NEW_STAFF}', 'new@a.co', 'STAFF', '${A}'), ('${OLD_STAFF}', 'old@a.co', 'STAFF', '${A}'),
      ('${BLANK_STAFF}', 'blank@a.co', 'STAFF', '${A}'), ('${HR}', 'hr@a.co', 'HR', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('STAFF', array['dashboard'], '${A}'), ('HR', array['employees'], '${A}');
    insert into employees ("Employee Number", "First Name", "Work Email", "Mobile Number", "Work Mobile", tenant_id) values
      ('E-NEW', 'New', 'new@a.co', null, null, '${A}'),
      ('E-OLD', 'Old', 'old@a.co', '0711000000', '0722000000', '${A}'),
      ('E-BLANK', 'Blank', 'blank@a.co', '   ', null, '${A}');
  `);
}, 120000);

describe('staff and the primary mobile number', () => {
  it('can add it when the record has none', async () => {
    await asUser(db, NEW_STAFF, async () => {
      expect((await attempt(`update employees set "Mobile Number" = '0712345678' where "Employee Number" = 'E-NEW'`)).ok).toBe(true);
    });
    expect(await mobile('E-NEW')).toBe('0712345678');
  });

  it('counts a number that is only spaces as empty', async () => {
    await asUser(db, BLANK_STAFF, async () => {
      expect((await attempt(`update employees set "Mobile Number" = '0733000000' where "Employee Number" = 'E-BLANK'`)).ok).toBe(true);
    });
  });

  it('cannot change it once it is set: that needs HR', async () => {
    await asUser(db, NEW_STAFF, async () => {
      const r = await attempt(`update employees set "Mobile Number" = '0799999999' where "Employee Number" = 'E-NEW'`);
      expect(r.ok).toBe(false);
      expect((r as { error: string }).error).toMatch(/Mobile Number/);
    });
    expect(await mobile('E-NEW')).toBe('0712345678');
    await asUser(db, OLD_STAFF, async () => {
      expect((await attempt(`update employees set "Mobile Number" = '0799999999' where "Employee Number" = 'E-OLD'`)).ok).toBe(false);
    });
    expect(await mobile('E-OLD')).toBe('0711000000');
  });

  it('cannot use the same exception for the other company-controlled fields', async () => {
    await asUser(db, NEW_STAFF, async () => {
      for (const set of [`"Work Mobile" = '0700000000'`, `"Work Email" = 'x@evil.co'`, `"Basic Salary" = 999999`, `"Job Title" = 'CEO'`]) {
        expect((await attempt(`update employees set ${set} where "Employee Number" = 'E-NEW'`)).ok, set).toBe(false);
      }
    });
  });

  it('cannot add a number to a colleague’s record', async () => {
    await asUser(db, NEW_STAFF, async () => {
      const r = await db.query(`update employees set "Mobile Number" = '0700111222' where "Employee Number" = 'E-BLANK' returning 1`);
      expect(r.rows).toEqual([]); // not their row: nothing changes
    });
  });

  it('HR can change it at any time', async () => {
    await asUser(db, HR, async () => {
      expect((await attempt(`update employees set "Mobile Number" = '0766000000' where "Employee Number" = 'E-OLD'`)).ok).toBe(true);
    });
    expect(await mobile('E-OLD')).toBe('0766000000');
  });
});
