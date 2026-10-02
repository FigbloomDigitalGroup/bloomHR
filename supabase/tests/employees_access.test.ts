// @vitest-environment node
//
// FIG-657 tier 1, batch 3: the employees table. Staff see and edit only their own row (personal and
// statutory details only); roles that work with employee data see the whole company; everyone can use
// employee_directory for colleague lookups, which never exposes pay, ID, tax, bank or personal contacts.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const U = {
  STAFF: '00000000-0000-0000-0000-00000000a001', // employee E-ME
  COLLEAGUE: '00000000-0000-0000-0000-00000000a002', // employee E-THEM
  HR: '00000000-0000-0000-0000-00000000a003',
  PAYROLL: '00000000-0000-0000-0000-00000000a004',
  ADMIN: '00000000-0000-0000-0000-00000000a005',
  UNLINKED: '00000000-0000-0000-0000-00000000a006',
  OTHER_ADMIN: '00000000-0000-0000-0000-00000000b0b0',
};

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const attempt = async (sql: string) => {
  await db.exec('begin');
  try {
    await db.query(sql);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  } finally {
    await db.exec('rollback');
  }
};

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  const people: [string, string, string][] = [
    [U.STAFF, 'me@a.co', 'STAFF'], [U.COLLEAGUE, 'them@a.co', 'STAFF'], [U.HR, 'hr@a.co', 'HR'],
    [U.PAYROLL, 'pay@a.co', 'PAYROLL'], [U.ADMIN, 'admin@a.co', 'ADMIN'], [U.UNLINKED, 'nobody@a.co', 'STAFF'],
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
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('STAFF',   array['dashboard','task-manager','teams'], '${A}'),
      ('HR',      array['employees','reports','hr-lifecycle'], '${A}'),
      ('PAYROLL', array['payroll'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Job Title", "Basic Salary", "Tax PIN", "Personal Mobile", tenant_id) values
      ('E-ME',   'Me',   'Staff', 'me@a.co',   'Clerk',   1000, 'A111', '0711', '${A}'),
      ('E-THEM', 'Them', 'Staff', 'them@a.co', 'Manager', 5000, 'A222', '0722', '${A}'),
      ('E-OTHER-CO', 'Far', 'Away', 'far@b.co', 'CEO',   9000, 'B333', '0733', '${B}');
  `);
}, 120000);

describe('reading employees', () => {
  it('a staff member sees only their own row, with their own pay', async () => {
    await asUser(db, U.STAFF, async () => {
      const r = await rows<{ n: string; s: string }>(`select "Employee Number" n, "Basic Salary" s from employees`);
      expect(r).toEqual([{ n: 'E-ME', s: '1000' }]);
    });
  });

  it('…and cannot read a colleague’s salary or tax PIN by asking for it directly', async () => {
    await asUser(db, U.STAFF, async () => {
      expect(await rows(`select "Basic Salary" from employees where "Employee Number" = 'E-THEM'`)).toEqual([]);
      expect(await rows(`select "Tax PIN" from employees where "Work Email" = 'them@a.co'`)).toEqual([]);
    });
  });

  it('a login not linked to an employee sees no employee rows', async () => {
    await asUser(db, U.UNLINKED, async () => {
      expect(await rows(`select 1 from employees`)).toEqual([]);
    });
  });

  it('roles with an employee-data module see the whole company, never another one', async () => {
    for (const user of [U.HR, U.PAYROLL, U.ADMIN]) {
      await asUser(db, user, async () => {
        const r = await rows<{ n: string }>(`select "Employee Number" n from employees order by 1`);
        expect(r.map((x) => x.n)).toEqual(['E-ME', 'E-THEM']);
      });
    }
    await asUser(db, U.OTHER_ADMIN, async () => {
      expect((await rows<{ n: string }>(`select "Employee Number" n from employees`)).map((x) => x.n)).toEqual(['E-OTHER-CO']);
    });
  });

  it('anonymous users see nothing', async () => {
    await asAnon(db, async () => {
      expect(await rows(`select 1 from employees`)).toEqual([]);
    });
  });
});

describe('employee_directory', () => {
  const SENSITIVE = ['Basic Salary', 'ID Number', 'Tax PIN', 'NHIF Number', 'SHIF Number', 'NSSF Number', 'Account Number', 'Bank',
    'Bank Branch', 'Personal Mobile', 'Personal Email', 'Mobile Number', 'house_allowance', 'travel_allowance', 'bonus',
    'overtime', 'hardship', 'passport_number', 'Marital Status', 'Termination Date', 'Contract End Date'];

  it('never exposes pay, ID, tax, bank or personal contact columns', async () => {
    const cols = (await rows<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'employee_directory'`
    )).map((c) => c.column_name);
    expect(cols.length).toBeGreaterThan(10);
    for (const s of SENSITIVE) expect(cols, s).not.toContain(s);
  });

  it('lets a staff member look up colleagues (names, titles) in their own company only', async () => {
    await asUser(db, U.STAFF, async () => {
      const r = await rows<{ n: string; t: string }>(`select "Employee Number" n, "Job Title" t from employee_directory order by 1`);
      expect(r).toEqual([{ n: 'E-ME', t: 'Clerk' }, { n: 'E-THEM', t: 'Manager' }]);
    });
  });

  it('works for a login without an employee row too, but is closed to anonymous users', async () => {
    await asUser(db, U.UNLINKED, async () => {
      expect((await rows(`select 1 from employee_directory`)).length).toBe(2);
    });
    await asAnon(db, async () => {
      await expect(db.query(`select 1 from employee_directory`)).rejects.toThrow(/permission denied/);
    });
  });

  it('shows another company’s admin only their own company', async () => {
    await asUser(db, U.OTHER_ADMIN, async () => {
      expect((await rows<{ n: string }>(`select "Employee Number" n from employee_directory`)).map((x) => x.n)).toEqual(['E-OTHER-CO']);
    });
  });
});

