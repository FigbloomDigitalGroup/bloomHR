// @vitest-environment node
//
// Custom KPIs (20261016900000): each company's KPI library, review periods, assignments and check-ins; companies never
// see each other's; HR manages everything; a manager sees and scores their direct reports only; staff see their own
// KPIs (not while the period is a draft) and add self-assessments, never final scores.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const ADMIN = '00000000-0000-0000-0000-00000000c101';
const HR = '00000000-0000-0000-0000-00000000c102';
const BOSS = '00000000-0000-0000-0000-00000000c103';
const ME = '00000000-0000-0000-0000-00000000c104';
const PEER = '00000000-0000-0000-0000-00000000c105';
const ADMIN_B = '00000000-0000-0000-0000-00000000c106';

let db: PGlite;
let deptOps: string;
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
const assignmentOf = async (period: string, emp: string) =>
  (await rows<{ id: string }>(`select id from kpi_assignments where period_id = $1 and employee_number = $2`, [period, emp]))[0].id;

let kpiSales: string;
let kpiErrors: string;
let open: string;
let draft: string;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  for (const [id, email, role, tenant] of [
    [ADMIN, 'admin@a.co', 'ADMIN', A], [HR, 'hr@a.co', 'HR', A], [BOSS, 'boss@a.co', 'MANAGER', A],
    [ME, 'me@a.co', 'STAFF', A], [PEER, 'peer@a.co', 'STAFF', A], [ADMIN_B, 'admin@b.co', 'ADMIN', B],
  ]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${tenant}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees', 'kpi-admin'], '${A}'), ('MANAGER', array['performance', 'employees'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Job Title", "Status", tenant_id) values
      ('A-BOSS', 'Bea', 'Boss', 'boss@a.co', 'Sales Manager', 'Active', '${A}'),
      ('A-ME', 'Mo', 'Me', 'me@a.co', 'Sales Rep', 'Active', '${A}'),
      ('A-PEER', 'Pat', 'Peer', 'peer@a.co', 'Sales Rep', 'Active', '${A}'),
      ('A-OUT', 'Old', 'Leaver', 'out@a.co', 'Sales Rep', 'Terminated', '${A}'),
      ('A-HR', 'Hana', 'HR', 'hr@a.co', 'HR Officer', 'Active', '${A}'),
      ('B-1', 'Bo', 'Other', 'bo@b.co', 'Sales Rep', 'Active', '${B}');
  `);
  const boss = (await rows<{ id: string }>(`select id from employees where "Employee Number" = 'A-BOSS'`))[0].id;
  // Mo reports to Bea; Pat does not
  await db.query(`update employees set reports_to_id = $1 where "Employee Number" = 'A-ME'`, [boss]);
  deptOps = (await as<{ id: string }>(HR, `insert into departments (name) values ('Sales') returning id`))[0]?.id
    ?? (await as<{ id: string }>(ADMIN, `insert into departments (name) values ('Sales') returning id`))[0].id;
  await db.query(`update employees set department_id = $1 where "Employee Number" in ('A-ME', 'A-PEER')`, [deptOps]);

  kpiSales = (await as<{ id: string }>(HR, `insert into kpis (name, unit, default_target, default_weight, category)
    values ('  Sales revenue ', 'currency_ksh', 1000000, 60, 'Financial') returning id`))[0].id;
  kpiErrors = (await as<{ id: string }>(HR, `insert into kpis (name, unit, direction, default_target, default_weight)
    values ('Error rate', 'percent', 'lower_is_better', 2, 40) returning id`))[0].id;
  open = (await as<{ id: string }>(HR, `insert into kpi_periods (name, starts_on, ends_on, status) values ('Q4 2026', '2026-10-01', '2026-12-31', 'open') returning id`))[0].id;
  draft = (await as<{ id: string }>(HR, `insert into kpi_periods (name, starts_on, ends_on) values ('Q1 2027', '2027-01-01', '2027-03-31') returning id`))[0].id;
}, 120000);

describe('the KPI library and review periods', () => {
  it('HR adds KPIs; names are trimmed and used once per company', async () => {
    expect((await rows<{ name: string }>(`select name from kpis where id = $1`, [kpiSales]))[0].name).toBe('Sales revenue');
    expect(await fails(as(HR, `insert into kpis (name) values ('SALES REVENUE')`))).toMatch(/duplicate|unique/);
    await as(ADMIN_B, `insert into kpis (name) values ('Sales revenue')`);
  });

  it('checks the unit, direction and weight', async () => {
    expect(await fails(as(HR, `insert into kpis (name, unit) values ('Bad', 'stars')`))).toMatch(/check/);
    expect(await fails(as(HR, `insert into kpis (name, default_weight) values ('Heavy', 120)`))).toMatch(/check/);
    expect(await fails(as(HR, `insert into kpi_periods (name, starts_on, ends_on) values ('Back', '2026-12-01', '2026-01-01')`))).toMatch(/check/);
  });

  it('everyone in the company reads them; staff and managers do not change them', async () => {
    expect((await as(ME, `select name from kpis`)).length).toBe(2);
    expect(await fails(as(ME, `insert into kpis (name) values ('Mine')`))).toMatch(/row-level security/);
    expect(await fails(as(BOSS, `insert into kpis (name) values ('Boss made')`))).toMatch(/row-level security/);
    expect(await as(BOSS, `update kpi_periods set status = 'closed' returning 1`)).toHaveLength(0);
  });

  it('a KPI in use cannot be deleted (archive it instead)', async () => {
    const used = (await as<{ id: string }>(HR, `insert into kpis (name) values ('Used') returning id`))[0].id;
    await as(HR, `select assign_kpi($1, $2, 'person', 'A-PEER')`, [draft, used]);
    expect(await fails(as(HR, `delete from kpis where id = $1`, [used]))).toMatch(/foreign key/);
    await as(HR, `update kpis set archived = true where id = $1`, [used]);
  });
});

describe('assigning KPIs', () => {
  it('to a department: every current employee in it, with the KPI defaults unless overridden', async () => {
    const n = await as<{ assign_kpi: number }>(HR, `select assign_kpi($1, $2, 'department', $3)`, [open, kpiSales, deptOps]);
    expect(n[0].assign_kpi).toBe(2);
    const got = await rows<{ employee_number: string; target: string; weight: string; assigned_via: string; assigned_by: string }>(
      `select employee_number, target, weight, assigned_via, assigned_by from kpi_assignments where period_id = $1 and kpi_id = $2 order by 1`, [open, kpiSales]);
    expect(got.map((r) => r.employee_number)).toEqual(['A-ME', 'A-PEER']);
    expect(Number(got[0].target)).toBe(1000000);
    expect(Number(got[0].weight)).toBe(60);
    expect(got[0].assigned_via).toBe('department');
    expect(got[0].assigned_by).toBe(HR);
  });

  it('to a job title (ignoring case), skipping leavers; again updates the target and weight', async () => {
    const n = await as<{ assign_kpi: number }>(HR, `select assign_kpi($1, $2, 'job_title', 'sales rep', 3, 40)`, [open, kpiErrors]);
    expect(n[0].assign_kpi).toBe(2);
    expect(await rows(`select 1 from kpi_assignments where employee_number = 'A-OUT'`)).toHaveLength(0);
    await as(HR, `select assign_kpi($1, $2, 'person', 'A-ME', 2.5, 40)`, [open, kpiErrors]);
    const [row] = await rows<{ target: string }>(`select target from kpi_assignments where period_id = $1 and kpi_id = $2 and employee_number = 'A-ME'`, [open, kpiErrors]);
    expect(Number(row.target)).toBe(2.5);
  });

  it('a manager assigns to their own reports only; staff not at all', async () => {
    const extra = (await as<{ id: string }>(HR, `insert into kpis (name, unit) values ('Calls made', 'number') returning id`))[0].id;
    const n = await as<{ assign_kpi: number }>(BOSS, `select assign_kpi($1, $2, 'job_title', 'Sales Rep', 50, 0)`, [open, extra]);
    expect(n[0].assign_kpi).toBe(1); // Mo, not Pat
    expect(await fails(as(BOSS, `insert into kpi_assignments (period_id, kpi_id, employee_number) values ($1, $2, 'A-PEER')`, [open, extra]))).toMatch(/row-level security/);
    expect(await fails(as(ME, `select assign_kpi($1, $2, 'person', 'A-ME')`, [open, extra]))).toMatch(/Only HR or a manager/);
    expect(await fails(as(ME, `insert into kpi_assignments (period_id, kpi_id, employee_number) values ($1, $2, 'A-ME')`, [open, extra]))).toMatch(/row-level security/);
    await as(HR, `delete from kpi_assignments where kpi_id = $1`, [extra]);
  });

  it('another company’s KPI or period is refused', async () => {
    const theirs = (await rows<{ id: string }>(`select id from kpis where tenant_id = '${B}'`))[0].id;
    expect(await fails(as(HR, `select assign_kpi($1, $2, 'person', 'A-ME')`, [open, theirs]))).toMatch(/Unknown KPI/);
    expect(await fails(as(ADMIN_B, `select assign_kpi($1, $2, 'person', 'B-1')`, [open, theirs]))).toMatch(/Unknown review period/);
  });
});

describe('who sees which KPIs', () => {
  it('HR sees everyone’s; a manager their reports’; staff only their own, and not in a draft period', async () => {
    await as(HR, `select assign_kpi($1, $2, 'person', 'A-ME')`, [draft, kpiSales]);
    const hr = await as<{ employee_number: string }>(HR, `select distinct employee_number from kpi_assignments order by 1`);
    expect(hr.map((r) => r.employee_number)).toEqual(['A-ME', 'A-PEER']);
    const boss = await as<{ employee_number: string }>(BOSS, `select distinct employee_number from kpi_assignments`);
    expect(boss.map((r) => r.employee_number)).toEqual(['A-ME']);
    const me = await as<{ employee_number: string; period_id: string }>(ME, `select employee_number, period_id from kpi_assignments`);
    expect(me.every((r) => r.employee_number === 'A-ME' && r.period_id === open)).toBe(true);
    expect(me).toHaveLength(2);
  });

  it('staff cannot change their own target or weight', async () => {
    expect(await as(ME, `update kpi_assignments set weight = 100 returning 1`)).toHaveLength(0);
  });

  it('each company sees only its own; anonymous users nothing', async () => {
    for (const t of ['kpis', 'kpi_periods', 'kpi_assignments', 'kpi_checkins']) {
      const seen = await as<{ tenant_id: string }>(ADMIN_B, `select tenant_id from ${t}`);
      expect(seen.every((r) => r.tenant_id === B)).toBe(true);
      expect(await as(ADMIN_B, `delete from ${t} where tenant_id = '${A}' returning 1`)).toHaveLength(0);
      expect(await fails(asAnon(db, () => rows(`select 1 from ${t}`)))).toMatch(/permission denied/);
    }
  });
});

describe('check-ins', () => {
  it('the employee adds a self-assessment; it shows on the assignment; the final score stays empty', async () => {
    const id = await assignmentOf(open, 'A-ME').then(async () =>
      (await rows<{ id: string }>(`select id from kpi_assignments where period_id = $1 and kpi_id = $2 and employee_number = 'A-ME'`, [open, kpiSales]))[0].id);
    await as(ME, `insert into kpi_checkins (assignment_id, kind, value, comment) values ($1, 'self', 900000, ' Close ')`, [id]);
    const [a] = await rows<{ self_value: string; self_comment: string; self_by: string; actual_value: string | null }>(
      `select self_value, self_comment, self_by, actual_value from kpi_assignments where id = $1`, [id]);
    expect(Number(a.self_value)).toBe(900000);
    expect(a.self_comment).toBe('Close');
    expect(a.self_by).toBe(ME);
    expect(a.actual_value).toBeNull();
  });

  it('staff cannot give themselves the final score, nor self-assess someone else', async () => {
    const mine = (await rows<{ id: string }>(`select id from kpi_assignments where period_id = $1 and kpi_id = $2 and employee_number = 'A-ME'`, [open, kpiSales]))[0].id;
    const peers = (await rows<{ id: string }>(`select id from kpi_assignments where period_id = $1 and kpi_id = $2 and employee_number = 'A-PEER'`, [open, kpiSales]))[0].id;
    expect(await fails(as(ME, `insert into kpi_checkins (assignment_id, kind, value) values ($1, 'final', 2000000)`, [mine]))).toMatch(/manager or HR/);
    // Pat's assignment is not visible to Mo, so the insert is refused
    expect(await fails(as(ME, `insert into kpi_checkins (assignment_id, kind, value) values ($1, 'self', 1)`, [peers]))).toMatch(/row-level security|own self-assessment/);
  });

  it('the manager enters the final score for a report; not for someone else’s', async () => {
    const mine = (await rows<{ id: string }>(`select id from kpi_assignments where period_id = $1 and kpi_id = $2 and employee_number = 'A-ME'`, [open, kpiSales]))[0].id;
    const peers = (await rows<{ id: string }>(`select id from kpi_assignments where period_id = $1 and kpi_id = $2 and employee_number = 'A-PEER'`, [open, kpiSales]))[0].id;
    await as(BOSS, `insert into kpi_checkins (assignment_id, kind, value, comment) values ($1, 'final', 950000, 'Good quarter')`, [mine]);
    const [a] = await rows<{ actual_value: string; scored_by: string; manager_comment: string }>(
      `select actual_value, scored_by, manager_comment from kpi_assignments where id = $1`, [mine]);
    expect(Number(a.actual_value)).toBe(950000);
    expect(a.scored_by).toBe(BOSS);
    expect(await fails(as(BOSS, `insert into kpi_checkins (assignment_id, kind, value) values ($1, 'final', 1)`, [peers]))).toMatch(/row-level security|manager or HR/);
    // HR may score anyone
    await as(HR, `insert into kpi_checkins (assignment_id, kind, value) values ($1, 'final', 1100000)`, [peers]);
  });

  it('nobody writes the scores straight onto the assignment', async () => {
    const mine = (await rows<{ id: string }>(`select id from kpi_assignments where period_id = $1 and kpi_id = $2 and employee_number = 'A-ME'`, [open, kpiSales]))[0].id;
    await as(HR, `update kpi_assignments set actual_value = 1, self_value = 1, weight = 55 where id = $1`, [mine]);
    const [a] = await rows<{ actual_value: string; self_value: string; weight: string }>(`select actual_value, self_value, weight from kpi_assignments where id = $1`, [mine]);
    expect(Number(a.actual_value)).toBe(950000);
    expect(Number(a.self_value)).toBe(900000);
    expect(Number(a.weight)).toBe(55);
  });

  it('values must suit the unit', async () => {
    const yn = (await as<{ id: string }>(HR, `insert into kpis (name, unit) values ('Certified', 'yes_no') returning id`))[0].id;
    const rating = (await as<{ id: string }>(HR, `insert into kpis (name, unit) values ('Teamwork', 'rating_1_5') returning id`))[0].id;
    await as(HR, `select assign_kpi($1, $2, 'person', 'A-ME'), assign_kpi($1, $3, 'person', 'A-ME')`, [open, yn, rating]);
    const ynId = (await rows<{ id: string }>(`select id from kpi_assignments where kpi_id = $1`, [yn]))[0].id;
    const rId = (await rows<{ id: string }>(`select id from kpi_assignments where kpi_id = $1`, [rating]))[0].id;
    expect(await fails(as(ME, `insert into kpi_checkins (assignment_id, kind, value) values ($1, 'self', 2)`, [ynId]))).toMatch(/yes\/no/);
    expect(await fails(as(ME, `insert into kpi_checkins (assignment_id, kind, value) values ($1, 'self', 6)`, [rId]))).toMatch(/1 to 5/);
    await as(ME, `insert into kpi_checkins (assignment_id, kind, value) values ($1, 'self', 1), ($2, 'self', 4)`, [ynId, rId]);
  });

  it('check-ins are kept: not changed or deleted', async () => {
    expect(await as(HR, `update kpi_checkins set value = 0 returning 1`)).toHaveLength(0);
    expect(await as(HR, `delete from kpi_checkins returning 1`)).toHaveLength(0);
    expect(Number((await rows<{ n: string }>(`select count(*) n from kpi_checkins`))[0].n)).toBeGreaterThan(0);
  });

  it('nothing is added or changed once the period is closed', async () => {
    const mine = (await rows<{ id: string }>(`select id from kpi_assignments where period_id = $1 and kpi_id = $2 and employee_number = 'A-ME'`, [open, kpiSales]))[0].id;
    await as(HR, `update kpi_periods set status = 'closed' where id = $1`, [open]);
    expect(await fails(as(ME, `insert into kpi_checkins (assignment_id, kind, value) values ($1, 'self', 1)`, [mine]))).toMatch(/period is open/);
    expect(await fails(as(HR, `update kpi_assignments set weight = 10 where id = $1`, [mine]))).toMatch(/closed/);
    expect(await fails(as(HR, `select assign_kpi($1, $2, 'person', 'A-PEER')`, [open, kpiErrors]))).toMatch(/closed/);
    // reopened, it can change again; and removing an assignment takes its check-ins with it
    await as(HR, `update kpi_periods set status = 'open' where id = $1`, [open]);
    await as(HR, `delete from kpi_assignments where id = $1`, [mine]);
    expect(await rows(`select 1 from kpi_checkins where assignment_id = $1`, [mine])).toHaveLength(0);
  });

  it('kpi_my_access tells the page who is asking', async () => {
    const [{ kpi_my_access: boss }] = await as<{ kpi_my_access: { manages: boolean; team: string[] } }>(BOSS, `select kpi_my_access()`);
    expect(boss).toEqual({ manages: false, employee_number: 'A-BOSS', team: ['A-ME'] });
    const [{ kpi_my_access: hr }] = await as<{ kpi_my_access: { manages: boolean } }>(HR, `select kpi_my_access()`);
    expect(hr.manages).toBe(true);
  });
});
