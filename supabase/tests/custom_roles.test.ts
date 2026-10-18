// @vitest-environment node
//
// Companies create their own roles (FIG-827): company_roles, the modules a custom role gives, the limits that stop
// anyone handing out more than they may, and inviting people with a custom role. Real migrations on PGlite.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const ADMIN = '00000000-0000-0000-0000-00000000c001';
const HR = '00000000-0000-0000-0000-00000000c002';
const MANAGER = '00000000-0000-0000-0000-00000000c003';
const WORKER = '00000000-0000-0000-0000-00000000c004'; // STAFF, gets custom roles
const WORKER2 = '00000000-0000-0000-0000-00000000c005';
const ADMIN_B = '00000000-0000-0000-0000-00000000c0b1';
const INVITEE = '00000000-0000-0000-0000-00000000c006';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0];
const message = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'no error';
  } catch (e) {
    return (e as Error).message;
  }
};
const as = <T>(user: string, sql: string, params: unknown[] = []) => asUser(db, user, () => rows<T>(sql, params));
const asOne = async <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) => (await as<T>(user, sql, params))[0];
const fails = (user: string, sql: string, params: unknown[] = []) => asUser(db, user, () => message(db.query(sql, params)));

const roleId = async (tenant: string, key: string) => (await one<{ id: string }>(`select id from company_roles where tenant_id = $1 and role_key = $2`, [tenant, key])).id;
const create = async (user: string, name: string, base: string, modules: string[], description: string | null = null) =>
  (await asOne<{ id: string }>(user, `select create_company_role($1, $2, $3, $4::text[]) id`, [name, base, description, modules])).id;
