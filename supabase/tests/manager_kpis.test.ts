// @vitest-environment node
//
// A manager sets their team's KPIs without waiting for HR (20261027500000): they start the current quarter's review
// when none covers today, and add KPIs to the library (changing only their own). Real migrations on PGlite.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const HR = '00000000-0000-0000-0000-00000000f901';
const HEAD = '00000000-0000-0000-0000-00000000f902'; // STAFF on a custom role, people report to them
const MO = '00000000-0000-0000-0000-00000000f903'; // STAFF, reports to the head
const PAT = '00000000-0000-0000-0000-00000000f904'; // STAFF, nobody reports to them

let db: PGlite;

const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) => asUser(db, user, () => rows<T>(sql, params));
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const quarterName = async () =>
  (await rows<{ n: string }>(`select 'Q' || extract(quarter from current_date)::int || ' ' || extract(year from current_date)::int n`))[0].n;

beforeAll(async () => {
  db = await bootLiveDb();
  for (const [id, email, role] of [[HR, 'hr@a.co', 'HR'], [HEAD, 'head@a.co', 'STAFF'], [MO, 'mo@a.co', 'STAFF'], [PAT, 'pat@a.co', 'STAFF']]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${A}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values ('HR', array['employees', 'kpi-admin'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Job Title", "Status", tenant_id) values
      ('A-HEAD', 'Dee', 'Head', 'head@a.co', 'Head of Sales', 'Active', '${A}'),
      ('A-MO', 'Mo', 'Member', 'mo@a.co', 'Sales Rep', 'Active', '${A}'),
      ('A-PAT', 'Pat', 'Peer', 'pat@a.co', 'Sales Rep', 'Active', '${A}'),
      ('A-HR', 'Hana', 'HR', 'hr@a.co', 'HR Officer', 'Active', '${A}');
  `);
  const head = (await rows<{ id: string }>(`select id from employees where "Employee Number" = 'A-HEAD'`))[0].id;
  await db.query(`update employees set reports_to_id = $1 where "Employee Number" = 'A-MO'`, [head]);
}, 180000);

describe('starting the current review', () => {
  it('someone with no team cannot', async () => {
    expect(await fails(as(PAT, `select start_current_kpi_period()`))).toMatch(/Only HR or a manager/);
  });

  it('a manager starts the current quarter, open, once', async () => {
    const [{ id }] = await as<{ id: string }>(HEAD, `select start_current_kpi_period() id`);
    const [p] = await rows<{ name: string; status: string; covers: boolean }>(
      `select name, status, starts_on <= current_date and ends_on >= current_date covers from kpi_periods where id = $1`, [id]);
    expect(p).toEqual({ name: await quarterName(), status: 'open', covers: true });
    // again: the same one
    expect((await as<{ id: string }>(HEAD, `select start_current_kpi_period() id`))[0].id).toBe(id);
    expect((await rows(`select 1 from kpi_periods where tenant_id = $1`, [A])).length).toBe(1);

    // and gives their report a KPI in it as before
    const [{ k }] = await as<{ k: string }>(HR, `insert into kpis (name, unit, default_weight) values ('Calls made', 'number', 50) returning id k`);
    expect((await as<{ n: number }>(HEAD, `select assign_kpi($1, $2, 'person', 'A-MO') n`, [id, k]))[0].n).toBe(1);
    expect((await as<{ n: number }>(HEAD, `select assign_kpi($1, $2, 'person', 'A-PAT') n`, [id, k]))[0].n).toBe(0);
  });

  it('a closed review for this quarter is not reopened by a manager', async () => {
    await rows(`update kpi_periods set status = 'closed' where tenant_id = $1`, [A]);
    expect(await fails(as(HEAD, `select start_current_kpi_period()`))).toMatch(/is closed: ask HR to reopen it/);
  });
});

describe('the KPI library', () => {
  it('a manager adds a KPI and changes their own, not HR’s', async () => {
    const [{ id }] = await as<{ id: string }>(HEAD, `insert into kpis (name, unit, default_target, default_weight) values ('Deals closed', 'number', 10, 40) returning id`);
    await as(HEAD, `update kpis set default_target = 12, archived = true where id = $1`, [id]);
    expect((await rows<{ default_target: string; archived: boolean }>(`select default_target, archived from kpis where id = $1`, [id]))[0])
      .toEqual({ default_target: '12.00', archived: true });

    expect((await as(HEAD, `update kpis set default_weight = 1 where name = 'Calls made' returning id`))).toEqual([]);
    expect((await rows<{ default_weight: string }>(`select default_weight from kpis where name = 'Calls made'`))[0].default_weight).toBe('50.00');
  });

  it('someone with no team cannot add one', async () => {
    expect(await fails(as(PAT, `insert into kpis (name) values ('My own KPI')`))).toMatch(/row-level security/);
  });
});
