// @vitest-environment node
//
// Payroll and HR are told when a casual worker nears the limit of continuous casual work (FIG-893, Employment Act
// s.37): once per run of working days, for the people who handle casuals, never to the casual.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const PAY = '00000000-0000-0000-0000-00000000cb01';

let db: PGlite;
let C = '';
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const json = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
// payroll records a full day, n days ago
const day = (n: number) => asUser(db, PAY, () =>
  db.query(`insert into casual_days (employee_number, work_date, portion) values ('${C}', current_date - ${n}, 'full')`));
const alerts = async () =>
  (await rows<{ title: string; message: string; days_remaining: number }>(
    `select title, message, days_remaining from hr_notifications where employee_number = '${C}' and notification_type = 'casual_limit' order by id`));

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${PAY}', 'pay@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${PAY}', 'pay@a.co', 'FINANCE', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values ('FINANCE', array['payroll'], '${A}');
    insert into company_payroll_settings (tenant_id, casual_day_limit) values ('${A}', 10)
      on conflict (tenant_id) do update set casual_day_limit = 10;
  `);
  C = await asUser(db, PAY, async () =>
    (await rows<{ n: string }>(`select save_casual(${json({ first_name: 'Wanjiku', last_name: 'Mwangi', phone: '0712345678', daily_rate: 800, start_date: '2026-01-05' })}) n`))[0].n);
}, 120000);

describe('the casual day limit', () => {
  it('nothing while the run is short', async () => {
    for (let n = 40; n >= 36; n--) await day(n); // 5 days in a row
    expect(await alerts()).toEqual([]);
  });

  it('once the run is within 5 days of the limit, payroll is told, once', async () => {
    await day(35); // the 6th day in a row; limit 10
    const a = await alerts();
    expect(a).toHaveLength(1);
    expect(a[0].title).toBe('Casual worker near the day limit');
    expect(a[0].message).toMatch(/^Wanjiku Mwangi has worked 6 days in a row as a casual/);
    expect(a[0].days_remaining).toBe(4);
    for (let n = 34; n >= 30; n--) await day(n);
    expect(await alerts()).toHaveLength(1);
  });

  it('a new run after a break is counted again', async () => {
    for (let n = 20; n >= 15; n--) await day(n); // after a 9-day break
    expect(await alerts()).toHaveLength(2);
  });

  it('is HR-facing: emailed to payroll and work-records people, not shown to the casual', async () => {
    expect((await rows<{ v: boolean }>(`select hr_only_notification('casual_limit') v`))[0].v).toBe(true);
  });
});
