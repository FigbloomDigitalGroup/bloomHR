// @vitest-environment node
//
// FIG-657 tier 3: configuration, branches, performance/loan book and asset tables. Runs on the real
// (ziradev) schema snapshot.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const TYPE_A = '00000000-0000-0000-0000-0000000000a1';
const TYPE_B = '00000000-0000-0000-0000-0000000000b1';

const ROLE_MODULES: Record<string, string[]> = {
  STAFF: ['dashboard'],
  HR: ['employees', 'reports', 'hr-lifecycle', 'leaves'],
  MANAGER: ['leaves', 'performance', 'recruitment', 'training', 'asset'],
  SETTINGS: ['settings'],
  PAYROLL: ['payroll'],
  SMS: ['sms', 'email-portal'],
  ASSIGN: ['assign-managers', 'salaryadmin'],
  ADMIN: [],
};
const USER: Record<string, string> = Object.fromEntries(Object.keys(ROLE_MODULES).map((r, i) => [r, `00000000-0000-0000-0000-00000000a0${i}0`]));
const OTHER_ADMIN = '00000000-0000-0000-0000-00000000b0b0';

type Mode = 'read_all' | 'module' | 'read_only';
type Spec = { mode: Mode; modules: string[]; seed: (t: string, tag: string) => string; insert: string | null };

const dv = (table: string) => (t: string) => `insert into ${table} (tenant_id) values ('${t}')`;
const SPECS: Record<string, Spec> = {
  leave_types: { mode: 'read_all', modules: ['leaves'], seed: (t) => `insert into leave_types (id, name, tenant_id) values ('${t === A ? TYPE_A : TYPE_B}', 'Annual Leave', '${t}')`, insert: `(name) values ('Study')` },
  leave_policies: { mode: 'read_all', modules: ['leaves'], seed: (t) => `insert into leave_policies (leave_type_id, tenant_id) values ('${t === A ? TYPE_A : TYPE_B}', '${t}')`, insert: `(leave_type_id, effective_from) values ('${TYPE_A}', '2030-01-01')` },
  holidays: { mode: 'read_all', modules: ['leaves'], seed: dv('holidays'), insert: 'default values' },
  salary_advance_settings: { mode: 'read_all', modules: ['salaryadmin', 'settings'], seed: dv('salary_advance_settings'), insert: '(id) values (2)' },
  company_logo: { mode: 'read_all', modules: ['settings'], seed: dv('company_logo'), insert: 'default values' },
  company_events: { mode: 'read_all', modules: ['settings', 'employees', 'hr-lifecycle'], seed: (t) => `insert into company_events (date, title, tenant_id) values (current_date, 'Party', '${t}')`, insert: `(date, title) values (current_date, 'Picnic')` },
  kenya_branches: { mode: 'read_all', modules: ['settings'], seed: dv('kenya_branches'), insert: 'default values' },
  regional_managers: { mode: 'read_all', modules: ['assign-managers'], seed: (t, tag) => `insert into regional_managers (email, tenant_id) values ('rm-${tag}@x.co', '${t}')`, insert: `(email) values ('new@x.co')` },
  statutory_settings: { mode: 'module', modules: ['payroll', 'reports'], seed: dv('statutory_settings'), insert: 'default values' },
  system_settings: { mode: 'module', modules: ['settings', 'adminconfirm', 'email-portal'], seed: dv('system_settings'), insert: '(id) values (2)' },
  sender_id_configs: { mode: 'module', modules: ['sms'], seed: dv('sender_id_configs'), insert: 'default values' },
  sms_templates: { mode: 'module', modules: ['sms'], seed: dv('sms_templates'), insert: 'default values' },
  kenya_office_locations: { mode: 'module', modules: ['recruitment'], seed: dv('kenya_office_locations'), insert: 'default values' },
  branch_performance: { mode: 'module', modules: ['performance'], seed: dv('branch_performance'), insert: 'default values' },
  clients: { mode: 'module', modules: ['performance'], seed: (t, tag) => `insert into clients (client_id, tenant_id) values ('c-${tag}', '${t}')`, insert: `(client_id) values ('c-new')` },
  client_visits: { mode: 'module', modules: ['performance'], seed: dv('client_visits'), insert: 'default values' },
  loans: { mode: 'module', modules: ['performance'], seed: dv('loans'), insert: 'default values' },
  loan_payments: { mode: 'module', modules: ['performance'], seed: dv('loan_payments'), insert: 'default values' },
  assets: { mode: 'module', modules: ['asset'], seed: dv('assets'), insert: 'default values' },
  audit_log: { mode: 'read_only', modules: ['settings'], seed: dv('audit_log'), insert: 'default values' },
};