const hasModule = async (user: string, module: string) => (await asOne<{ v: boolean }>(user, `select has_module($1) v`, [module])).v;
const profile = (user: string) =>
  one<{ role: string; company_role_id: string | null }>(`select role, company_role_id from user_profiles where user_id = $1`, [user]);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${ADMIN}', 'admin@a.co'), ('${HR}', 'hr@a.co'), ('${MANAGER}', 'manager@a.co'), ('${WORKER}', 'worker@a.co'),
      ('${WORKER2}', 'worker2@a.co'), ('${ADMIN_B}', 'admin@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${ADMIN}', 'admin@a.co', 'ADMIN', '${A}'), ('${HR}', 'hr@a.co', 'HR', '${A}'),
      ('${MANAGER}', 'manager@a.co', 'MANAGER', '${A}'), ('${WORKER}', 'worker@a.co', 'STAFF', '${A}'),
      ('${WORKER2}', 'worker2@a.co', 'STAFF', '${A}'), ('${ADMIN_B}', 'admin@b.co', 'ADMIN', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['dashboard', 'employees', 'leaves', 'invite-people'], '${A}'),
      ('MANAGER', array['dashboard', 'employees', 'leaves', 'payroll'], '${A}'),
      ('STAFF', array['dashboard'], '${A}'),
      ('STAFF', array['dashboard'], '${B}');
  `);
}, 120000);

describe('seeding', () => {
  it('every company has its seven system roles, named as the role screen showed them', async () => {
    for (const tenant of [A, B]) {
      const got = await rows<{ role_key: string; name: string; base_role: string; is_system: boolean }>(
        `select role_key, name, base_role, is_system from company_roles where tenant_id = $1 order by role_key`, [tenant]);
      expect(got.map((r) => r.role_key)).toEqual(['ADMIN', 'CHECKER', 'HR', 'MANAGER', 'OPERATIONS', 'REGIONAL', 'STAFF']);
      expect(got.every((r) => r.is_system && r.base_role === r.role_key)).toBe(true);
      expect(got.find((r) => r.role_key === 'HR')?.name).toBe('Human Resources');
    }
  });

  it('a company created later gets them too, and does not copy the default company’s own roles', async () => {
    await create(ADMIN, 'Default Co Only', 'STAFF', ['dashboard']);
    const founder = '00000000-0000-0000-0000-00000000c0f1';
    await db.exec(`insert into auth.users (id, email) values ('${founder}', 'founder@new.co')`);
    const tenant = (await asOne<{ id: string }>(founder, `select create_company('New Co') id`)).id;
    expect((await rows(`select 1 from company_roles where tenant_id = $1 and is_system`, [tenant])).length).toBe(7);
    expect(await rows(`select 1 from company_roles where tenant_id = $1 and not is_system`, [tenant])).toEqual([]);
    expect(await rows(`select 1 from role_permissions where tenant_id = $1 and role_name like 'CR\\_%'`, [tenant])).toEqual([]);
  });

  it('inviting people is a module ("invite-people") in the catalogue', async () => {
    expect(await rows(`select module_name from permissions where module_id = 'invite-people'`)).toEqual([{ module_name: 'Invite people' }]);
  });
});

describe('effective modules come from the custom role', () => {
  let supervisors: string;

  it('an administrator creates a role on a base role, with its own modules', async () => {
    supervisors = await create(ADMIN, ' Supervisors ', 'MANAGER', ['leaves', 'dashboard', 'leaves'], 'Floor supervisors');
    const r = await one<{ name: string; role_key: string; base_role: string; description: string }>(
      `select name, role_key, base_role, description from company_roles where id = $1`, [supervisors]);
    expect(r).toMatchObject({ name: 'Supervisors', base_role: 'MANAGER', description: 'Floor supervisors' });
    expect(r.role_key).toBe(`CR_${supervisors.replace(/-/g, '')}`);
    expect(await rows(`select permissions from role_permissions where tenant_id = $1 and role_name = $2`, [A, r.role_key])).toEqual([
      { permissions: ['dashboard', 'leaves'] },
    ]);
  });

  it('the holder has exactly its modules; their role stays the base role', async () => {
    await as(ADMIN, `select assign_company_role($1, $2)`, [MANAGER, supervisors]);
    expect(await profile(MANAGER)).toEqual({ role: 'MANAGER', company_role_id: supervisors });
    expect(await rows(`select role, company_role_id from memberships where user_id = $1`, [MANAGER])).toEqual([{ role: 'MANAGER', company_role_id: supervisors }]);
    expect(await hasModule(MANAGER, 'leaves')).toBe(true);
    // MANAGER (the base) has employees and payroll; this role does not
    expect(await hasModule(MANAGER, 'employees')).toBe(false);
    expect(await hasModule(MANAGER, 'payroll')).toBe(false);
    expect((await asOne<{ v: boolean }>(MANAGER, `select has_any_module('payroll', 'leaves') v`)).v).toBe(true);
    expect((await asOne<{ v: string }>(MANAGER, `select current_user_role() v`)).v).toBe('MANAGER');
    expect((await asOne<{ v: string[] }>(MANAGER, `select get_user_permissions($1) v`, [MANAGER])).v).toEqual(['dashboard', 'leaves']);
    expect((await asOne<{ v: boolean }>(ADMIN, `select has_permission($1, 'payroll') v`, [MANAGER])).v).toBe(false);
    expect((await asOne<{ v: string[] }>(MANAGER, `select my_modules() v`)).v).toEqual(['dashboard', 'leaves']);
  });

  it('changing the role’s modules changes what its holders have straight away', async () => {
    await as(ADMIN, `select set_company_role_modules($1, array['leaves', 'payroll'])`, [supervisors]);
    expect(await hasModule(MANAGER, 'payroll')).toBe(true);
    expect(await hasModule(MANAGER, 'dashboard')).toBe(false);
  });

  it('someone with a system role keeps their role’s modules, as before', async () => {
    expect(await profile(HR)).toEqual({ role: 'HR', company_role_id: null });
    expect(await hasModule(HR, 'employees')).toBe(true);
    expect(await hasModule(HR, 'payroll')).toBe(false);
  });

  it('a base role changed by something that knows nothing of company roles drops the company role', async () => {
    await as(ADMIN, `select assign_company_role($1, $2)`, [WORKER2, await create(ADMIN, 'Temp Pickers', 'STAFF', ['dashboard'])]);
    await db.exec(`update memberships set role = 'HR' where user_id = '${WORKER2}'`);
    expect(await profile(WORKER2)).toEqual({ role: 'HR', company_role_id: null });
    await db.exec(`update memberships set role = 'STAFF' where user_id = '${WORKER2}'`);
  });

  it('an ADMIN-based role has every module, as administrators do', async () => {
    const owners = await create(ADMIN, 'Owners', 'ADMIN', ['dashboard']);
    await as(ADMIN, `select assign_company_role($1, $2)`, [WORKER2, owners]);
    expect(await profile(WORKER2)).toEqual({ role: 'ADMIN', company_role_id: owners });
    expect(await hasModule(WORKER2, 'payroll')).toBe(true);
    await as(ADMIN, `select assign_company_role($1, $2)`, [WORKER2, await roleId(A, 'STAFF')]);
    expect(await profile(WORKER2)).toMatchObject({ role: 'STAFF' });
  });
});

describe('no escalation', () => {
  it('a role never holds an administrator-only module unless it is based on ADMIN', async () => {
    expect(await fails(ADMIN, `select create_company_role('Shift leads', 'STAFF', null, array['settings'])`)).toMatch(/cannot be given to a role based on anything but Administrator/);
    const leads = await create(ADMIN, 'Shift leads', 'OPERATIONS', ['dashboard']);
    expect(await fails(ADMIN, `select set_company_role_modules($1, array['role-permissions'])`, [leads])).toMatch(/cannot be given to a role based on anything but Administrator/);
    // not by writing role_permissions directly either
    const key = (await one<{ role_key: string }>(`select role_key from company_roles where id = $1`, [leads])).role_key;
    expect(await fails(ADMIN, `update role_permissions set permissions = array['settings'] where role_name = $1`, [key])).toMatch(/cannot be given to a role based on anything but Administrator/);
    expect(await fails(ADMIN, `select set_company_role_modules($1, array['no-such-module'])`, [leads])).toMatch(/Unknown module/);
    expect((await create(ADMIN, 'Directors', 'ADMIN', ['settings', 'role-permissions'])).length).toBe(36);
  });

  it('a STAFF-based role may hold the task modules, but not payroll or other powers over people and money', async () => {
    const planners = await create(ADMIN, 'Project planners', 'STAFF', ['task-manager', 'teams', 'invite-people']);
    expect(planners).toHaveLength(36);
    expect(await fails(ADMIN, `select set_company_role_modules($1, array['task-manager', 'payroll'])`, [planners])).toMatch(/"Payroll" cannot be given to a role based on Staff/);
    // the planned project-management module (FIG-901) is within a STAFF-based role's limit
    expect(await rows(`select module_allowed_for_base('STAFF', 'task-projects') a, module_allowed_for_base('STAFF', 'hr-lifecycle') b, module_allowed_for_base('MANAGER', 'payroll') c`)).toEqual([
      { a: true, b: false, c: true },
    ]);
  });

  it('only people who manage roles can create or change them', async () => {
    expect(await fails(HR, `select create_company_role('Pickers', 'STAFF', null, array['dashboard'])`)).toMatch(/Only an administrator can manage roles/);
    expect(await fails(WORKER, `select update_company_role($1, 'Hacked')`, [await roleId(A, 'STAFF')])).toMatch(/Only an administrator can manage roles/);
    expect(await fails(WORKER, `select set_company_role_modules($1, array['payroll'])`, [await roleId(A, 'STAFF')])).toMatch(/Only an administrator can manage roles/);
    // the table itself is read-only for signed-in users
    expect(await fails(ADMIN, `insert into company_roles (name, base_role, role_key) values ('X', 'STAFF', 'CR_00000000000000000000000000000000')`)).toMatch(/permission denied/);
    expect(await fails(ADMIN, `update company_roles set base_role = 'ADMIN'`)).toMatch(/permission denied/);
  });

  it('someone who manages roles but is not an administrator cannot create an ADMIN-based role or give access they lack', async () => {
    await db.exec(`update role_permissions set permissions = permissions || array['role-permissions'] where tenant_id = '${A}' and role_name = 'HR'`);
    try {
      expect(await fails(HR, `select create_company_role('Bosses', 'ADMIN', null, array['dashboard'])`)).toMatch(/Only an administrator can create a role based on Administrator/);
      expect(await fails(HR, `select create_company_role('Payroll clerks', 'MANAGER', null, array['payroll'])`)).toMatch(/access you do not have yourself/);
      const clerks = await create(HR, 'Leave clerks', 'MANAGER', ['leaves']);
      expect(clerks).toHaveLength(36);
      expect(await fails(HR, `select update_company_role($1, 'Admins')`, [await roleId(A, 'ADMIN')])).toMatch(/Only an administrator can change an administrator role/);
      expect(await fails(HR, `update role_permissions set permissions = array['payroll'] where role_name = 'STAFF'`)).toMatch(/access you do not have yourself/);
      expect(await fails(HR, `insert into role_permissions (role_name, permissions) values ('ADMIN', array['dashboard'])`)).toMatch(/Only an administrator can change an administrator role/);
    } finally {
      await db.exec(`update role_permissions set permissions = array_remove(permissions, 'role-permissions') where tenant_id = '${A}' and role_name = 'HR'`);
    }
  });

  it('nobody changes their own role, and clients cannot write who holds which role', async () => {
    const supervisors = (await one<{ id: string }>(`select id from company_roles where tenant_id = $1 and name = 'Supervisors'`, [A])).id;
    expect(await fails(ADMIN, `select assign_company_role($1, $2)`, [ADMIN, supervisors])).toMatch(/your own role/);
    expect(await fails(WORKER, `select assign_company_role($1, $2)`, [WORKER, supervisors])).toMatch(/your own role/);
    expect(await fails(WORKER, `update memberships set company_role_id = $1 where user_id = $2`, [supervisors, WORKER])).toMatch(/permission denied/);
    expect(await fails(WORKER, `update user_profiles set company_role_id = $1 where user_id = $2`, [supervisors, WORKER])).toMatch(/permission denied/);
  });

  it('HR (with "Invite people") gives only STAFF-based roles whose modules they hold, and never touches an administrator', async () => {
    const pickers = await create(ADMIN, 'Pickers', 'STAFF', ['dashboard', 'leaves']);
    const cashiers = await create(ADMIN, 'Cashiers', 'STAFF', ['expenses']); // HR has no expenses
    await as(HR, `select assign_company_role($1, $2)`, [WORKER, pickers]);
    expect(await profile(WORKER)).toEqual({ role: 'STAFF', company_role_id: pickers });
    expect(await fails(HR, `select assign_company_role($1, $2)`, [WORKER, cashiers])).toMatch(/Only an administrator can give this role/);
    expect(await fails(HR, `select assign_company_role($1, $2)`, [WORKER, await roleId(A, 'MANAGER')])).toMatch(/Only an administrator can give this role/);
    expect(await fails(HR, `select assign_company_role($1, $2)`, [ADMIN, pickers])).toMatch(/Only an administrator can give this role/);
    // someone without "Invite people" gives no roles at all
    expect(await fails(MANAGER, `select assign_company_role($1, $2)`, [WORKER, await roleId(A, 'STAFF')])).toMatch(/Only an administrator can give this role/);
  });

  it('a switched-off role cannot be given', async () => {
    const seasonal = await create(ADMIN, 'Seasonal', 'STAFF', ['dashboard']);
    await as(ADMIN, `select update_company_role($1, null, null, false)`, [seasonal]);
    expect(await fails(ADMIN, `select assign_company_role($1, $2)`, [WORKER2, seasonal])).toMatch(/switched off/);
    expect(await fails(ADMIN, `select * from create_invitation('s@gmail.com', 'STAFF', $1)`, [seasonal])).toMatch(/Unknown role/);
  });
});

describe('renaming, switching off and deleting', () => {
  it('a company renames how a system role is shown; system roles cannot be switched off or deleted', async () => {
    const hr = await roleId(A, 'HR');
    await as(ADMIN, `select update_company_role($1, 'People Team', 'Our HR people')`, [hr]);
    expect(await one(`select name, description from company_roles where id = $1`, [hr])).toEqual({ name: 'People Team', description: 'Our HR people' });
    expect(await fails(ADMIN, `select update_company_role($1, null, null, false)`, [hr])).toMatch(/cannot be switched off/);
    expect(await fails(ADMIN, `select delete_company_role($1)`, [hr])).toMatch(/cannot be deleted/);
    expect(await fails(ADMIN, `select update_company_role($1, 'pickers')`, [hr])).toMatch(/already a role called/);
  });

  it('a role people hold cannot be deleted or switched off until they are moved', async () => {
    const pickers = (await one<{ id: string }>(`select id from company_roles where tenant_id = $1 and name = 'Pickers'`, [A])).id;
    expect(await profile(WORKER)).toMatchObject({ company_role_id: pickers });
    expect(await fails(ADMIN, `select delete_company_role($1)`, [pickers])).toMatch(/1 person has this role. Move them to another role first/);
    expect(await fails(ADMIN, `select update_company_role($1, null, null, false)`, [pickers])).toMatch(/Move them to another role first/);
    expect(await as(ADMIN, `select role_key, people from company_role_holders() where people > 0 order by role_key`)).toEqual(
      expect.arrayContaining([{ role_key: `CR_${pickers.replace(/-/g, '')}`, people: 1 }])
    );

    await as(ADMIN, `select assign_company_role($1, $2)`, [WORKER, await roleId(A, 'STAFF')]);
    await as(ADMIN, `select delete_company_role($1)`, [pickers]);
    expect(await rows(`select 1 from company_roles where id = $1`, [pickers])).toEqual([]);
    expect(await rows(`select 1 from role_permissions where role_name = $1`, [`CR_${pickers.replace(/-/g, '')}`])).toEqual([]);
  });

  it('changes are written to the audit trail with the role names', async () => {
    const got = await rows<{ table_name: string; record_key: string; old_data: unknown; new_data: unknown; performed_by: string }>(
      `select table_name, record_key, old_data, new_data, performed_by from audit_log where table_name = 'role_assignments' and record_key = 'manager@a.co'`);
    expect(got).toEqual([{ table_name: 'role_assignments', record_key: 'manager@a.co', old_data: { role: 'Manager' }, new_data: { role: 'Supervisors' }, performed_by: ADMIN }]);
    expect((await rows(`select 1 from audit_log where table_name = 'company_roles' and record_key = 'Supervisors' and action_type = 'INSERT'`)).length).toBe(1);
    expect((await rows(`select 1 from audit_log where table_name = 'role_permissions' and record_key = 'Supervisors'`)).length).toBeGreaterThan(0);
  });
});

describe('company isolation', () => {
  it('a company sees only its own roles', async () => {
    const seen = await as<{ tenant_id: string }>(ADMIN_B, `select distinct tenant_id from company_roles`);
    expect(seen).toEqual([{ tenant_id: B }]);
    expect(await as(ADMIN_B, `select * from company_role_holders() where role_key like 'CR\\_%'`)).toEqual([]);
  });

  it('nobody can give, change or invite with another company’s role', async () => {
    const supervisors = (await one<{ id: string }>(`select id from company_roles where tenant_id = $1 and name = 'Supervisors'`, [A])).id;
    expect(await fails(ADMIN_B, `select set_company_role_modules($1, array['dashboard'])`, [supervisors])).toMatch(/Unknown role/);
    expect(await fails(ADMIN_B, `select update_company_role($1, 'Mine')`, [supervisors])).toMatch(/Unknown role/);
    expect(await fails(ADMIN_B, `select delete_company_role($1)`, [supervisors])).toMatch(/Unknown role/);
    expect(await fails(ADMIN_B, `select * from create_invitation('x@gmail.com', 'STAFF', $1)`, [supervisors])).toMatch(/Unknown role/);
    expect(await fails(ADMIN_B, `select assign_company_role($1, $2)`, [WORKER, supervisors])).toMatch(/not in this company/);
    // even the server cannot put a member of one company in another company's role
    expect(await message(db.query(`update memberships set company_role_id = $1 where user_id = $2`, [supervisors, ADMIN_B]))).toMatch(/another company/);
    expect(await message(db.query(`insert into role_permissions (tenant_id, role_name, permissions) values ($1, 'CR_00000000000000000000000000000000', '{}')`, [B]))).toMatch(/Unknown role/);
  });
});

describe('inviting with a custom role', () => {
  let packers: string;

  beforeAll(async () => {
    packers = await create(ADMIN, 'Packers', 'STAFF', ['dashboard', 'leaves']);
    await db.exec(`insert into auth.users (id, email) values ('${INVITEE}', 'packer@gmail.com')`);
  });

  it('the invitation carries the role; joining gives it, and its modules', async () => {
    const { token } = (await asOne<{ token: string }>(ADMIN, `select * from create_invitation('packer@gmail.com', 'ADMIN', $1)`, [packers]))!;
    // the base role comes from the company role, whatever was passed as the role
    expect(await one(`select role, company_role_id from invitations where email = 'packer@gmail.com'`)).toEqual({ role: 'STAFF', company_role_id: packers });
    await asAnon(db, async () => {
      expect(await rows(`select role, role_name from invitation_preview($1)`, [token])).toEqual([{ role: 'STAFF', role_name: 'Packers' }]);
    });
    await as(INVITEE, `select accept_invitation($1)`, [token]);
    expect(await profile(INVITEE)).toEqual({ role: 'STAFF', company_role_id: packers });
    expect(await hasModule(INVITEE, 'leaves')).toBe(true);
  });

  it('HR invites with STAFF-based roles whose modules they hold, but not others', async () => {
    const managersPlus = await create(ADMIN, 'Area leads', 'MANAGER', ['leaves']);
    const cashiers = (await one<{ id: string }>(`select id from company_roles where tenant_id = $1 and name = 'Cashiers'`, [A])).id;
    expect((await asOne<{ token: string }>(HR, `select * from create_invitation('p2@gmail.com', 'STAFF', $1)`, [packers])).token).toHaveLength(64);
    expect(await fails(HR, `select * from create_invitation('p3@gmail.com', 'STAFF', $1)`, [managersPlus])).toMatch(/Only an administrator can invite this role/);
    expect(await fails(HR, `select * from create_invitation('p4@gmail.com', 'STAFF', $1)`, [cashiers])).toMatch(/Only an administrator can invite this role/);
    expect(await fails(MANAGER, `select * from create_invitation('p5@gmail.com', 'STAFF')`)).toMatch(/Only an administrator or HR can invite people/);
  });

  it('the bulk queue takes a role per person and makes the invitation with it', async () => {
    const got = await asOne<{ queued: number; rejected: { email: string; reason: string }[] }>(
      HR,
      `select * from enqueue_invitations($1::jsonb)`,
      [JSON.stringify([
        { email: 'q1@gmail.com', company_role_id: packers },
        { email: 'q2@gmail.com', company_role_id: '00000000-0000-0000-0000-000000000000' },
        { email: 'q3@gmail.com', company_role_id: 'not-a-uuid' },
      ])]
    );
    expect(got.queued).toBe(1);
    expect(got.rejected).toEqual([
      { email: 'q2@gmail.com', reason: 'unknown role' },
      { email: 'q3@gmail.com', reason: 'unknown role' },
    ]);
    const claimed = await rows<{ email: string; role: string; role_name: string }>(`select email, role, role_name from claim_invitations(10)`);
    expect(claimed).toEqual([{ email: 'q1@gmail.com', role: 'STAFF', role_name: 'Packers' }]);
    expect(await one(`select role, company_role_id from invitations where email = 'q1@gmail.com'`)).toEqual({ role: 'STAFF', company_role_id: packers });
  });

  it('an invitation whose role was deleted gives the base role', async () => {
    const temp = await create(ADMIN, 'Temporary', 'STAFF', ['dashboard']);
    const { token } = (await asOne<{ token: string }>(ADMIN, `select * from create_invitation('temp@gmail.com', 'STAFF', $1)`, [temp]))!;
    await as(ADMIN, `select delete_company_role($1)`, [temp]);
    await asAnon(db, async () => {
      expect(await rows(`select role, role_name from invitation_preview($1)`, [token])).toEqual([{ role: 'STAFF', role_name: 'Staff' }]);
    });
  });
});

describe('the migration can run again', () => {
  it('changes nothing on a database that already has it', async () => {
    const snapshot = async () => ({
      roles: await rows(`select id, tenant_id, role_key, name, description, base_role, is_system, active from company_roles order by id`),
      perms: await rows(`select tenant_id, role_name, permissions from role_permissions order by tenant_id, role_name`),
      holders: await rows(`select user_id, tenant_id, role, company_role_id from memberships order by user_id, tenant_id`),
      profiles: await rows(`select user_id, role, company_role_id from user_profiles order by user_id`),
    });
    // a company that took "Invite people" away from HR keeps it that way
    await db.exec(`update role_permissions set permissions = array_remove(permissions, 'invite-people') where tenant_id = '${A}' and role_name = 'HR'`);
    const before = await snapshot();
    await db.exec(readFileSync(join(__dirname, '..', 'migrations', '20261019700000_custom_roles.sql'), 'utf8'));
    await db.exec('reset search_path');
    expect(await snapshot()).toEqual(before);
    expect(await hasModule(MANAGER, 'payroll')).toBe(true); // still the custom role's modules
  });
});
