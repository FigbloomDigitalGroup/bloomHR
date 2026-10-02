// @vitest-environment node
//
// FIG-657 tier 1, batch 1: these tables are reachable only by roles whose module permissions
// include one of the screens that use them, and still never across tenants.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';

// table -> modules (must match 20261002000500_rls_module_access_batch1.sql) and a minimal valid insert
const TABLES: Record<string, { modules: string[]; insert: string }> = {
  payment_flows: { modules: ['payroll', 'mpesa-zap'], insert: 'default values' },
  salary_advance_payment_flows: { modules: ['salaryadmin'], insert: 'default values' },
  staff_loans: { modules: ['reports', 'payroll'], insert: 'default values' },
  statutory_deductions: { modules: ['reports', 'payroll'], insert: 'default values' },
  hr_salary_advances: { modules: ['hr-lifecycle'], insert: `("Employee Number", advance_date, advance_amount, monthly_deduction) values ('E1', current_date, 1, 1)` },
  expenses: { modules: ['expenses'], insert: 'default values' },
  mpesa_callbacks: { modules: ['mpesa-zap', 'salaryadmin'], insert: 'default values' },
  mpesa_transactions: { modules: ['mpesa-zap', 'reports'], insert: 'default values' },
  hr_terminations: { modules: ['hr-lifecycle'], insert: `("Employee Number", termination_date) values ('E1', current_date)` },
  hr_suspensions: { modules: ['hr-lifecycle'], insert: `("Employee Number", suspension_date) values ('E1', current_date)` },
  hr_termination_interviews: { modules: ['hr-lifecycle'], insert: `("Employee Number") values ('E1')` },
  termination_requests: { modules: ['employees', 'hr-lifecycle'], insert: 'default values' },
};

// default module sets from supabase/migrations/20260930000000_role_permissions.sql (+ hr-lifecycle)
const ROLE_MODULES: Record<string, string[]> = {
  ADMIN: [],
  HR: ['dashboard', 'employees', 'reports', 'hr-lifecycle'],
  CHECKER: ['dashboard', 'employees', 'payroll', 'expenses', 'salaryadmin', 'mpesa-zap', 'reports', 'hr-lifecycle'],
  MANAGER: ['dashboard', 'employees', 'expenses', 'salaryadmin', 'reports', 'hr-lifecycle'],
  STAFF: ['dashboard', 'task-manager', 'teams'],
};
const USER_ID: Record<string, string> = Object.fromEntries(Object.keys(ROLE_MODULES).map((r, i) => [r, `00000000-0000-0000-0000-00000000a0${i}${i}`]));

const mayAccess = (role: string, modules: string[]) => role === 'ADMIN' || modules.some((m) => ROLE_MODULES[role].includes(m));

let db: PGlite;
const rows = async (sql: string) => (await db.query(sql)).rows;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  for (const [role, mods] of Object.entries(ROLE_MODULES)) {
    await db.exec(`
      insert into auth.users (id, email) values ('${USER_ID[role]}', '${role.toLowerCase()}@a.co');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${USER_ID[role]}', '${role.toLowerCase()}@a.co', '${role}', '${A}');
      insert into role_permissions (role_name, permissions, tenant_id) values ('${role}', array[${mods.map((m) => `'${m}'`).join(',') || ''}]::text[], '${A}');
    `);
  }
  // an admin of the other company, to prove isolation still holds
  await db.exec(`
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000b0b0', 'admin@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('00000000-0000-0000-0000-00000000b0b0', 'admin@b.co', 'ADMIN', '${B}');
    insert into employees ("Employee Number", "First Name", tenant_id) values ('E1', 'Eve', '${A}');
  `);
  // one row per table, belonging to company A
  for (const [t, def] of Object.entries(TABLES)) {
    const ins = def.insert === 'default values' ? `(tenant_id) values ('${A}')` : def.insert.replace(/\) values \(/, ', tenant_id) values (').replace(/\)$/, `, '${A}')`);
    await db.exec(`insert into ${t} ${ins}`);
  }
}, 120000);

describe.each(Object.entries(TABLES))('%s', (table, def) => {
  for (const role of Object.keys(ROLE_MODULES)) {
    const allowed = mayAccess(role, def.modules);
    it(`${role} ${allowed ? 'can' : 'cannot'} use it`, async () => {
      await asUser(db, USER_ID[role], async () => {
        const seen = (await rows(`select 1 from ${table}`)).length;
        expect(seen).toBe(allowed ? 1 : 0);

        // run the write attempt inside a transaction that is always rolled back, so each role
        // starts from the same single seeded row
        await db.exec('begin');
        try {
          if (allowed) {
            await db.query(`insert into ${table} ${def.insert}`);
          } else {
            await expect(db.query(`insert into ${table} ${def.insert}`)).rejects.toThrow(/row-level security/);
          }
        } finally {
          await db.exec('rollback');
        }
        if (!allowed) {
          expect(await rows(`update ${table} set tenant_id = tenant_id returning 1`)).toEqual([]);
          expect(await rows(`delete from ${table} returning 1`)).toEqual([]);
        }
      });
    });
  }

  it('an admin of another company still sees nothing', async () => {
    await asUser(db, '00000000-0000-0000-0000-00000000b0b0', async () => {
      expect(await rows(`select 1 from ${table}`)).toEqual([]);
    });
  });
});
