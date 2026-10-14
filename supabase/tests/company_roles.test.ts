// @vitest-environment node
//
// Companies make their own roles (FIG-827, 20261015300000): a role grants exactly its modules; ADMIN and STAFF are
// built in; nobody hands out access they lack; a role in use is only deleted by moving its people; one company's
// roles are invisible and unusable in another; the seven fixed roles keep working as before.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootDb } from './db';

const A = '00000000-0000-0000-0000-000000000001'; // the default company, with the seeded roles
const B = '00000000-0000-0000-0000-0000000000b2';
const ADMIN = '00000000-0000-0000-0000-00000000c701';
const HR = '00000000-0000-0000-0000-00000000c702';
const STAFF = '00000000-0000-0000-0000-00000000c703';
const LEAD = '00000000-0000-0000-0000-00000000c704'; // a role with 'role-permissions' and a few modules, not ADMIN
const FIELD = '00000000-0000-0000-0000-00000000c705'; // given the custom role
const ADMIN_B = '00000000-0000-0000-0000-00000000c706';
const MOVED = '00000000-0000-0000-0000-00000000c707';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) => asUser(db, user, () => rows<T>(sql, params));
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const role = async (tenant: string, key: string) =>
  (await rows<{ display_name: string; permissions: string[]; is_system: boolean }>(
    `select display_name, permissions, is_system from role_permissions where tenant_id = $1 and role_name = $2`, [tenant, key]))[0];
const has = (user: string, module: string) => as<{ v: boolean }>(user, `select has_module($1) v`, [module]).then((r) => r[0].v);
const create = (user: string, name: string, modules: string[]) =>
  as<{ k: string }>(user, `select create_company_role($1, null, $2::text[]) k`, [name, modules]).then((r) => r[0].k);
const invite = (user: string, email: string, key: string) => as(user, `select * from create_invitation($1, $2)`, [email, key]);