let db: PGlite;
const count = async (sql: string) => (await db.query(sql)).rows.length;
const attempt = async (sql: string) => {
  await db.exec('begin');
  try {
    await db.query(sql);
    return true;
  } catch {
    return false;
  } finally {
    await db.exec('rollback');
  }
};

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  for (const [role, mods] of Object.entries(ROLE_MODULES)) {
    await db.exec(`
      insert into auth.users (id, email) values ('${USER[role]}', '${role.toLowerCase()}@a.co');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${USER[role]}', '${role.toLowerCase()}@a.co', '${role}', '${A}');
      insert into role_permissions (role_name, permissions, tenant_id) values ('${role}', array[${mods.map((m) => `'${m}'`).join(',')}]::text[], '${A}');
    `);
  }
  await db.exec(`
    insert into auth.users (id, email) values ('${OTHER_ADMIN}', 'admin@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${OTHER_ADMIN}', 'admin@b.co', 'ADMIN', '${B}');
  `);
  for (const spec of Object.values(SPECS)) {
    await db.exec(spec.seed(A, 'a'));
    await db.exec(spec.seed(B, 'b')); // for the singleton settings tables this proves each company can have its own id = 1 row
  }
}, 120000);

describe.each(Object.entries(SPECS))('%s', (table, spec) => {
  for (const role of Object.keys(ROLE_MODULES)) {
    const mayUse = role === 'ADMIN' || spec.modules.some((m) => ROLE_MODULES[role].includes(m));
    const mayRead = spec.mode === 'read_all' ? true : mayUse;
    const mayWrite = spec.mode === 'read_only' ? false : mayUse;

    it(`${role}: ${mayRead ? 'reads' : 'cannot read'}, ${mayWrite ? 'can change' : 'cannot change'}`, async () => {
      await asUser(db, USER[role], async () => {
        expect(await count(`select 1 from ${table}`)).toBe(mayRead ? 1 : 0);
        expect(await attempt(`insert into ${table} ${spec.insert}`)).toBe(mayWrite);
        if (!mayWrite) {
          expect(await count(`update ${table} set tenant_id = tenant_id returning 1`)).toBe(0);
          expect(await count(`delete from ${table} returning 1`)).toBe(0);
        }
      });
    });
  }

  it('an admin of another company sees only that company’s row and cannot touch ours', async () => {
    await asUser(db, OTHER_ADMIN, async () => {
      expect(await count(`select 1 from ${table}`)).toBe(1);
      if (spec.mode !== 'read_only') expect(await count(`update ${table} set tenant_id = tenant_id where tenant_id = '${A}' returning 1`)).toBe(0);
    });
  });
});

describe('system_settings keeps the Gmail tokens private but everyone can learn whether MFA is on', () => {
  beforeAll(async () => {
    await db.exec(`update system_settings set mfa_enabled = true, gmail_refresh_token = 'secret-a' where tenant_id = '${A}'`);
  });
  it('a staff member cannot read the settings row at all', async () => {
    await asUser(db, USER.STAFF, async () => {
      expect(await count(`select gmail_refresh_token from system_settings`)).toBe(0);
    });
  });
  it('…but mfa_required() answers for their own company', async () => {
    await asUser(db, USER.STAFF, async () => {
      expect((await db.query<{ v: boolean }>(`select mfa_required() v`)).rows[0].v).toBe(true);
    });
    await asUser(db, OTHER_ADMIN, async () => {
      expect((await db.query<{ v: boolean }>(`select mfa_required() v`)).rows[0].v).toBe(false);
    });
  });
  it('mfa_required() is not available to anonymous users', async () => {
    await expect(db.query(`set role anon`).then(() => db.query(`select mfa_required()`))).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
  });
});

describe('singleton settings rows are per company', () => {
  it('a settings admin can upsert their company’s id = 1 row; a staff member cannot', async () => {
    await asUser(db, USER.SETTINGS, async () => {
      expect(await attempt(`insert into salary_advance_settings (id, applications_active) values (1, false) on conflict (tenant_id, id) do update set applications_active = excluded.applications_active`)).toBe(true);
    });
    await asUser(db, USER.STAFF, async () => {
      expect(await attempt(`insert into salary_advance_settings (id, applications_active) values (1, false) on conflict (tenant_id, id) do update set applications_active = excluded.applications_active`)).toBe(false);
    });
  });
});
