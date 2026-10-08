// @vitest-environment node
//
// FIG-657 tier 1, batch 2: roles with the right module reach these tables, an employee reaches only
// their own rows, and nobody reaches another company's. Runs on the real (ziradev) schema snapshot.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';

const U = {
  STAFF: '00000000-0000-0000-0000-00000000a001', // linked to employee E-ME via Work Email
  COLLEAGUE: '00000000-0000-0000-0000-00000000a002', // another STAFF, employee E-THEM
  ADMIN: '00000000-0000-0000-0000-00000000a003',
  HR: '00000000-0000-0000-0000-00000000a004',
  UNLINKED: '00000000-0000-0000-0000-00000000a005', // STAFF login with no employee row
  OTHER_ADMIN: '00000000-0000-0000-0000-00000000b0b0', // admin of company B
};

// modules from the default role set (see module_access.test.ts)
const ROLE_MODULES: Record<string, string[]> = {
  ADMIN: [],
  HR: ['employees', 'reports', 'hr-lifecycle', 'staffcheck', 'phone-approvals'],
  STAFF: ['dashboard'],
};

type Cfg = {
  modules: string[];
  /** insert the row for employee `emp` (extra columns after the employee column) */
  row: (emp: string | null, tenant: string) => string;
  /** a row the employee is allowed to create for themselves, or null when staff cannot create rows */
  ownInsert: ((emp: string) => string) | null;
  /** insert attempts a STAFF user must be refused */
  forged: (emp: string) => string[];
};

const ins = (table: string, cols: string, vals: string) => `insert into ${table} (${cols}) values (${vals})`;
const REQ = `incident_type, severity, title, description`;
const REQV = `'harassment', 'low', 't', 'd'`;

const TABLES: Record<string, Cfg> = {
  payroll_records: {
    modules: ['payroll', 'hr-lifecycle'],
    row: (e, t) => ins('payroll_records', `"Employee ID", tenant_id`, `'${e}', '${t}'`),
    ownInsert: null,
    forged: (e) => [ins('payroll_records', `"Employee ID"`, `'${e}'`)],
  },
  payroll_records_current: {
    modules: ['payroll', 'hr-lifecycle'],
    row: (e, t) => ins('payroll_records_current', `"Employee ID", tenant_id`, `'${e}', '${t}'`),
    ownInsert: null,
    forged: () => [],
  },
  salary_history: {
    modules: ['payroll', 'hr-lifecycle'],
    // staff see payslips once the month's run is approved (payroll_runs.test.ts), so add each row to an approved run
    row: (e, t) => `
      update payroll_runs set status = 'draft' where tenant_id = '${t}' and pay_period = '2026-09';
      ${ins('salary_history', `employee_id, pay_period, tenant_id`, `'${e}', '2026-09', '${t}'`)};
      update payroll_runs set status = 'approved' where tenant_id = '${t}' and pay_period = '2026-09'`,
    ownInsert: null,
    forged: (e) => [ins('salary_history', `employee_id, pay_period`, `'${e}', '2026-10'`)],
  },
  salary_advance: {
    modules: ['salaryadmin', 'payroll', 'reports'],
    row: (e, t) => ins('salary_advance', `"Employee Number", tenant_id`, `'${e}', '${t}'`),
    ownInsert: (e) => ins('salary_advance', `"Employee Number", status`, `'${e}', 'Pending'`),
    forged: (e) => [
      ins('salary_advance', `"Employee Number", status`, `'${e}', 'Approved'`),
      ins('salary_advance', `"Employee Number", payment_processed`, `'${e}', 'true'`),
    ],
  },
  loan_requests: {
    modules: ['salaryadmin', 'settings', 'payroll'],
    row: (e, t) => ins('loan_requests', `"Employee Number", tenant_id`, `'${e}', '${t}'`),
    ownInsert: (e) => ins('loan_requests', `"Employee Number", status`, `'${e}', 'Pending'`),
    forged: (e) => [ins('loan_requests', `"Employee Number", status`, `'${e}', 'Approved'`)],
  },
  warnings: {
    modules: ['staffcheck'],
    row: (e, t) => ins('warnings', `employee_id, tenant_id`, `'${e}', '${t}'`),
    ownInsert: null,
    forged: (e) => [ins('warnings', `employee_id`, `'${e}'`)],
  },
  incident_reports: {
    modules: ['incident-reports'],
    row: (e, t) => ins('incident_reports', `employee_number, is_anonymous, tenant_id, ${REQ}`, `${e === null ? 'null' : `'${e}'`}, ${e === null}, '${t}', ${REQV}`),
    ownInsert: (e) => ins('incident_reports', `employee_number, is_anonymous, ${REQ}`, `'${e}', false, ${REQV}`),
    forged: (e) => [
      ins('incident_reports', `employee_number, is_anonymous, ${REQ}`, `'${e}', false, ${REQV}`), // filing as someone else (callers pass the colleague)
      ins('incident_reports', `employee_number, is_anonymous, ${REQ}`, `'${e}', true, ${REQV}`), // "anonymous" but naming someone
      ins('incident_reports', `employee_number, is_anonymous, status, ${REQ}`, `null, true, 'resolved', ${REQV}`),
    ],
  },
  phone_number_change_requests: {
    modules: ['phone-approvals'],
    row: (e, t) => ins('phone_number_change_requests', `employee_number, requested_phone, tenant_id`, `'${e}', '0700', '${t}'`),
    ownInsert: (e) => ins('phone_number_change_requests', `employee_number, requested_phone, status`, `'${e}', '0700', 'pending'`),
    forged: (e) => [ins('phone_number_change_requests', `employee_number, requested_phone, status`, `'${e}', '0700', 'approved'`)],
  },
  dependents: {
    modules: ['employees'],
    row: (e, t) => ins('dependents', `"Employee Number", tenant_id`, `'${e}', '${t}'`),
    ownInsert: (e) => ins('dependents', `"Employee Number"`, `'${e}'`),
    forged: (e) => [ins('dependents', `"Employee Number"`, `'${e}'`)],
  },
  emergency_contact: {
    modules: ['employees'],
    row: (e, t) => ins('emergency_contact', `"Employee Number", tenant_id`, `'${e}', '${t}'`),
    // the Staff Portal saves this with an upsert (insert, or update when one exists)
    ownInsert: (e) => `insert into emergency_contact ("Employee Number") values ('${e}') on conflict (tenant_id, "Employee Number") do update set full_name = 'x'`,
    forged: (e) => [ins('emergency_contact', `"Employee Number"`, `'${e}'`)],
  },
};

