// @vitest-environment node
//
// KPIs calculated from tasks (20261023200000): a KPI's measure fixes its unit and direction; kpi_refresh_measures works
// out on-time %, tasks completed, late tasks and median days per employee for open periods only; the calculated
// values are the system's (nobody types them); only HR or a manager may ask for a recalculation, in their own company.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000d101';
const STAFF = '00000000-0000-0000-0000-00000000d102';
const ADMIN_B = '00000000-0000-0000-0000-00000000d103';
const TODAY = '2026-10-21';

let db: PGlite;
let period: string;
let project: string;
const kpi: Record<string, string> = {};
const assignment: Record<string, string> = {};
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
const refresh = async () => (await rows<{ n: number }>(`select public.kpi_refresh_measures(null, $1) as n`, [TODAY]))[0].n;
const auto = async (measure: string) =>
  (await rows<{ auto_value: string | null; auto_detail: Record<string, number> | null }>(
    `select auto_value, auto_detail from kpi_assignments where id = $1`, [assignment[measure]]))[0];

const task = (fields: { title: string; status?: string; due?: string | null; created?: string; done?: string; group?: boolean; who?: string }) =>
  db.query(
    `insert into tasks (tenant_id, project_id, title, status, assignee_number, due_date, created_at, completed_at, is_group)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [A, project, fields.title, fields.status ?? 'todo', fields.who ?? 'A-ME', fields.due ?? null,
      fields.created ?? '2026-10-01T06:00:00Z', fields.done ?? null, fields.group ?? false]
  );

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  for (const [id, email, role, tenant] of [
    [HR, 'hr@a.co', 'HR', A], [STAFF, 'me@a.co', 'STAFF', A], [ADMIN_B, 'admin@b.co', 'ADMIN', B],
  ]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${tenant}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees', 'kpi-admin'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Status", tenant_id) values
      ('A-ME', 'Mo', 'Me', 'me@a.co', 'Active', '${A}'),
      ('A-HR', 'Hana', 'HR', 'hr@a.co', 'Active', '${A}');
  `);
  project = (await rows<{ id: string }>(`insert into task_projects (tenant_id, key, name) values ($1, 'OPS', 'Operations') returning id`, [A]))[0].id;

  // the week's work (today is 21 Oct)
  await task({ title: 'early', status: 'done', due: '2026-10-05', created: '2026-10-01T06:00:00Z', done: '2026-10-04T06:00:00Z' });
  await task({ title: 'done late', status: 'done', due: '2026-10-06', created: '2026-10-01T06:00:00Z', done: '2026-10-08T06:00:00Z' });
  await task({ title: 'overdue', due: '2026-10-10' });
  await task({ title: 'due today', due: TODAY });
  await task({ title: 'done ahead', status: 'done', due: '2026-11-15', created: '2026-10-13T06:00:00Z', done: '2026-10-15T06:00:00Z' });
  await task({ title: 'cancelled', status: 'cancelled', due: '2026-10-07' });
  await task({ title: 'team task', due: '2026-10-05', group: true });
  await task({ title: 'last quarter', status: 'done', due: '2026-09-20', created: '2026-09-30T06:00:00Z', done: '2026-10-02T06:00:00Z' });
  // finished at 23:30 Nairobi on its due date (20:30 UTC): on time
  await task({ title: 'late evening', status: 'done', due: '2026-10-12', created: '2026-10-12T05:00:00Z', done: '2026-10-12T20:30:00Z', who: 'A-HR' });

  period = (await as<{ id: string }>(HR, `insert into kpi_periods (name, starts_on, ends_on, status) values ('Q4 2026', '2026-10-01', '2026-12-31', 'open') returning id`))[0].id;
  for (const m of ['tasks_on_time', 'tasks_completed', 'tasks_late', 'task_days']) {
    // the unit and direction given here are replaced by the measure's
    kpi[m] = (await as<{ id: string }>(HR, `insert into kpis (name, unit, direction, measure, default_target) values ($1, 'currency_ksh', 'higher_is_better', $2, 5) returning id`, [m, m]))[0].id;
    assignment[m] = (await as<{ id: string }>(HR, `insert into kpi_assignments (period_id, kpi_id, employee_number, weight, auto_value) values ($1, $2, 'A-ME', 25, 999) returning id`, [period, kpi[m]]))[0].id;
  }
}, 120000);

