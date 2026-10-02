// Shared by the tenant isolation test files: same assertions, different starting schema.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser } from './db';

export function defineIsolationSuite(name: string, boot: () => Promise<PGlite>) {
describe(name, () => {
const A = '00000000-0000-0000-0000-000000000001'; // the default tenant created by the migration
const B = '00000000-0000-0000-0000-0000000000b2';
const USER_A = '00000000-0000-0000-0000-00000000a001';
const USER_B = '00000000-0000-0000-0000-00000000b001';

// Keep in sync with the "exempt" arrays in the migrations.
const NOT_TENANT_OWNED = ['tenants', 'permissions', 'user_profiles', 'Employee_Records_Duplicate', 'kenya_branches_duplicate'];

let db: PGlite;

const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;

const tenantTables = async () =>
  (
    await rows<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' order by 1`
    )
  )
    .map((r) => r.relname)
    .filter((t) => !NOT_TENANT_OWNED.includes(t));

beforeAll(async () => {
  db = await boot();

  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');

    insert into auth.users (id, email, raw_user_meta_data) values
      ('${USER_A}', 'a@a.co', '{"role":"STAFF"}'),
      ('${USER_B}', 'b@b.co', '{"role":"STAFF"}');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${USER_A}', 'a@a.co', 'STAFF', '${A}'),
      ('${USER_B}', 'b@b.co', 'STAFF', '${B}');

    insert into employees ("Employee Number", "First Name", "Work Email", tenant_id) values
      ('EMP-A1', 'Alice', 'a@a.co', '${A}'),
      ('EMP-B1', 'Bob',   'b@b.co',   '${B}');

    insert into leave_types (name, is_deductible, tenant_id) values
      ('Annual Leave', true, '${B}');
    insert into leave_policies (leave_type_id, days_allotted, accrual_method, carry_forward_max_days, tenant_id)
      select id, 20, 'annual', 5, '${B}' from leave_types where tenant_id = '${B}' and name = 'Annual Leave';
    insert into role_permissions (role_name, permissions, tenant_id) values ('STAFF', array['dashboard'], '${B}');
  `);
}, 120000);

describe('classification (every table is accounted for)', () => {
  it('every tenant-owned table has NOT NULL tenant_id, RLS and a restrictive tenant_isolation policy', async () => {
    const problems: string[] = [];
    for (const t of await tenantTables()) {
      const [col] = await rows<{ is_nullable: string }>(
        `select is_nullable from information_schema.columns where table_schema='public' and table_name='${t}' and column_name='tenant_id'`
      );
      if (!col) problems.push(`${t}: no tenant_id`);
      else if (col.is_nullable !== 'NO') problems.push(`${t}: tenant_id is nullable`);

      const [cls] = await rows<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where oid = 'public."${t}"'::regclass`);
      if (!cls.relrowsecurity) problems.push(`${t}: RLS disabled`);

      const pol = await rows(
        `select 1 from pg_policies where schemaname='public' and tablename='${t}' and policyname='tenant_isolation' and permissive='RESTRICTIVE'`
      );
      if (pol.length !== 1) problems.push(`${t}: missing restrictive tenant_isolation policy`);
    }
    expect(problems).toEqual([]);
  });

  it('non-tenant tables have RLS enabled', async () => {
    const present = await rows<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname='public' and c.relkind='r' and c.relname = any(array[${NOT_TENANT_OWNED.map((t) => `'${t}'`).join(',')}])`
    );
    expect(present.length).toBeGreaterThan(0);
    for (const t of present) expect([t.relname, t.relrowsecurity]).toEqual([t.relname, true]);
  });

  it('every view runs as the caller (security_invoker), so it cannot bypass RLS', async () => {
    const views = await rows<{ relname: string; reloptions: string[] | null }>(
      `select c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname='public' and c.relkind='v'`
    );
    expect(views.length).toBeGreaterThan(0);
    // employee_directory is the one deliberate exception: it runs with the owner's rights to expose
    // non-sensitive columns of every colleague, and filters by tenant itself (tested in employees_access.test.ts)
    for (const v of views.filter((v) => v.relname !== 'employee_directory')) expect([v.relname, v.reloptions]).toEqual([v.relname, expect.arrayContaining(['security_invoker=true'])]);
  });
});

describe('cross-tenant access is blocked on every tenant table', () => {
  it('a user in one tenant sees none of the other tenant’s rows, and cannot update or delete them', async () => {
    const tables = await tenantTables();
    expect(tables.length).toBeGreaterThan(10);
    const leaks: string[] = [];

    for (const [user, other] of [
      [USER_A, B],
      [USER_B, A],
    ] as const) {
      await asUser(db, user, async () => {
        for (const t of tables) {
          const seen = await rows<{ n: number }>(`select count(*)::int n from public."${t}" where tenant_id = '${other}'`);
          if (seen[0].n !== 0) leaks.push(`${user} reads ${t}`);
          const upd = await rows(`update public."${t}" set tenant_id = tenant_id where tenant_id = '${other}' returning 1`);
          if (upd.length) leaks.push(`${user} updates ${t}`);
          const del = await rows(`delete from public."${t}" where tenant_id = '${other}' returning 1`);
          if (del.length) leaks.push(`${user} deletes ${t}`);
        }
      });
    }
    expect(leaks).toEqual([]);
  });

  it('anon sees nothing (or is refused) on every tenant table', async () => {
    const leaks: string[] = [];
    await asAnon(db, async () => {
      for (const t of await tenantTables()) {
        try {
          const n = (await rows<{ n: number }>(`select count(*)::int n from public."${t}"`))[0].n;
          if (n !== 0) leaks.push(`anon reads ${n} rows of ${t}`);
        } catch {
          /* refused is fine */
        }
      }
    });
    expect(leaks).toEqual([]);
  });

  it('a user only sees their own tenant’s employees and cannot insert into another tenant', async () => {
    await asUser(db, USER_A, async () => {
      expect((await rows<{ n: string }>(`select "Employee Number" n from employees`)).map((r) => r.n)).toEqual(['EMP-A1']);
      await expect(
        db.query(`insert into kenya_branches ("Town", tenant_id) values ('Mallory-ville', '${B}')`)
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('new rows are stamped with the caller’s tenant automatically', async () => {
    await asUser(db, USER_A, async () => {
      await db.query(`insert into kenya_branches ("Town") values ('Annaville')`);
      const [row] = await rows<{ tenant_id: string }>(`select tenant_id from kenya_branches where "Town" = 'Annaville'`);
      expect(row.tenant_id).toBe(A);
    });
  });

  it('a stray permissive USING (true) policy cannot open a table across tenants', async () => {
    await db.exec(`create policy leaky on employees for all to authenticated using (true) with check (true)`);
    try {
      await asUser(db, USER_A, async () => {
        const seen = await rows(`select 1 from employees where tenant_id = '${B}'`);
        expect(seen).toEqual([]);
      });
    } finally {
      await db.exec(`drop policy leaky on employees`);
    }
  });
});

describe('tenants and user_profiles', () => {
  it('a user can read only their own tenant', async () => {
    await asUser(db, USER_A, async () => {
      expect((await rows<{ id: string }>(`select id from tenants`)).map((r) => r.id)).toEqual([A]);
    });
  });

  it('profiles are readable within the tenant only', async () => {
    await asUser(db, USER_A, async () => {
      expect((await rows<{ user_id: string }>(`select user_id from user_profiles`)).map((r) => r.user_id)).toEqual([USER_A]);
    });
  });

  it('clients cannot write user_profiles (so nobody can move themselves into another tenant)', async () => {
    await asUser(db, USER_A, async () => {
      await expect(db.query(`update user_profiles set tenant_id = '${B}' where user_id = '${USER_A}'`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`update user_profiles set role = 'ADMIN' where user_id = '${USER_A}'`)).rejects.toThrow(/permission denied/);
    });
  });

  it('clients cannot create or edit tenants or the global permissions catalogue', async () => {
    await asUser(db, USER_A, async () => {
      await expect(db.query(`update tenants set name = 'pwned'`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`insert into tenants (name, slug) values ('x', 'xxx-xxx')`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`delete from permissions`)).rejects.toThrow(/permission denied/);
    });
  });

  it('the users view only lists the caller’s tenant', async () => {
    await asUser(db, USER_A, async () => {
      expect((await rows<{ email: string }>(`select email from users`)).map((r) => r.email)).toEqual(['a@a.co']);
    });
  });
});

describe('suspension kill switch', () => {
  it('suspending a tenant locks all of its users out immediately', async () => {
    await db.exec(`update tenants set status = 'suspended' where id = '${B}'`);
    try {
      await asUser(db, USER_B, async () => {
        expect(await rows(`select 1 from employees`)).toEqual([]);
        expect(await rows(`select 1 from tenants`)).toEqual([]);
        await expect(db.query(`insert into kenya_branches ("Town") values ('Zedville')`)).rejects.toThrow();
      });
    } finally {
      await db.exec(`update tenants set status = 'active' where id = '${B}'`);
    }
    await asUser(db, USER_B, async () => {
      expect((await rows(`select 1 from employees`)).length).toBeGreaterThan(0);
    });
  });
});

describe('permission helpers', () => {
  it('has_permission only answers for the caller’s own tenant', async () => {
    await db.exec(`insert into role_permissions (role_name, permissions, tenant_id) values ('STAFF', array['dashboard'], '${A}') on conflict do nothing`);
    await asUser(db, USER_A, async () => {
      expect((await rows<{ v: boolean }>(`select has_permission('${USER_A}', 'dashboard') v`))[0].v).toBe(true);
      expect((await rows<{ v: boolean }>(`select has_permission('${USER_A}', 'payroll') v`))[0].v).toBe(false);
      expect((await rows<{ v: boolean }>(`select has_permission('${USER_B}', 'dashboard') v`))[0].v).toBe(false);
      expect((await rows<{ v: string[] }>(`select get_user_permissions('${USER_B}') v`))[0].v).toEqual([]);
    });
  });
});

describe('uniqueness is per tenant', () => {
  it('two tenants can use the same work email and the same role name', async () => {
    await db.exec(`insert into employees ("Employee Number", "First Name", "Work Email", tenant_id) values ('EMP-B2', 'Alicia', 'a@a.co', '${B}')`);
    await expect(
      db.query(`insert into employees ("Employee Number", "First Name", "Work Email", tenant_id) values ('EMP-A9', 'Dup', 'a@a.co', '${A}')`)
    ).rejects.toThrow(/unique/i);
    const roles = await rows(`select 1 from role_permissions where role_name = 'STAFF'`);
    expect(roles.length).toBe(2);
  });
});

describe('system-run leave resets stay inside each tenant', () => {
  it('the pg_cron path (no RLS, no default tenant) stamps every balance with its employee’s tenant', async () => {
    await db.exec(`
      insert into leave_types (name, is_deductible, tenant_id) values ('Annual Leave', true, '${A}');
      insert into leave_policies (leave_type_id, days_allotted, accrual_method, carry_forward_max_days, tenant_id)
        select id, 24, 'annual', 5, '${A}' from leave_types where tenant_id = '${A}' and name = 'Annual Leave';
    `);
    await db.exec(`select * from run_annual_leave_reset(2027)`);

    const wrong = await rows(
      `select b.employee_number, b.tenant_id, e.tenant_id as employee_tenant, t.tenant_id as type_tenant
       from leave_balances b
       join employees e on e."Employee Number" = b.employee_number
       join leave_types t on t.id = b.leave_type_id
       where b.year = 2027 and (b.tenant_id <> e.tenant_id or b.tenant_id <> t.tenant_id)`
    );
    expect(wrong).toEqual([]);

    const days = await rows<{ employee_number: string; accrued_days: string }>(
      `select b.employee_number, b.accrued_days from leave_balances b
       join leave_types t on t.id = b.leave_type_id
       where b.year = 2027 and b.month = 0 and t.name = 'Annual Leave' order by b.employee_number`
    );
    const byEmployee = Object.fromEntries(days.map((d) => [d.employee_number, Number(d.accrued_days)]));
    expect(byEmployee['EMP-A1']).toBe(24); // tenant A's policy
    expect(byEmployee['EMP-B1']).toBe(20); // tenant B's policy
  });
});

});
}