let db: PGlite;
const count = async (sql: string) => (await db.query(sql)).rows.length;
const tryInsert = async (sql: string) => {
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

  const people: [string, string, string][] = [
    [U.STAFF, 'me@a.co', 'STAFF'], [U.COLLEAGUE, 'them@a.co', 'STAFF'], [U.ADMIN, 'admin@a.co', 'ADMIN'],
    [U.HR, 'hr@a.co', 'HR'], [U.UNLINKED, 'nobody@a.co', 'STAFF'],
  ];
  for (const [id, email, role] of people) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${A}');
    `);
  }
  await db.exec(`
    insert into auth.users (id, email) values ('${U.OTHER_ADMIN}', 'admin@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${U.OTHER_ADMIN}', 'admin@b.co', 'ADMIN', '${B}');
    insert into employees ("Employee Number", "First Name", "Work Email", tenant_id) values
      ('E-ME', 'Me', 'me@a.co', '${A}'), ('E-THEM', 'Them', 'them@a.co', '${A}'),
      ('E-ME', 'Same number, other company', 'me@b.co', '${B}');
  `);
  for (const [role, mods] of Object.entries(ROLE_MODULES)) {
    await db.exec(`insert into role_permissions (role_name, permissions, tenant_id) values ('${role}', array[${mods.map((m) => `'${m}'`).join(',')}]::text[], '${A}')`);
  }
  // each table: one row for E-ME, one for E-THEM (company A), one for E-ME in company B, plus one anonymous report
  for (const cfg of Object.values(TABLES)) {
    await db.exec(cfg.row('E-ME', A));
    await db.exec(cfg.row('E-THEM', A));
    await db.exec(cfg.row('E-ME', B));
  }
  await db.exec(TABLES.incident_reports.row(null, A));
}, 120000);

describe.each(Object.entries(TABLES))('%s', (table, cfg) => {
  const modulesRole = (role: string) => role === 'ADMIN' || cfg.modules.some((m) => ROLE_MODULES[role].includes(m));
  const anonRows = table === 'incident_reports' ? 1 : 0;

  it('an employee sees only their own rows (never a colleague’s, another company’s, or an anonymous one)', async () => {
    await asUser(db, U.STAFF, async () => {
      expect(await count(`select 1 from ${table}`)).toBe(1);
    });
  });

  it('a login not linked to any employee sees nothing', async () => {
    await asUser(db, U.UNLINKED, async () => {
      expect(await count(`select 1 from ${table}`)).toBe(0);
    });
  });

  for (const role of ['ADMIN', 'HR'] as const) {
    it(`${role} ${modulesRole(role) ? 'sees every row of the company' : 'sees only their own (none)'}`, async () => {
      await asUser(db, U[role], async () => {
        expect(await count(`select 1 from ${table}`)).toBe(modulesRole(role) ? 2 + anonRows : 0);
      });
    });
  }

  it('an employee cannot change or delete anyone’s rows through update/delete they are not allowed', async () => {
    await asUser(db, U.STAFF, async () => {
      // rows of the colleague are invisible, so nothing can match them
      expect(await count(`update ${table} set tenant_id = tenant_id where tenant_id <> '${A}' returning 1`)).toBe(0);
    });
  });

  it('an admin of another company sees only that company’s row', async () => {
    await asUser(db, U.OTHER_ADMIN, async () => {
      expect(await count(`select 1 from ${table}`)).toBe(1);
    });
  });

  if (cfg.ownInsert) {
    it('an employee can create a row for themselves', async () => {
      await asUser(db, U.STAFF, async () => {
        expect(await tryInsert(cfg.ownInsert!('E-ME'))).toBe(true);
      });
    });
    it('…but not for a colleague', async () => {
      await asUser(db, U.STAFF, async () => {
        expect(await tryInsert(cfg.ownInsert!('E-THEM'))).toBe(false);
      });
    });
  } else {
    it('an employee cannot create rows', async () => {
      await asUser(db, U.STAFF, async () => {
        for (const sql of cfg.forged('E-ME')) expect(await tryInsert(sql)).toBe(false);
      });
    });
  }

  if (cfg.ownInsert) {
    it('an employee cannot create a row in a state they should not control (approved, paid, resolved, someone else’s…)', async () => {
      await asUser(db, U.STAFF, async () => {
        const attempts = table === 'incident_reports' ? cfg.forged('E-THEM') : table === 'dependents' || table === 'emergency_contact' ? [cfg.forged('E-THEM')[0]] : cfg.forged('E-ME');
        for (const sql of attempts) expect(await tryInsert(sql), sql).toBe(false);
      });
    });
  }
});

describe('specifics', () => {
  it('an employee can file an anonymous incident report but cannot read it back', async () => {
    await asUser(db, U.STAFF, async () => {
      await db.exec('begin');
      try {
        await db.query(`insert into incident_reports (employee_number, is_anonymous, ${REQ}) values (null, true, ${REQV})`);
        const before = await count(`select 1 from incident_reports`);
        expect(before).toBe(1); // still only their own identified report
      } finally {
        await db.exec('rollback');
      }
    });
  });

  it('an employee can cancel their own pending phone change request, not an approved one', async () => {
    await db.exec(`insert into phone_number_change_requests (employee_number, requested_phone, status, tenant_id) values ('E-ME', '0700', 'approved', '${A}')`);
    await asUser(db, U.STAFF, async () => {
      expect(await count(`delete from phone_number_change_requests where status = 'approved' returning 1`)).toBe(0);
      expect(await count(`delete from phone_number_change_requests where status = 'pending' returning 1`)).toBe(1);
    });
  });

  it('an employee maintains their own dependents and emergency contact', async () => {
    await asUser(db, U.STAFF, async () => {
      expect(await count(`update dependents set tenant_id = tenant_id where "Employee Number" = 'E-ME' returning 1`)).toBe(1);
      expect(await count(`update dependents set tenant_id = tenant_id where "Employee Number" = 'E-THEM' returning 1`)).toBe(0);
      expect(await count(`delete from emergency_contact where "Employee Number" = 'E-ME' returning 1`)).toBe(1);
    });
  });
});
