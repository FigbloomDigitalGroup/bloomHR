// @vitest-environment node
//
// My team in the staff portal (20261018900000): my_team() lists the signed-in person's current reports with safe
// details only; a STAFF-role supervisor can assign and score their report's KPIs (custom_kpis, 20261016900000) but not a
// colleague's; someone who supervises nobody gets nothing; companies never see each other's people.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000d101';
const LEAD = '00000000-0000-0000-0000-00000000d102'; // STAFF role, supervises Mo and Rita
const MO = '00000000-0000-0000-0000-00000000d103';
const PAT = '00000000-0000-0000-0000-00000000d104'; // supervises nobody
const LEAD_B = '00000000-0000-0000-0000-00000000d105';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const as = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) =>
  asUser(db, user, () => rows<T>(sql, params));

let kpi: string;
let open: string;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  for (const [id, email, role, tenant] of [
    [HR, 'hr@a.co', 'HR', A], [LEAD, 'lead@a.co', 'STAFF', A], [MO, 'mo@a.co', 'STAFF', A], [PAT, 'pat@a.co', 'STAFF', A],
    [LEAD_B, 'lead@b.co', 'STAFF', B],
  ]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${tenant}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees', 'performance'], '${A}'), ('STAFF', array['dashboard'], '${A}'), ('STAFF', array['dashboard'], '${B}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Job Title", "Status", manager_email,
                           "Profile Image", "ID Number", "Basic Salary", "Account Number", tenant_id) values
      ('A-LEAD', 'Lena', 'Lead', 'lead@a.co', 'Team Lead', 'Active', 'lead@a.co', null, '20000001', 90000, 'ACC-L', '${A}'),
      ('A-MO', 'Mo', 'Report', 'mo@a.co', 'Sales Rep', 'Active', 'LEAD@a.co ', 'https://img/mo.png', '20000002', 50000, 'ACC-M', '${A}'),
      ('A-RITA', 'Rita', 'Report', 'rita@a.co', 'Sales Rep', 'Active', null, null, '20000003', 50000, 'ACC-R', '${A}'),
      ('A-GONE', 'Gus', 'Gone', 'gus@a.co', 'Sales Rep', 'Terminated', 'lead@a.co', null, '20000004', 50000, 'ACC-G', '${A}'),
      ('A-PAT', 'Pat', 'Peer', 'pat@a.co', 'Sales Rep', 'Active', 'hr@a.co', null, '20000005', 50000, 'ACC-P', '${A}'),
      ('B-LEAD', 'Bea', 'Lead', 'lead@b.co', 'Team Lead', 'Active', null, null, '20000006', 1, 'ACC-B', '${B}'),
      ('B-1', 'Bo', 'Other', 'bo@b.co', 'Sales Rep', 'Active', 'lead@a.co', null, '20000007', 1, 'ACC-B1', '${B}');
  `);
  // Rita reports to Lena through the org chart (reports_to_id) rather than manager_email
  const lead = (await rows<{ id: string }>(`select id from employees where "Employee Number" = 'A-LEAD'`))[0].id;
  await db.query(`update employees set reports_to_id = $1 where "Employee Number" = 'A-RITA'`, [lead]);
  const dept = (await as<{ id: string }>(HR, `insert into departments (name) values ('Sales') returning id`))[0].id;
  await db.query(`update employees set department_id = $1 where "Employee Number" = 'A-MO'`, [dept]);

  kpi = (await as<{ id: string }>(HR, `insert into kpis (name, unit, default_target, default_weight) values ('Calls made', 'number', 100, 50) returning id`))[0].id;
  open = (await as<{ id: string }>(HR, `insert into kpi_periods (name, starts_on, ends_on, status) values ('Q4 2026', '2026-10-01', '2026-12-31', 'open') returning id`))[0].id;
}, 120000);

describe('my_team()', () => {
  it('lists only the signed-in person’s current reports (not themselves, not leavers, not another company’s)', async () => {
    const team = await as<{ employee_number: string; department: string | null; photo: string | null; job_title: string }>(LEAD, `select * from my_team()`);
    expect(team.map((r) => r.employee_number)).toEqual(['A-MO', 'A-RITA']);
    const mo = team[0];
    expect(mo.department).toBe('Sales');
    expect(mo.photo).toBe('https://img/mo.png');
    expect(mo.job_title).toBe('Sales Rep');
  });

  it('returns safe columns only: no pay, ID, bank or contact details', async () => {
    const cols = (await as<Record<string, unknown>>(LEAD, `select * from my_team() limit 1`))[0];
    expect(Object.keys(cols).sort()).toEqual(
      ['department', 'department_id', 'employee_number', 'first_name', 'job_title', 'last_name', 'photo', 'status', 'worker_kind'].sort()
    );
  });

  it('someone who supervises nobody gets nothing', async () => {
    expect(await as(PAT, `select * from my_team()`)).toHaveLength(0);
    expect(await as(LEAD_B, `select * from my_team()`)).toHaveLength(0);
  });

  it('anonymous users cannot call it', async () => {
    expect(await fails(asAnon(db, () => rows(`select * from my_team()`)))).toMatch(/permission denied/);
  });
});

describe('a STAFF-role supervisor and their reports’ KPIs', () => {
  it('assigns a KPI to their report, not to a colleague', async () => {
    const n = await as<{ assign_kpi: number }>(LEAD, `select assign_kpi($1, $2, 'person', 'A-MO', 120, 60)`, [open, kpi]);
    expect(n[0].assign_kpi).toBe(1);
    const none = await as<{ assign_kpi: number }>(LEAD, `select assign_kpi($1, $2, 'person', 'A-PAT')`, [open, kpi]);
    expect(none[0].assign_kpi).toBe(0);
    expect(await fails(as(LEAD, `insert into kpi_assignments (period_id, kpi_id, employee_number) values ($1, $2, 'A-PAT')`, [open, kpi])))
      .toMatch(/row-level security/);
    // and nobody in the other company
    const other = await as<{ assign_kpi: number }>(LEAD, `select assign_kpi($1, $2, 'person', 'B-1')`, [open, kpi]);
    expect(other[0].assign_kpi).toBe(0);
  });

  it('sees and edits their report’s target and weight, not a colleague’s', async () => {
    await as(HR, `select assign_kpi($1, $2, 'person', 'A-PAT')`, [open, kpi]);
    const seen = await as<{ employee_number: string }>(LEAD, `select employee_number from kpi_assignments`);
    expect(seen.map((r) => r.employee_number)).toEqual(['A-MO']);
    expect(await as(LEAD, `update kpi_assignments set weight = 40 where employee_number = 'A-MO' returning 1`)).toHaveLength(1);
    expect(await as(LEAD, `update kpi_assignments set weight = 40 where employee_number = 'A-PAT' returning 1`)).toHaveLength(0);
  });

  it('enters their report’s final score, not a colleague’s', async () => {
    const mo = (await rows<{ id: string }>(`select id from kpi_assignments where employee_number = 'A-MO'`))[0].id;
    const pat = (await rows<{ id: string }>(`select id from kpi_assignments where employee_number = 'A-PAT'`))[0].id;
    await as(LEAD, `insert into kpi_checkins (assignment_id, kind, value, comment) values ($1, 'final', 110, 'Good quarter')`, [mo]);
    const [row] = await rows<{ actual_value: string; scored_by: string }>(`select actual_value, scored_by from kpi_assignments where id = $1`, [mo]);
    expect(Number(row.actual_value)).toBe(110);
    expect(row.scored_by).toBe(LEAD);
    expect(await fails(as(LEAD, `insert into kpi_checkins (assignment_id, kind, value) values ($1, 'final', 90)`, [pat])))
      .toMatch(/row-level security|manager or HR/);
    // a supervisor's own KPI: never their own final score
    await as(HR, `select assign_kpi($1, $2, 'person', 'A-LEAD')`, [open, kpi]);
    const own = (await rows<{ id: string }>(`select id from kpi_assignments where employee_number = 'A-LEAD'`))[0].id;
    expect(await fails(as(LEAD, `insert into kpi_checkins (assignment_id, kind, value) values ($1, 'final', 100)`, [own])))
      .toMatch(/own final score/);
  });

  it('someone who supervises nobody cannot assign or score', async () => {
    expect(await fails(as(PAT, `select assign_kpi($1, $2, 'person', 'A-MO')`, [open, kpi]))).toMatch(/Only HR or a manager/);
    const mo = (await rows<{ id: string }>(`select id from kpi_assignments where employee_number = 'A-MO'`))[0].id;
    expect(await fails(as(PAT, `insert into kpi_checkins (assignment_id, kind, value) values ($1, 'final', 1)`, [mo])))
      .toMatch(/row-level security|manager or HR/);
  });
});

describe('a STAFF-role supervisor’s overtime and casual lists', () => {
  it('overtime_people gives them their team only; a non-supervisor nobody', async () => {
    const people = await as<{ employee_number: string }>(LEAD, `select employee_number from overtime_people() order by 1`);
    expect(people.map((r) => r.employee_number)).toEqual(expect.arrayContaining(['A-MO', 'A-RITA']));
    expect(people.map((r) => r.employee_number)).not.toContain('A-PAT');
    expect(await as(PAT, `select * from overtime_people()`)).toHaveLength(0);
  });

  it('casual_workers gives them no casuals when they supervise none', async () => {
    expect(await as(LEAD, `select * from casual_workers()`)).toHaveLength(0);
  });
});