describe('writing employees', () => {
  it('staff cannot create or delete employees, or change a colleague', async () => {
    await asUser(db, U.STAFF, async () => {
      expect((await attempt(`insert into employees ("Employee Number", "First Name") values ('E-NEW', 'Mallory')`)).ok).toBe(false);
      expect(await rows(`delete from employees returning 1`)).toEqual([]);
      expect(await rows(`update employees set "Job Title" = 'Boss' where "Employee Number" = 'E-THEM' returning 1`)).toEqual([]);
    });
  });

  it('staff can edit their own personal details', async () => {
    await asUser(db, U.STAFF, async () => {
      const r = await attempt(`update employees set "Personal Email" = 'new@me.co', "Postal Address" = 'Box 1', "Tax PIN" = 'A999' where "Employee Number" = 'E-ME'`);
      expect(r.ok).toBe(true);
    });
  });

  it('…and a client that sends the whole row back unchanged is fine', async () => {
    await asUser(db, U.STAFF, async () => {
      const r = await attempt(`update employees set "Basic Salary" = "Basic Salary", "Job Title" = "Job Title", "Personal Email" = 'x@y.co' where "Employee Number" = 'E-ME'`);
      expect(r.ok).toBe(true);
    });
  });

  it('staff cannot change their own pay, job, status or organisation', async () => {
    await asUser(db, U.STAFF, async () => {
      for (const set of [`"Basic Salary" = 999999`, `"Job Title" = 'CEO'`, `"Status" = 'Terminated'`, `"Town" = 'HQ'`, `house_allowance = '5000'`,
        `"Leave Approver" = 'Me Staff'`, `"Work Email" = 'me@evil.co'`, `"Employee Number" = 'E-HACK'`, `tenant_id = '${B}'`]) {
        const r = await attempt(`update employees set ${set} where "Employee Number" = 'E-ME'`);
        expect(r.ok, set).toBe(false);
      }
    });
  });

  it('people who manage employees can change pay and job details, but not across companies', async () => {
    await asUser(db, U.HR, async () => {
      expect((await attempt(`update employees set "Basic Salary" = 1200, "Job Title" = 'Senior Clerk' where "Employee Number" = 'E-ME'`)).ok).toBe(true);
      expect(await rows(`update employees set "Basic Salary" = 1 where "Employee Number" = 'E-OTHER-CO' returning 1`)).toEqual([]);
    });
    await asUser(db, U.PAYROLL, async () => {
      expect((await attempt(`update employees set "Basic Salary" = 1300 where "Employee Number" = 'E-ME'`)).ok).toBe(true);
    });
  });

  it('only employees/payroll modules may add employees; only the employees module may delete', async () => {
    await asUser(db, U.HR, async () => {
      expect((await attempt(`insert into employees ("Employee Number", "First Name") values ('E-NEW', 'Newbie')`)).ok).toBe(true);
    });
    await asUser(db, U.PAYROLL, async () => {
      expect((await attempt(`insert into employees ("Employee Number", "First Name") values ('E-NEW2', 'Newbie2')`)).ok).toBe(true);
      expect(await rows(`delete from employees where "Employee Number" = 'E-ME' returning 1`)).toEqual([]);
    });
    await asUser(db, U.HR, async () => {
      await db.exec('begin');
      try {
        expect((await rows(`delete from employees where "Employee Number" = 'E-THEM' returning 1`)).length).toBe(1);
      } finally {
        await db.exec('rollback');
      }
    });
  });

  it('the backend (no signed-in user) is not limited by the self-edit guard', async () => {
    const r = await attempt(`update employees set "Basic Salary" = 4242 where "Employee Number" = 'E-ME'`);
    expect(r.ok).toBe(true);
  });
});
