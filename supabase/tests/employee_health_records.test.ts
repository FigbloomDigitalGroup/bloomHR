// @vitest-environment node
//
// Health records (20261012500000): voluntary, with consent; the employee keeps their own; HR and administrators read
// them only through health_records_for(), and every read is logged; the audit log never holds medical details.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const U = {
  STAFF: '00000000-0000-0000-0000-00000000e101', // E-ME
  OTHER: '00000000-0000-0000-0000-00000000e102', // E-THEM
  HR: '00000000-0000-0000-0000-00000000e103',
  PAYROLL: '00000000-0000-0000-0000-00000000e104',
  ADMIN: '00000000-0000-0000-0000-00000000e105',
};

let db: PGlite;
const ids: Record<string, string> = {};
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const run = async (sql: string) => {
  try {
    await db.query(sql);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const addRecord = (title = 'Asthma') =>
  `insert into employee_health_records (employee_id, kind, title, details, institution, diagnosed_on)
   values ('${ids['E-ME']}', 'condition', '${title}', 'Uses an inhaler', 'Kenyatta National Hospital', '2019-05-01')`;
const healthOf = async (as: string, employee = 'E-ME') =>
  (await asUser(db, as, () => rows<{ h: { consent_given_at: string | null; records: { title: string; files: { file_name: string }[] }[] } }>(
    `select health_records_for('${ids[employee]}') h`)))[0].h;

beforeAll(async () => {
  db = await bootLiveDb();
  for (const [id, email, role] of [[U.STAFF, 'me@a.co', 'STAFF'], [U.OTHER, 'them@a.co', 'STAFF'], [U.HR, 'hr@a.co', 'HR'], [U.PAYROLL, 'pay@a.co', 'PAYROLL'], [U.ADMIN, 'admin@a.co', 'ADMIN']]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${A}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('STAFF', array['dashboard'], '${A}'), ('HR', array['employees'], '${A}'), ('PAYROLL', array['payroll', 'settings'], '${A}');
    insert into employees ("Employee Number", "First Name", "Work Email", tenant_id) values
      ('E-ME', 'Amina', 'me@a.co', '${A}'), ('E-THEM', 'Otieno', 'them@a.co', '${A}');
  `);
  for (const n of ['E-ME', 'E-THEM']) ids[n] = (await rows<{ id: string }>(`select id from employees where "Employee Number" = '${n}'`))[0].id;
}, 120000);

describe('consent', () => {
  it('nothing can be added before the employee consents', async () => {
    expect(await asUser(db, U.STAFF, () => run(addRecord()))).toMatch(/Give your consent/);
  });

  it('the employee consents for themselves only, then adds conditions and accommodation needs', async () => {
    expect(await asUser(db, U.STAFF, () => run(`insert into employee_health_consents (employee_id) values ('${ids['E-THEM']}')`))).toMatch(/row-level security/);
    expect(await asUser(db, U.HR, () => run(`insert into employee_health_consents (employee_id) values ('${ids['E-ME']}')`))).toMatch(/row-level security/);
    expect(await asUser(db, U.STAFF, () => run(`insert into employee_health_consents (employee_id) values ('${ids['E-ME']}')`))).toBe('');
    expect(await asUser(db, U.STAFF, () => run(addRecord()))).toBe('');
    expect(await asUser(db, U.STAFF, () => run(`insert into employee_health_records (employee_id, kind, title)
      values ('${ids['E-ME']}', 'accommodation', 'Ground-floor workstation')`))).toBe('');
  });
});

describe('supporting documents', () => {
  it('go in the employee’s own health folder', async () => {
    const [{ id }] = await rows<{ id: string }>(`select id from employee_health_records where title = 'Asthma'`);
    expect(await asUser(db, U.STAFF, () => run(`insert into employee_health_files (record_id, file_path, file_name)
      values ('${id}', '${A}/${U.STAFF}/onboarding/x.pdf', 'x.pdf')`))).toMatch(/own folder/);
    expect(await asUser(db, U.STAFF, () => run(`insert into employee_health_files (record_id, file_path, file_name)
      values ('${id}', '${A}/${U.STAFF}/health/report.pdf', 'report.pdf')`))).toBe('');
  });
});

describe('who sees health records', () => {
  it('nobody but the employee reads the tables', async () => {
    for (const u of [U.OTHER, U.HR, U.PAYROLL, U.ADMIN]) {
      expect(await asUser(db, u, () => rows(`select 1 from employee_health_records`))).toEqual([]);
      expect(await asUser(db, u, () => rows(`select 1 from employee_health_files`))).toEqual([]);
    }
    expect(await asUser(db, U.STAFF, () => rows(`select 1 from employee_health_records`))).toHaveLength(2);
  });

  it('HR and administrators read them through health_records_for, with the documents', async () => {
    for (const u of [U.HR, U.ADMIN]) {
      const h = await healthOf(u);
      expect(h.consent_given_at).toBeTruthy();
      expect(h.records.map((r) => r.title)).toEqual(['Asthma', 'Ground-floor workstation']);
      expect(h.records[0].files.map((f) => f.file_name)).toEqual(['report.pdf']);
    }
  });

  it('payroll and colleagues cannot', async () => {
    expect(await asUser(db, U.PAYROLL, () => run(`select health_records_for('${ids['E-ME']}')`))).toMatch(/Only HR/);
    expect(await asUser(db, U.OTHER, () => run(`select health_records_for('${ids['E-ME']}')`))).toMatch(/Only HR/);
  });

  it('every HR read is logged (the employee reading their own is not)', async () => {
    const views = await rows<{ performed_by: string }>(`select performed_by from audit_log where table_name = 'employee_health_records' and action_type = 'VIEW' order by performed_at`);
    expect(views.map((v) => v.performed_by)).toEqual([U.HR, U.ADMIN]);
    await healthOf(U.STAFF);
    expect(await rows(`select 1 from audit_log where action_type = 'VIEW' and performed_by = '${U.STAFF}'`)).toEqual([]);
  });

  it('opening a health document is logged too', async () => {
    const [{ id }] = await rows<{ id: string }>(`select id from employee_health_files`);
    expect(await asUser(db, U.HR, () => run(`select log_health_file_view('${id}')`))).toBe('');
    expect(await asUser(db, U.PAYROLL, () => run(`select log_health_file_view('${id}')`))).toMatch(/Only HR/);
    expect(await rows(`select 1 from audit_log where table_name = 'employee_health_files' and action_type = 'VIEW'`)).toHaveLength(1);
  });

  it('the audit log records changes without their contents, even for those who can read all of it', async () => {
    const logged = await rows<{ old_data: unknown; new_data: unknown }>(`select old_data, new_data from audit_log where table_name like 'employee_health%'`);
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.every((r) => r.old_data === null && r.new_data === null)).toBe(true);
    const text = JSON.stringify(await asUser(db, U.PAYROLL, () => rows(`select * from audit_log`))); // settings module reads the whole log
    expect(text).not.toMatch(/Asthma|inhaler|Kenyatta/);
  });
});

describe('withdrawing consent', () => {
  it('deletes the employee’s health records and documents', async () => {
    expect(await asUser(db, U.STAFF, () => rows(`delete from employee_health_consents returning 1`))).toHaveLength(1);
    expect(await rows(`select 1 from employee_health_records`)).toEqual([]);
    expect(await rows(`select 1 from employee_health_files`)).toEqual([]);
    expect((await healthOf(U.HR)).records).toEqual([]);
  });
});
