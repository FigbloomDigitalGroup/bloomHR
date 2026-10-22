// @vitest-environment node
//
// KPIs calculated from attendance (20261023500000): attendance rate, punctuality, absent days and average hours, from
// attendance_days_for over the open period up to today; days off, holidays, leave and days before attendance counted
// are left out; the measure fixes the unit and direction; task measures keep working.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const HR = '00000000-0000-0000-0000-00000000f101';
// today is Friday 23 October 2026: Monday to Thursday are counted
const TODAY = '2026-10-23';

let db: PGlite;
let period: string;
const kpi: Record<string, string> = {};
const assignment: Record<string, string> = {};
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) =>
  asUser(db, user, () => rows<T>(sql, params));
const punch = (emp: string, kind: 'in' | 'out', at: string) =>
  rows(`select public.attendance_punch($1, $2, $3, null, $4)`, [A, emp, kind, at]);
const refresh = async () => (await rows<{ n: number }>(`select public.kpi_refresh_measures(null, $1) as n`, [TODAY]))[0].n;
const auto = async (measure: string, emp = 'A-ME') =>
  (await rows<{ auto_value: string | null; auto_detail: Record<string, number> | null }>(
    `select auto_value, auto_detail from kpi_assignments where id = $1`, [assignment[`${measure}:${emp}`]]))[0];

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${HR}', 'hr@a.co', 'HR', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values ('HR', array['employees', 'kpi-admin'], '${A}');
    insert into employees ("Employee Number", "First Name", "Work Email", "Status", "Start Date", tenant_id) values
      ('A-ME', 'Mo', 'me@a.co', 'Active', '2025-01-06', '${A}'),
      ('A-OFF', 'Ola', 'off@a.co', 'Active', '2025-01-06', '${A}');
    insert into attendance_settings (tenant_id, tracking_from) values ('${A}', '2026-10-19')
      on conflict (tenant_id) do update set tracking_from = excluded.tracking_from;
    delete from holidays;
    select seed_default_leave_types('${A}');
    -- Ola is on approved leave all week
    insert into leave_application ("Employee Number", name, "Leave Type", "Start Date", "End Date", status, tenant_id) values
      ('A-OFF', 'Ola', 'Annual Leave', '2026-10-19', '2026-10-23', 'Approved', '${A}');
  `);
  // Mo: Monday on time (07:55-16:55, 9 h), Tuesday late (08:40-17:10, 8.5 h), Wednesday absent, Thursday on time (no
  // clock-out yet); Friday is today
  await punch('A-ME', 'in', '2026-10-19T04:55:00Z');
  await punch('A-ME', 'out', '2026-10-19T13:55:00Z');
  await punch('A-ME', 'in', '2026-10-20T05:40:00Z');
  await punch('A-ME', 'out', '2026-10-20T14:10:00Z');
  await punch('A-ME', 'in', '2026-10-22T05:00:00Z');

  period = (await as<{ id: string }>(HR, `insert into kpi_periods (name, starts_on, ends_on, status) values ('Q4 2026', '2026-10-01', '2026-12-31', 'open') returning id`))[0].id;
  for (const m of ['attendance_rate', 'punctuality', 'absent_days', 'avg_hours', 'tasks_completed']) {
    kpi[m] = (await as<{ id: string }>(HR, `insert into kpis (name, unit, direction, measure, default_target) values ($1, 'currency_ksh', 'lower_is_better', $2, 5) returning id`, [m, m]))[0].id;
    for (const emp of ['A-ME', 'A-OFF']) {
      assignment[`${m}:${emp}`] = (await as<{ id: string }>(HR, `insert into kpi_assignments (period_id, kpi_id, employee_number, weight) values ($1, $2, $3, 20) returning id`, [period, kpi[m], emp]))[0].id;
    }
  }
}, 120000);

describe('attendance measures', () => {
  it('fix the unit and direction', async () => {
    const got = await rows<{ measure: string; unit: string; direction: string }>(
      `select measure, unit, direction from kpis where measure <> 'tasks_completed' order by measure`);
    expect(got).toEqual([
      { measure: 'absent_days', unit: 'number', direction: 'lower_is_better' },
      { measure: 'attendance_rate', unit: 'percent', direction: 'higher_is_better' },
      { measure: 'avg_hours', unit: 'number', direction: 'higher_is_better' },
      { measure: 'punctuality', unit: 'percent', direction: 'higher_is_better' },
    ]);
  });

  it('are worked out from the days up to today', async () => {
    expect(await refresh()).toBeGreaterThan(0);
    // expected Monday to Thursday (4); present Monday, Tuesday, Thursday (3); on time Monday and Thursday
    expect(await auto('attendance_rate')).toEqual({ auto_value: '75.00', auto_detail: { present: 3, expected: 4 } });
    expect(await auto('punctuality')).toEqual({ auto_value: '66.70', auto_detail: { on_time: 2, present: 3 } });
    expect(await auto('absent_days')).toEqual({ auto_value: '1.00', auto_detail: { absent: 1, expected: 4 } });
    // 9 and 8.5 hours (Thursday has no clock-out yet)
    expect(await auto('avg_hours')).toEqual({ auto_value: '8.80', auto_detail: { days: 2 } });
    // task measures still work alongside
    expect(await auto('tasks_completed')).toEqual({ auto_value: '0.00', auto_detail: { done: 0 } });
  });

  it('leave all week: nothing expected, so nothing to score (not 0%)', async () => {
    expect(await auto('attendance_rate', 'A-OFF')).toEqual({ auto_value: null, auto_detail: { present: 0, expected: 0 } });
    expect(await auto('absent_days', 'A-OFF')).toEqual({ auto_value: null, auto_detail: { absent: 0, expected: 0 } });
    expect(await auto('punctuality', 'A-OFF')).toEqual({ auto_value: null, auto_detail: { on_time: 0, present: 0 } });
  });

  it('days before attendance counted are left out', async () => {
    await db.query(`update attendance_settings set tracking_from = '2026-10-22' where tenant_id = $1`, [A]);
    try {
      await refresh();
      // only Thursday counts: Monday to Wednesday don't, clocked in or not (20261023800000), so Tuesday's late day
      // drops out of punctuality too
      expect(await auto('attendance_rate')).toEqual({ auto_value: '100.00', auto_detail: { present: 1, expected: 1 } });
      expect(await auto('punctuality')).toEqual({ auto_value: '100.00', auto_detail: { on_time: 1, present: 1 } });
      expect((await auto('absent_days')).auto_value).toBe('0.00');
    } finally {
      await db.query(`update attendance_settings set tracking_from = '2026-10-19' where tenant_id = $1`, [A]);
    }
  });

  it('a clock-in recorded later updates the value on the next run', async () => {
    await rows(`select public.attendance_punch($1, 'A-ME', 'in', null, '2026-10-21T05:10:00Z')`, [A]);
    await refresh();
    expect(await auto('attendance_rate')).toEqual({ auto_value: '100.00', auto_detail: { present: 4, expected: 4 } });
    expect(await auto('punctuality')).toEqual({ auto_value: '75.00', auto_detail: { on_time: 3, present: 4 } });
  });
});
