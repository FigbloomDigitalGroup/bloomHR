// @vitest-environment node
//
// A half day of approved leave (20261124300000): the day is still 'leave' (counts, KPIs and My HR unchanged), with
// half_day true, whether or not the person came in; a full day of leave (or one with no type) is not a half day; the portal card's day says half_day too.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
// Mon 16 - Fri 20 November 2026; "today" is Friday 20th
const TODAY = '2026-11-20';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

interface Day { day: string; status: string | null; half_day: boolean | null; late_minutes: number | null }
const days = async (emp: string) =>
  Object.fromEntries((await rows<Day>(
    `select to_char(day, 'YYYY-MM-DD') as day, status, half_day, late_minutes
     from public.attendance_days_for($1, '2026-11-16', '2026-11-20', $2, $3)`, [A, emp, TODAY])).map((d) => [d.day.slice(8), d]));

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into attendance_settings (tenant_id, tracking_from) values ('${A}', '2025-01-01')
      on conflict (tenant_id) do update set tracking_from = excluded.tracking_from;
    insert into employees ("Employee Number", "First Name", "Last Name", "Status", tenant_id) values
      ('A-HALF', 'Hassan', 'F', 'Active', '${A}');
    insert into leave_application ("Employee Number", name, "Leave Type", "Start Date", "End Date", status, type, tenant_id) values
      -- Monday: a half day, came in at 11:13
      ('A-HALF', 'Hassan', 'Annual Leave', '2026-11-16', '2026-11-16', 'Approved', 'Half Day', '${A}'),
      -- Tuesday: a half day, never came in
      ('A-HALF', 'Hassan', 'Annual Leave', '2026-11-17', '2026-11-17', 'Approved', 'Half Day', '${A}'),
      -- Wednesday: a full day
      ('A-HALF', 'Hassan', 'Annual Leave', '2026-11-18', '2026-11-18', 'Approved', 'Full Day', '${A}'),
      -- Thursday: leave with no type recorded is a full day
      ('A-HALF', 'Hassan', 'Sick Leave', '2026-11-19', '2026-11-19', 'Approved', null, '${A}'),
      -- Friday: a half day still pending doesn't count
      ('A-HALF', 'Hassan', 'Annual Leave', '2026-11-20', '2026-11-20', 'pending', 'Half Day', '${A}');
  `);
  await rows(`select public.attendance_punch($1, 'A-HALF', 'in', null, '2026-11-16T08:13:00Z')`, [A]);
});

describe('half-day leave', () => {
  it('is leave and a half day, came in or not, and not late', async () => {
    const d = await days('A-HALF');
    expect(d['16']).toMatchObject({ status: 'leave', half_day: true, late_minutes: 0 });
    expect(d['17']).toMatchObject({ status: 'leave', half_day: true });
  });
  it('a full day of leave, or leave with no type, is not a half day', async () => {
    const d = await days('A-HALF');
    expect(d['18']).toMatchObject({ status: 'leave', half_day: false });
    expect(d['19']).toMatchObject({ status: 'leave', half_day: false });
  });
  it('pending half-day leave changes nothing', async () => {
    expect((await days('A-HALF'))['20']).toMatchObject({ status: null, half_day: false });
  });
  it('the portal card says half_day', async () => {
    const [t] = await rows<{ t: { status: string; half_day: boolean } }>(
      `select public.attendance_today_for($1, 'A-HALF', '2026-11-16T12:00:00Z') as t`, [A]);
    expect(t.t).toMatchObject({ status: 'leave', half_day: true });
  });
});