describe('a calculated KPI', () => {
  it('takes its unit and direction from its measure', async () => {
    const got = await rows<{ measure: string; unit: string; direction: string }>(`select measure, unit, direction from kpis order by measure`);
    expect(got).toEqual([
      { measure: 'task_days', unit: 'number', direction: 'lower_is_better' },
      { measure: 'tasks_completed', unit: 'number', direction: 'higher_is_better' },
      { measure: 'tasks_late', unit: 'number', direction: 'lower_is_better' },
      { measure: 'tasks_on_time', unit: 'percent', direction: 'higher_is_better' },
    ]);
    expect(await fails(as(HR, `insert into kpis (name, measure) values ('Bad', 'magic')`))).toMatch(/kpis_measure_check/);
  });

  it('starts without a calculated value, whatever is sent', async () => {
    expect((await auto('tasks_on_time')).auto_value).toBeNull();
  });
});

describe('kpi_refresh_measures', () => {
  it('works out each measure from the employee’s tasks', async () => {
    expect(await refresh()).toBe(4);
    // due so far: early, done late, overdue, done ahead (not due today, cancelled, the team task or last quarter's)
    expect(await auto('tasks_on_time')).toEqual({ auto_value: '50.00', auto_detail: { on_time: 2, due: 4 } });
    expect(await auto('tasks_late')).toEqual({ auto_value: '2.00', auto_detail: { late: 2, due: 4 } });
    // finished this period: early, done late, done ahead, last quarter's
    expect(await auto('tasks_completed')).toEqual({ auto_value: '4.00', auto_detail: { done: 4 } });
    // 3, 7, 2 and 2 days: the median is 2.5
    expect(await auto('task_days')).toEqual({ auto_value: '2.50', auto_detail: { done: 4 } });
  });

  it('changes nothing when nothing changed', async () => {
    expect(await refresh()).toBe(0);
  });

  it('counts days in Nairobi time', async () => {
    const a = (await as<{ id: string }>(HR, `insert into kpi_assignments (period_id, kpi_id, employee_number, weight) values ($1, $2, 'A-HR', 100) returning id`, [period, kpi.tasks_on_time]))[0].id;
    await refresh();
    expect((await rows(`select auto_value from kpi_assignments where id = $1`, [a]))[0].auto_value).toBe('100.00');
  });

  it('a person can’t type a calculated value', async () => {
    await as(HR, `update kpi_assignments set auto_value = 99, weight = 30 where id = $1`, [assignment.tasks_on_time]);
    const got = (await rows<{ auto_value: string; weight: string }>(`select auto_value, weight from kpi_assignments where id = $1`, [assignment.tasks_on_time]))[0];
    expect(got).toEqual({ auto_value: '50.00', weight: '30.00' });
  });

  it('leaves a closed period as it was', async () => {
    await as(HR, `update kpi_periods set status = 'closed' where id = $1`, [period]);
    await task({ title: 'late finish', status: 'done', due: '2026-10-09', done: '2026-10-20T06:00:00Z' });
    expect(await refresh()).toBe(0);
    await as(HR, `update kpi_periods set status = 'open' where id = $1`, [period]);
    expect(await refresh()).toBe(4);
    expect((await auto('tasks_on_time')).auto_detail).toEqual({ on_time: 2, due: 5 });
  });

  it('clears the value of a KPI switched back to manual', async () => {
    await as(HR, `update kpis set measure = 'manual' where id = $1`, [kpi.task_days]);
    await refresh();
    expect(await auto('task_days')).toEqual({ auto_value: null, auto_detail: null });
  });

  it('is for HR and managers, in their own company', async () => {
    expect(await fails(as(STAFF, `select public.kpi_refresh_measures()`))).toMatch(/Only HR or a manager/);
    expect(await fails(as(ADMIN_B, `select public.kpi_refresh_measures($1)`, [period]))).toMatch(/Unknown review period/);
    expect((await as<{ n: number }>(ADMIN_B, `select public.kpi_refresh_measures() as n`))[0].n).toBe(0);
    expect(await fails(as(HR, `select public.kpi_refresh_measures($1)`, [period]))).toBe('');
    expect(await fails(as(HR, `select public.kpi_task_measure($1, 'A-ME', 'tasks_late', '2026-10-01', '2026-12-31', '2026-10-21')`, [A])))
      .toMatch(/permission denied/);
  });
});
