// @vitest-environment node
//
// FIG-657 tier 2: HR workflow tables. Roles reach them through module permissions, employees work with
// their own rows where the Staff Portal needs it, and nobody crosses companies. Runs on the real
// (ziradev) schema snapshot.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const U = {
  STAFF: '00000000-0000-0000-0000-00000000a001', // employee E-ME
  HR: '00000000-0000-0000-0000-00000000a002',
  MANAGER: '00000000-0000-0000-0000-00000000a003',
  ADMIN: '00000000-0000-0000-0000-00000000a004',
  OTHER_ADMIN: '00000000-0000-0000-0000-00000000b0b0',
};
const ROLE_MODULES: Record<string, string[]> = {
  STAFF: ['dashboard'],
  HR: ['employees', 'reports', 'hr-lifecycle', 'leaves'],
  MANAGER: ['leaves', 'performance', 'recruitment', 'training'],
  ADMIN: [],
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
  const people: [string, string, string][] = [
    [U.STAFF, 'me@a.co', 'STAFF'], [U.HR, 'hr@a.co', 'HR'], [U.MANAGER, 'mgr@a.co', 'MANAGER'], [U.ADMIN, 'admin@a.co', 'ADMIN'],
  ];
  for (const [id, email, role] of people) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${A}');
    `);
  }
  for (const [role, mods] of Object.entries(ROLE_MODULES)) {
    await db.exec(`insert into role_permissions (role_name, permissions, tenant_id) values ('${role}', array[${mods.map((m) => `'${m}'`).join(',')}]::text[], '${A}')`);
  }
  await db.exec(`
    insert into auth.users (id, email) values ('${U.OTHER_ADMIN}', 'admin@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${U.OTHER_ADMIN}', 'admin@b.co', 'ADMIN', '${B}');
    insert into employees ("Employee Number", "First Name", "Work Email", tenant_id) values
      ('E-ME', 'Me', 'me@a.co', '${A}'), ('E-THEM', 'Them', 'them@a.co', '${A}'), ('E-ME', 'Me (B)', 'me@b.co', '${B}');
    insert into leave_types (id, name, tenant_id) values
      ('00000000-0000-0000-0000-0000000000a1', 'Annual Leave', '${A}'), ('00000000-0000-0000-0000-0000000000b1', 'Annual Leave', '${B}');
    insert into leave_balances (id, employee_number, leave_type_id, year, tenant_id) values
      ('00000000-0000-0000-0000-0000000001a1', 'E-ME', '00000000-0000-0000-0000-0000000000a1', 2026, '${A}'),
      ('00000000-0000-0000-0000-0000000001b1', 'E-ME', '00000000-0000-0000-0000-0000000000b1', 2026, '${B}');
    insert into leave_balance_adjustments (leave_balance_id, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, change_type, tenant_id) values
      ('00000000-0000-0000-0000-0000000001a1', 1, 0, 1, 0, 0, 'approval_deduction', '${A}'),
      ('00000000-0000-0000-0000-0000000001b1', 1, 0, 1, 0, 0, 'approval_deduction', '${B}');
  `);
}, 120000);

// ---------------------------------------------------------------------------------------------------
// tables only a module can use
// ---------------------------------------------------------------------------------------------------
const MODULE_ONLY: Record<string, { modules: string[]; seed: (t: string) => string; insert: string | null }> = {
  leave_balances: { modules: ['leaves'], seed: () => '', insert: null }, // seeded above
  leave_balance_adjustments: { modules: ['leaves'], seed: () => '', insert: null },
  hr_employment_status: { modules: ['hr-lifecycle'], seed: (t) => `insert into hr_employment_status (tenant_id) values ('${t}')`, insert: 'default values' },
  hr_leave_schedules: { modules: ['hr-lifecycle'], seed: (t) => `insert into hr_leave_schedules (tenant_id) values ('${t}')`, insert: 'default values' },
  hr_lifecycle_history: { modules: ['hr-lifecycle'], seed: (t) => `insert into hr_lifecycle_history (tenant_id) values ('${t}')`, insert: 'default values' },
  hr_contract_settings: { modules: ['hr-lifecycle'], seed: (t) => `insert into hr_contract_settings (tenant_id) values ('${t}')`, insert: 'default values' },
  employee_performance: { modules: ['performance'], seed: (t) => `insert into employee_performance (tenant_id) values ('${t}')`, insert: 'default values' },
  performance_targets: { modules: ['performance'], seed: (t) => `insert into performance_targets (tenant_id) values ('${t}')`, insert: 'default values' },
  job_positions: { modules: ['recruitment'], seed: (t) => `insert into job_positions (tenant_id) values ('${t}')`, insert: 'default values' },
};

describe.each(Object.entries(MODULE_ONLY))('%s', (table, cfg) => {
  beforeAll(async () => {
    const a = cfg.seed(A);
    if (a) {
      await db.exec(a);
      await db.exec(cfg.seed(B));
    }
  });

  for (const role of Object.keys(ROLE_MODULES)) {
    const allowed = role === 'ADMIN' || cfg.modules.some((m) => ROLE_MODULES[role].includes(m));
    it(`${role} ${allowed ? 'can' : 'cannot'} use it`, async () => {
      await asUser(db, U[role as keyof typeof U], async () => {
        expect(await count(`select 1 from ${table}`)).toBe(allowed ? 1 : 0);
        if (cfg.insert) expect(await attempt(`insert into ${table} ${cfg.insert}`)).toBe(allowed);
        if (!allowed) {
          expect(await count(`update ${table} set tenant_id = tenant_id returning 1`)).toBe(0);
          expect(await count(`delete from ${table} returning 1`)).toBe(0);
        }
      });
    });
  }

  it('an admin of another company sees only that company’s row', async () => {
    await asUser(db, U.OTHER_ADMIN, async () => {
      expect(await count(`select 1 from ${table}`)).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// tables employees also use
// ---------------------------------------------------------------------------------------------------
describe('leave_application', () => {
  beforeAll(async () => {
    await db.exec(`
      insert into leave_application ("Employee Number", name, "Leave Type", status, tenant_id) values
        ('E-ME', 'Me', 'Annual Leave', 'Pending', '${A}'),
        ('E-THEM', 'Them', 'Annual Leave', 'Pending', '${A}'),
        ('E-ME', 'Me (B)', 'Annual Leave', 'Pending', '${B}');
    `);
  });

  it('an employee sees only their own applications', async () => {
    await asUser(db, U.STAFF, async () => expect(await count(`select 1 from leave_application`)).toBe(1));
  });
  it('people with the leaves module see the whole company', async () => {
    for (const u of [U.HR, U.MANAGER, U.ADMIN]) await asUser(db, u, async () => expect(await count(`select 1 from leave_application`)).toBe(2));
  });
  it('an employee can apply for leave (Pending) but not for a colleague', async () => {
    await asUser(db, U.STAFF, async () => {
      expect(await attempt(`insert into leave_application ("Employee Number", status) values ('E-ME', 'Pending')`)).toBe(true);
      expect(await attempt(`insert into leave_application ("Employee Number", status) values ('E-THEM', 'Pending')`)).toBe(false);
    });
  });
  it('…and cannot approve, or pre-fill a recommendation, on their own application', async () => {
    await asUser(db, U.STAFF, async () => {
      expect(await attempt(`insert into leave_application ("Employee Number", status) values ('E-ME', 'approved')`)).toBe(false);
      expect(await attempt(`insert into leave_application ("Employee Number", status, recstatus) values ('E-ME', 'Pending', 'recommended')`)).toBe(false);
      expect(await attempt(`insert into leave_application ("Employee Number", status, recommendation_notes) values ('E-ME', 'Pending', 'fine by me')`)).toBe(false);
      expect(await count(`update leave_application set status = 'approved' where "Employee Number" = 'E-ME' returning 1`)).toBe(0);
    });
  });
  it('an approver can decide an application', async () => {
    await asUser(db, U.HR, async () => {
      expect(await attempt(`update leave_application set status = 'approved' where "Employee Number" = 'E-THEM'`)).toBe(true);
    });
  });
});

describe('hr_notifications', () => {
  beforeAll(async () => {
    await db.exec(`
      insert into hr_notifications (employee_number, notification_type, title, message, tenant_id) values
        ('E-ME', 'leave_approved', 'Approved', 'Your leave was approved', '${A}'),
        ('E-THEM', 'leave_approved', 'Approved', 'Your leave was approved', '${A}'),
        ('E-ME', 'leave_approved', 'Approved', 'Other company', '${B}');
    `);
  });
  it('an employee sees only their own notifications', async () => {
    await asUser(db, U.STAFF, async () => expect(await count(`select 1 from hr_notifications`)).toBe(1));
  });
  it('and can mark their own as read, but not a colleague’s, and cannot write new ones', async () => {
    await asUser(db, U.STAFF, async () => {
      expect(await count(`update hr_notifications set is_read_staff = true where employee_number = 'E-ME' returning 1`)).toBe(1);
      expect(await count(`update hr_notifications set is_read_staff = true where employee_number = 'E-THEM' returning 1`)).toBe(0);
      expect(await attempt(`insert into hr_notifications (employee_number, notification_type, title, message) values ('E-ME', 'leave_approved', 't', 'm')`)).toBe(false);
    });
  });
  it('approvers and HR can see and create them', async () => {
    for (const u of [U.HR, U.MANAGER]) {
      await asUser(db, u, async () => {
        expect(await count(`select 1 from hr_notifications`)).toBe(2);
        expect(await attempt(`insert into hr_notifications (employee_number, notification_type, title, message) values ('E-THEM', 'leave_approved', 't', 'm')`)).toBe(true);
      });
    }
  });
});

describe('attendance_logs', () => {
  beforeAll(async () => {
    await db.exec(`
      insert into attendance_logs (employee_number, status, tenant_id) values
        ('E-ME', 'logged_in', '${A}'), ('E-THEM', 'logged_in', '${A}'), ('E-ME', 'logged_in', '${B}');
    `);
  });
  it('an employee clocks in and out for themselves only', async () => {
    await asUser(db, U.STAFF, async () => {
      expect(await count(`select 1 from attendance_logs`)).toBe(1);
      expect(await attempt(`insert into attendance_logs (employee_number, status) values ('E-ME', 'logged_in')`)).toBe(true);
      expect(await attempt(`insert into attendance_logs (employee_number, status) values ('E-THEM', 'logged_in')`)).toBe(false);
      expect(await count(`update attendance_logs set status = 'logged_out' where employee_number = 'E-ME' returning 1`)).toBe(1);
      expect(await count(`update attendance_logs set status = 'logged_out' where employee_number = 'E-THEM' returning 1`)).toBe(0);
    });
  });
  it('HR sees the whole company; the manager (no employee-data module for attendance) sees none', async () => {
    await asUser(db, U.HR, async () => expect(await count(`select 1 from attendance_logs`)).toBe(2));
    await asUser(db, U.MANAGER, async () => expect(await count(`select 1 from attendance_logs`)).toBe(0));
  });
});

describe('job board', () => {
  beforeAll(async () => {
    await db.exec(`
      insert into job_postings (id, job_title, department, job_type, description, requirements, status, tenant_id) values
        ('00000000-0000-0000-0000-0000000002a1', 'Open job',   'IT', 'full', 'd', 'r', 'open',   '${A}'),
        ('00000000-0000-0000-0000-0000000002a2', 'Closed job', 'IT', 'full', 'd', 'r', 'closed', '${A}'),
        ('00000000-0000-0000-0000-0000000002b1', 'Other co',   'IT', 'full', 'd', 'r', 'open',   '${B}');
      insert into job_applications (job_posting_id, employee_number, status, tenant_id) values
        ('00000000-0000-0000-0000-0000000002a1', 'E-THEM', 'pending', '${A}');
    `);
  });
  it('an employee sees only open postings of their company; recruiters see them all', async () => {
    await asUser(db, U.STAFF, async () => expect(await count(`select 1 from job_postings`)).toBe(1));
    await asUser(db, U.MANAGER, async () => expect(await count(`select 1 from job_postings`)).toBe(2));
  });
  it('an employee cannot publish or change postings', async () => {
    await asUser(db, U.STAFF, async () => {
      expect(await attempt(`insert into job_postings (job_title, department, job_type, description, requirements) values ('x','x','x','x','x')`)).toBe(false);
      expect(await count(`update job_postings set status = 'closed' returning 1`)).toBe(0);
    });
    await asUser(db, U.MANAGER, async () => {
      expect(await attempt(`insert into job_postings (job_title, department, job_type, description, requirements) values ('x','x','x','x','x')`)).toBe(true);
    });
  });
  it('an employee applies (pending) for themselves, withdraws while pending, and cannot self-approve', async () => {
    await asUser(db, U.STAFF, async () => {
      expect(await count(`select 1 from job_applications`)).toBe(0); // the only application is a colleague's
      expect(await attempt(`insert into job_applications (job_posting_id, employee_number, status) values ('00000000-0000-0000-0000-0000000002a1', 'E-ME', 'pending')`)).toBe(true);
      expect(await attempt(`insert into job_applications (job_posting_id, employee_number, status) values ('00000000-0000-0000-0000-0000000002a1', 'E-THEM', 'pending')`)).toBe(false);
      expect(await attempt(`insert into job_applications (job_posting_id, employee_number, status) values ('00000000-0000-0000-0000-0000000002a1', 'E-ME', 'accepted')`)).toBe(false);

      await db.exec('begin');
      try {
        await db.query(`insert into job_applications (id, job_posting_id, employee_number, status) values ('00000000-0000-0000-0000-0000000003a1', '00000000-0000-0000-0000-0000000002a1', 'E-ME', 'pending')`);
        await db.exec('savepoint s1');
        const accepted = await db
          .query(`update job_applications set status = 'accepted' where id = '00000000-0000-0000-0000-0000000003a1' returning 1`)
          .then(() => true, () => false);
        await db.exec('rollback to savepoint s1');
        expect(accepted).toBe(false);
        expect((await db.query(`update job_applications set status = 'withdrawn' where id = '00000000-0000-0000-0000-0000000003a1' returning 1`)).rows.length).toBe(1);
      } finally {
        await db.exec('rollback');
      }
    });
  });
  it('recruiters see every application of the company', async () => {
    await asUser(db, U.MANAGER, async () => expect(await count(`select 1 from job_applications`)).toBe(1));
  });
});

describe('training', () => {
  beforeAll(async () => {
    await db.exec(`
      insert into training_documents (tenant_id) values ('${A}'), ('${B}');
      insert into training_videos (tenant_id) values ('${A}'), ('${B}');
      insert into training_progress (employee_number, tenant_id) values ('E-ME', '${A}'), ('E-THEM', '${A}'), ('E-ME', '${B}');
    `);
  });
  it('everyone in the company can read the training material, only trainers can add to it', async () => {
    await asUser(db, U.STAFF, async () => {
      expect(await count(`select 1 from training_documents`)).toBe(1);
      expect(await count(`select 1 from training_videos`)).toBe(1);
      expect(await attempt(`insert into training_documents default values`)).toBe(false);
      expect(await attempt(`insert into training_videos default values`)).toBe(false);
    });
    await asUser(db, U.MANAGER, async () => {
      expect(await attempt(`insert into training_documents default values`)).toBe(true);
      expect(await attempt(`insert into training_videos default values`)).toBe(true);
    });
  });
  it('an employee tracks their own progress only; trainers see everyone’s', async () => {
    await asUser(db, U.STAFF, async () => {
      expect(await count(`select 1 from training_progress`)).toBe(1);
      expect(await attempt(`insert into training_progress (employee_number) values ('E-ME')`)).toBe(true);
      expect(await attempt(`insert into training_progress (employee_number) values ('E-THEM')`)).toBe(false);
      expect(await count(`update training_progress set completed = true where employee_number = 'E-THEM' returning 1`)).toBe(0);
    });
    await asUser(db, U.MANAGER, async () => expect(await count(`select 1 from training_progress`)).toBe(2));
  });
});