beforeAll(async () => {
  db = await bootDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into role_permissions (tenant_id, role_name, permissions)
      select '${B}', role_name, permissions from role_permissions where tenant_id = '${A}';
    insert into role_permissions (tenant_id, role_name, permissions) values
      ('${A}', 'LEAD', array['role-permissions', 'invite-people', 'dashboard', 'task-manager', 'teams', 'leaves']);
    insert into auth.users (id, email) values
      ('${ADMIN}', 'admin@a.co'), ('${HR}', 'hr@a.co'), ('${STAFF}', 'staff@a.co'), ('${LEAD}', 'lead@a.co'),
      ('${FIELD}', 'field@a.co'), ('${ADMIN_B}', 'admin@b.co'), ('${MOVED}', 'moved@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${ADMIN}', 'admin@a.co', 'ADMIN', '${A}'), ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${STAFF}', 'staff@a.co', 'STAFF', '${A}'),
      ('${LEAD}', 'lead@a.co', 'LEAD', '${A}'), ('${ADMIN_B}', 'admin@b.co', 'ADMIN', '${B}');
  `);
}, 120000);

describe('the seven fixed roles become each company’s own, unchanged', () => {
  it('keep their keys and modules, gain names, and only ADMIN and STAFF are built in', async () => {
    expect(await role(A, 'HR')).toMatchObject({ display_name: 'Human Resources', is_system: false });
    expect(await role(A, 'ADMIN')).toMatchObject({ display_name: 'Administrator', is_system: true });
    expect(await role(A, 'STAFF')).toMatchObject({ display_name: 'Staff', is_system: true, permissions: ['dashboard', 'task-manager', 'teams'] });
  });

  it('who invited or created channels by role name keeps it as a module', async () => {
    expect(await has(HR, 'invite-people')).toBe(true);
    expect(await has(HR, 'create-channels')).toBe(true);
    expect(await has(STAFF, 'invite-people')).toBe(false);
    expect(await has(STAFF, 'create-channels')).toBe(false);
    expect((await role(A, 'MANAGER')).permissions).toContain('create-channels');
    expect((await role(A, 'CHECKER')).permissions).not.toContain('create-channels');
    // HR still invites staff, and only staff of the seeded roles
    expect(await as<{ role_name: string }>(HR, `select role_name from assignable_roles()`)).toEqual([{ role_name: 'STAFF' }]);
    expect((await as<{ role_name: string }>(ADMIN, `select role_name from assignable_roles()`)).map((r) => r.role_name)).toContain('ADMIN');
  });
});

describe('a custom role', () => {
  it('is created with a key made from its name, and grants exactly its modules', async () => {
    expect(await create(ADMIN, 'Field Officer', ['dashboard', 'leaves'])).toBe('FIELD_OFFICER');
    expect(await role(A, 'FIELD_OFFICER')).toMatchObject({ display_name: 'Field Officer', is_system: false, permissions: ['dashboard', 'leaves'] });
    expect(await create(ADMIN, 'Field Officer (night)', [])).toBe('FIELD_OFFICER_NIGHT');
    expect(await create(ADMIN, 'Admin', [])).toBe('ADMIN_2'); // never a built-in key
    expect(await fails(create(ADMIN, 'field officer', []))).toMatch(/already a role called/);
    expect(await fails(create(ADMIN, 'Spy', ['no-such-module']))).toMatch(/Unknown module/);

    await db.exec(`insert into user_profiles (user_id, email, role, tenant_id) values ('${FIELD}', 'field@a.co', 'FIELD_OFFICER', '${A}')`);
    expect(await has(FIELD, 'leaves')).toBe(true);
    expect(await has(FIELD, 'dashboard')).toBe(true);
    expect(await has(FIELD, 'payroll')).toBe(false);
    expect(await has(FIELD, 'employees')).toBe(false);
    expect(await fails(as(FIELD, `insert into payroll_runs (pay_period, status) values ('2026-10', 'draft')`))).toMatch(/row-level security/);
  });

  it('is renamed without changing its key, so the people in it keep their access', async () => {
    expect((await as(ADMIN, `update role_permissions set display_name = 'Field Agent', description = 'Out in the field' where role_name = 'FIELD_OFFICER' returning 1`)).length).toBe(1);
    expect(await role(A, 'FIELD_OFFICER')).toMatchObject({ display_name: 'Field Agent' });
    expect(await has(FIELD, 'leaves')).toBe(true);
    expect(await fails(as(ADMIN, `update role_permissions set role_name = 'AGENT' where role_name = 'FIELD_OFFICER'`))).toMatch(/key and company cannot change/);
  });

  it('can only be managed by ADMIN or the role-permissions module', async () => {
    expect(await fails(create(HR, 'Sneaky', []))).toMatch(/row-level security/);
    expect(await as(HR, `update role_permissions set permissions = array['payroll'] where role_name = 'STAFF' returning 1`)).toEqual([]);
    expect(await as(HR, `delete from role_permissions where role_name = 'FIELD_OFFICER_NIGHT' returning 1`)).toEqual([]);
    expect(await fails(as(HR, `select delete_company_role('FIELD_OFFICER_NIGHT')`))).toMatch(/cannot manage roles/);
  });
});

describe('nobody hands out access they lack', () => {
  it('a role manager who is not ADMIN gives roles only modules they have themselves', async () => {
    expect(await fails(create(LEAD, 'Payroll Clerk', ['payroll']))).toMatch(/modules you have yourself/);
    expect(await create(LEAD, 'Leave Clerk', ['leaves', 'dashboard'])).toBe('LEAVE_CLERK');
    expect(await fails(as(LEAD, `update role_permissions set permissions = permissions || array['payroll'] where role_name = 'LEAVE_CLERK'`)))
      .toMatch(/modules you have yourself/);
    // nor even to their own role, or to STAFF
    expect(await fails(as(LEAD, `update role_permissions set permissions = permissions || array['payroll'] where role_name = 'LEAD'`)))
      .toMatch(/modules you have yourself/);
    expect(await fails(as(LEAD, `update role_permissions set permissions = permissions || array['payroll'] where role_name = 'STAFF'`)))
      .toMatch(/modules you have yourself/);
    // and does not touch roles with more access than theirs
    expect(await fails(as(LEAD, `update role_permissions set display_name = 'People' where role_name = 'HR'`))).toMatch(/whose modules you have yourself/);
    expect(await fails(as(LEAD, `select delete_company_role('FIELD_OFFICER_NIGHT')`))).toBe('');
    expect((await role(A, 'HR')).permissions).not.toContain('role-permissions');
  });

  it('only ADMIN gives the ADMIN role, and nobody edits it', async () => {
    expect(await fails(as(LEAD, `insert into role_permissions (role_name, permissions) values ('ADMIN', '{}')`))).toMatch(/Administrator role/);
    expect(await fails(as(ADMIN, `update role_permissions set permissions = '{}' where role_name = 'ADMIN'`))).toMatch(/Administrator role/);
    expect(await fails(as(ADMIN, `update role_permissions set display_name = 'Boss' where role_name = 'ADMIN'`))).toMatch(/Administrator role/);
    expect(await fails(invite(HR, 'boss@gmail.com', 'ADMIN'))).toMatch(/Only an administrator can invite this role/);
    expect(await fails(invite(LEAD, 'boss@gmail.com', 'ADMIN'))).toMatch(/Only an administrator can invite this role/);
    expect((await as<{ v: boolean }>(LEAD, `select exists (select 1 from assignable_roles() where role_name = 'ADMIN') v`))[0].v).toBe(false);
    expect((await invite(ADMIN, 'boss@gmail.com', 'ADMIN')).length).toBe(1);
  });

  it('people are invited only to roles within the inviter’s own access', async () => {
    expect(await fails(invite(LEAD, 'clerk@gmail.com', 'HR'))).toMatch(/access you do not have/);
    expect((await invite(LEAD, 'clerk@gmail.com', 'LEAVE_CLERK')).length).toBe(1);
    expect((await invite(HR, 'clerk2@gmail.com', 'STAFF')).length).toBe(1);
    expect((await invite(HR, 'clerk3@gmail.com', 'LEAVE_CLERK')).length).toBe(1); // HR has leaves and dashboard
    expect(await fails(invite(HR, 'clerk4@gmail.com', 'CHECKER'))).toMatch(/access you do not have/); // payroll, which HR lacks
  });

  it('STAFF, the baseline everyone joins with, can always be given by someone who invites people', async () => {
    await db.exec(`update role_permissions set permissions = permissions || array['payroll'] where tenant_id = '${A}' and role_name = 'STAFF'`);
    try {
      expect((await invite(HR, 'still.staff@gmail.com', 'STAFF')).length).toBe(1); // HR lacks payroll, as before
    } finally {
      await db.exec(`update role_permissions set permissions = array_remove(permissions, 'payroll') where tenant_id = '${A}' and role_name = 'STAFF'`);
    }
    expect(await fails(invite(STAFF, 'x@gmail.com', 'STAFF'))).toMatch(/Only an administrator or HR/);
  });

  it('the backend asks can_assign_role, which only the server may call', async () => {
    const can = async (who: string, key: string) =>
      (await rows<{ v: boolean }>(`select can_assign_role($1, $2, $3) v`, [who, A, key]))[0].v;
    expect(await can(ADMIN, 'ADMIN')).toBe(true);
    expect(await can(HR, 'STAFF')).toBe(true);
    expect(await can(HR, 'CHECKER')).toBe(false);
    expect(await can(STAFF, 'STAFF')).toBe(false); // no invite-people
    expect(await can(ADMIN, 'NO_SUCH_ROLE')).toBe(false);
    expect(await fails(as(HR, `select can_assign_role('${HR}', '${A}', 'ADMIN')`))).toMatch(/permission denied/);
  });

  it('a person cannot change their own role', async () => {
    // refused outright or matching no row, depending on the table: either way nothing changes
    await fails(as(HR, `update user_profiles set role = 'ADMIN' where user_id = '${HR}'`));
    await fails(as(HR, `update memberships set role = 'ADMIN' where user_id = '${HR}'`));
    expect(await rows(`select role from user_profiles where user_id = '${HR}'`)).toEqual([{ role: 'HR' }]);
    expect(await rows(`select role from memberships where user_id = '${HR}'`)).toEqual([{ role: 'HR' }]);
    expect(await fails(as(LEAD, `select delete_company_role('LEAD', 'STAFF')`))).toMatch(/your own role/);
  });
});

describe('the built-in roles', () => {
  it('STAFF can be renamed and its modules changed, but not deleted; ADMIN cannot be deleted', async () => {
    expect((await as(ADMIN, `update role_permissions set display_name = 'Team member' where role_name = 'STAFF' returning 1`)).length).toBe(1);
    expect(await fails(as(ADMIN, `delete from role_permissions where role_name = 'STAFF'`))).toMatch(/built in/);
    expect(await fails(as(ADMIN, `delete from role_permissions where role_name = 'ADMIN'`))).toMatch(/built in/);
    expect(await fails(as(ADMIN, `select delete_company_role('STAFF', 'HR')`))).toMatch(/built in/);
    expect(await fails(as(ADMIN, `update role_permissions set is_system = false where role_name = 'STAFF'`))).toMatch(/is_system/);
    expect(await role(A, 'STAFF')).toMatchObject({ is_system: true, display_name: 'Team member' });
  });
});

describe('deleting a role', () => {
  it('in use is refused, unless its people are moved to another role', async () => {
    await db.exec(`insert into user_profiles (user_id, email, role, tenant_id) values ('${MOVED}', 'moved@a.co', 'FIELD_OFFICER', '${A}')`);
    expect(await fails(as(ADMIN, `delete from role_permissions where role_name = 'FIELD_OFFICER'`))).toMatch(/still in use/);
    expect(await fails(as(ADMIN, `select delete_company_role('FIELD_OFFICER')`))).toMatch(/still in use/);
    expect(await fails(as(ADMIN, `select delete_company_role('FIELD_OFFICER', 'FIELD_OFFICER')`))).toMatch(/another role/);
    expect(await fails(as(ADMIN, `select delete_company_role('FIELD_OFFICER', 'NOPE')`))).toMatch(/another role/);
    // a non-admin cannot move people up into a role with more access than theirs
    expect(await fails(as(LEAD, `select delete_company_role('FIELD_OFFICER', 'HR')`))).toMatch(/less access than your own/);

    const pending = await invite(ADMIN, 'joining@gmail.com', 'FIELD_OFFICER');
    expect(pending.length).toBe(1);
    expect((await as<{ n: number }>(LEAD, `select delete_company_role('FIELD_OFFICER', 'LEAVE_CLERK') n`))[0].n).toBe(2);
    expect(await role(A, 'FIELD_OFFICER')).toBeUndefined();
    expect(await rows(`select role from memberships where user_id in ('${FIELD}', '${MOVED}') order by role`)).toEqual([{ role: 'LEAVE_CLERK' }, { role: 'LEAVE_CLERK' }]);
    expect(await rows(`select role from user_profiles where user_id in ('${FIELD}', '${MOVED}')`)).toEqual([{ role: 'LEAVE_CLERK' }, { role: 'LEAVE_CLERK' }]);
    expect(await rows(`select role from invitations where email = 'joining@gmail.com' and status = 'pending'`)).toEqual([{ role: 'LEAVE_CLERK' }]);
    expect(await has(FIELD, 'leaves')).toBe(true);
  });

  it('not in use goes straight away', async () => {
    expect((await as(ADMIN, `select delete_company_role('ADMIN_2')`)).length).toBe(1);
    expect(await role(A, 'ADMIN_2')).toBeUndefined();
  });
});

describe('one company’s roles stay in it', () => {
  it('are invisible and unusable in another company', async () => {
    expect(await as(ADMIN_B, `select 1 from role_permissions where role_name = 'LEAVE_CLERK'`)).toEqual([]);
    expect(await as(ADMIN_B, `select 1 from role_permissions where tenant_id = '${A}'`)).toEqual([]);
    expect(await as(ADMIN_B, `update role_permissions set permissions = '{}' where tenant_id = '${A}' returning 1`)).toEqual([]);
    expect(await as(ADMIN_B, `delete from role_permissions where tenant_id = '${A}' returning 1`)).toEqual([]);
    expect(await fails(as(ADMIN_B, `select delete_company_role('LEAVE_CLERK')`))).toMatch(/Unknown role/);
    expect(await fails(invite(ADMIN_B, 'x@gmail.com', 'LEAVE_CLERK'))).toMatch(/Unknown role/);
    expect(await fails(as(ADMIN_B, `insert into role_permissions (role_name, permissions, tenant_id) values ('SPY', '{}', '${A}')`)))
      .toMatch(/row-level security/);
    expect(await fails(as(ADMIN_B, `select role_in_use('${A}', 'LEAVE_CLERK')`))).toMatch(/Not your company/);
    expect((await as<{ role_name: string }>(ADMIN_B, `select role_name from assignable_roles()`)).map((r) => r.role_name)).not.toContain('LEAVE_CLERK');
    // B makes a role with the same name: its own, separate
    expect(await create(ADMIN_B, 'Leave Clerk', ['payroll'])).toBe('LEAVE_CLERK');
    expect((await role(A, 'LEAVE_CLERK')).permissions).toEqual(['leaves', 'dashboard']);
  });

  it('a new company starts with the built-in roles only, not the default company’s own', async () => {
    const t = (await as<{ t: string }>(ADMIN, `select create_company('Fresh Co') t`))[0].t;
    expect((await rows<{ role_name: string }>(`select role_name from role_permissions where tenant_id = $1 order by 1`, [t])).map((r) => r.role_name))
      .toEqual(['ADMIN', 'CHECKER', 'HR', 'MANAGER', 'OPERATIONS', 'REGIONAL', 'STAFF']);
    expect((await role(t, 'HR')).display_name).toBe('Human Resources');
  });
});

describe('the migration on a live database', () => {
  it('gives every company the built-in roles and a row for each fixed role its people use, with no new access', async () => {
    const live = await bootDb({
      file: '20261015300000_company_roles.sql',
      seed: async (d) => {
        await d.exec(`
          insert into tenants (id, name, slug) values ('${B}', 'Old Co', 'old-co');
          insert into auth.users (id, email) values ('${HR}', 'hr@old.co');
          insert into user_profiles (user_id, email, role, tenant_id) values ('${HR}', 'hr@old.co', 'CHECKER', '${B}');
        `);
      },
    });
    const keys = await live.query<{ role_name: string; permissions: string[] }>(
      `select role_name, permissions from role_permissions where tenant_id = '${B}' order by 1`);
    expect(keys.rows).toEqual([
      { role_name: 'ADMIN', permissions: ['invite-people', 'create-channels'] },
      { role_name: 'CHECKER', permissions: [] },
      { role_name: 'STAFF', permissions: [] },
    ]);
    await live.close();
  }, 120000);
});

