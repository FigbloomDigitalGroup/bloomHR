// @vitest-environment node
//
// Access checks run once per query, not once per row (FIG-819). A policy that calls the signed-in user's checks bare
// (has_module('payroll'), auth.uid(), is_own_employee(employee_id) ...) makes Postgres run them for every row it
// reads, so a staff member's own notifications or payslips cost a pass over the whole company. Policies must wrap them
// as (select public.has_module('payroll')), which Postgres works out once, and compare a column with a set worked out
// once instead of calling a per-row helper. The other test files check who can see what; this one checks how.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000d001';
const ME = '00000000-0000-0000-0000-00000000d002';
const BOSS = '00000000-0000-0000-0000-00000000d003';
const NOBODY = '00000000-0000-0000-0000-00000000d004';

// Per-row helpers a policy must not call at all: compare the column with the once-worked-out set instead.
//   is_own_employee(col)        -> col = (select public.current_employee_id())
//   supervises(col)             -> col in (select public.supervised_employee_numbers())
//   payroll_run_published(col)  -> col in (select public.published_payroll_run_ids())
// (is_dm_channel / channel_open_to_me, the messaging checks on the row's channel, are per row by nature.)
const ROW_HELPERS = ['is_own_employee', 'supervises', 'payroll_run_published'];

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${HR}', 'hr@a.co'), ('${ME}', 'me@a.co'), ('${BOSS}', 'boss@a.co'), ('${NOBODY}', 'nobody@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${ME}', 'me@a.co', 'STAFF', '${A}'),
      ('${BOSS}', 'boss@a.co', 'STAFF', '${A}'), ('${NOBODY}', 'nobody@a.co', 'STAFF', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['leaves', 'employees', 'hr-lifecycle', 'payroll'], '${A}'), ('STAFF', array['dashboard'], '${A}');

    -- a company of 1,000 (and another company of 500): each with notifications, leave and payslips
    insert into employees ("Employee Number", "First Name", "Work Email", manager_email, tenant_id)
      select 'E' || n, 'Worker ' || n, 'w' || n || '@a.co', case when n % 10 = 0 then ' Boss@A.co ' end, '${A}'
      from generate_series(1, 1000) n;
    insert into employees ("Employee Number", "First Name", "Work Email", tenant_id) values
      ('ME', 'Me', 'me@a.co', '${A}'), ('BOSS', 'Boss', 'boss@a.co', '${A}');
    insert into employees ("Employee Number", "First Name", "Work Email", manager_email, tenant_id)
      select 'E' || n, 'Other ' || n, 'w' || n || '@b.co', 'boss@a.co', '${B}' from generate_series(1, 500) n;

    insert into payroll_runs (pay_period, status, tenant_id) values ('2026-08', 'draft', '${A}'), ('2026-09', 'draft', '${A}');
    insert into hr_notifications (employee_number, employee_name, notification_type, title, message, tenant_id)
      select 'E' || (n % 1000 + 1), 'Worker', 'leave_approved', 't', 'm', '${A}' from generate_series(1, 10000) n;
    insert into hr_notifications (employee_number, employee_name, notification_type, title, message, tenant_id)
      select 'ME', 'Me', 'leave_approved', 't', 'm', '${A}' from generate_series(1, 5);
    insert into leave_application ("Employee Number", status, tenant_id)
      select 'E' || (n % 1000 + 1), 'Pending', '${A}' from generate_series(1, 10000) n;
    insert into leave_application ("Employee Number", status, tenant_id) select 'ME', 'Pending', '${A}' from generate_series(1, 3);
    insert into salary_history (employee_id, pay_period, net_pay, run_id, tenant_id)
      select 'E' || n, p.pay_period, 1000, p.id, '${A}'
      from generate_series(1, 1000) n cross join payroll_runs p where p.tenant_id = '${A}';
    insert into salary_history (employee_id, pay_period, net_pay, run_id, tenant_id)
      select 'ME', p.pay_period, 1000, p.id, '${A}' from payroll_runs p where p.tenant_id = '${A}';
    update payroll_runs set status = 'approved' where pay_period = '2026-08';
    analyze;
  `);
}, 300000);

describe('policies evaluate the signed-in user once per query', () => {
  it("no policy calls a check on the signed-in user per row (has_module, auth.uid(), is_own_employee ...)", async () => {
    // every argument-free function in public (current_tenant_id(), manages_work() ...), has_module/has_any_module (whose
    // arguments are module names) and auth.uid()/jwt()/role() are the same for every row: they must be (select ...)
    const ctx = (
      await rows<{ name: string }>(`
        select distinct p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype and (p.pronargs = 0 or p.proname in ('has_module', 'has_any_module'))`)
    ).map((r) => r.name);
    expect(ctx).toEqual(expect.arrayContaining(['has_module', 'has_any_module', 'current_tenant_id', 'current_employee_number', 'manages_work']));
    const names = [...ctx.map((n) => `(?:public\\.)?${n}`), 'auth\\.(?:uid|jwt|role)'].join('|');
    const call = new RegExp(`(?<![\\w.])(${names})\\(`, 'g');
    const rowCall = new RegExp(`(?<![\\w.])(?:public\\.)?(${ROW_HELPERS.join('|')})\\(`, 'g');

    const policies = await rows<{ policy: string; qual: string | null; with_check: string | null }>(
      `select schemaname || '.' || tablename || ' / ' || policyname as policy, qual, with_check from pg_policies`
    );
    expect(policies.length).toBeGreaterThan(200);
    const offenders: string[] = [];
    for (const p of policies) {
      for (const expr of [p.qual, p.with_check]) {
        if (!expr) continue;
        // pg_policies prints a wrapped call as "( SELECT has_module('payroll'::text) AS has_module)"
        for (const m of expr.matchAll(call)) {
          if (!/\(\s*SELECT\s+$/i.test(expr.slice(0, m.index))) offenders.push(`${p.policy}: ${m[1]}() per row`);
        }
        for (const m of expr.matchAll(rowCall)) offenders.push(`${p.policy}: ${m[1]}() per row`);
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });

  it('the checker catches a bare call', async () => {
    await db.exec(`create policy zz_bare on public.holidays for select to authenticated using (public.has_module('leaves'))`);
    try {
      const [{ qual }] = await rows<{ qual: string }>(`select qual from pg_policies where policyname = 'zz_bare'`);
      expect(qual).toBe(`has_module('leaves'::text)`);
      expect(/\(\s*SELECT\s+$/i.test(qual.slice(0, qual.indexOf('has_module(')))).toBe(false);
    } finally {
      await db.exec(`drop policy zz_bare on public.holidays`);
    }
  });
});

describe('the once-per-query helpers give the same answers as the per-row ones', () => {
  const same = (user: string) =>
    asUser(db, user, () =>
      rows<{ own: number; supervised: number; published: number }>(`
        select
          (select count(*) from employees e
            where public.is_own_employee(e.id) is distinct from coalesce(e.id = (select public.current_employee_id()), false))::int as own,
          (select count(*) from employees e
            where public.supervises(e."Employee Number")
              is distinct from (e."Employee Number" in (select public.supervised_employee_numbers())))::int as supervised,
          (select count(*) from payroll_runs r
            where public.payroll_run_published(r.id) is distinct from (r.id in (select public.published_payroll_run_ids())))::int as published
      `)
    );

  it('for staff, a supervisor, HR and someone with no employee record', async () => {
    for (const user of [ME, BOSS, HR, NOBODY]) expect(await same(user)).toEqual([{ own: 0, supervised: 0, published: 0 }]);
    // and they are not trivially empty
    expect(await asUser(db, BOSS, () => rows(`select public.supervised_employee_numbers()`))).toHaveLength(100);
    expect(await asUser(db, ME, () => rows(`select public.current_employee_id() as id`))).toEqual([
      { id: (await rows<{ id: string }>(`select id from employees where "Employee Number" = 'ME'`))[0].id },
    ]);
    expect(await asUser(db, NOBODY, () => rows(`select public.current_employee_id() as id`))).toEqual([{ id: null }]);
  });
});

describe("a staff member's own rows are found through an index", () => {
  // What the staff portal runs (useHRNotifications, StaffPortal, PayslipViewer): the signed-in employee's rows, filtered
  // by their number. 10,000 notifications / leave applications and 2,000 payslips in the company, analyzed, so the
  // planner picks an index on its own (no enable_seqscan = off). The plan must not call a module check per row: the
  // check is an InitPlan, run once.
  const plan = async (sql: string) =>
    (await asUser(db, ME, () => rows<{ 'QUERY PLAN': string }>(`explain ${sql}`))).map((r) => r['QUERY PLAN']).join('\n');

  // [table, the staff portal's query, how many rows are theirs] (approving the run added a payslip notification)
  const cases: [string, string, number][] = [
    ['hr_notifications', `select * from hr_notifications where employee_number = 'ME'`, 6],
    ['leave_application', `select * from leave_application where "Employee Number" = 'ME'`, 3],
    ['salary_history', `select * from salary_history where employee_id = 'ME'`, 1], // the approved run only
  ];
  for (const [table, sql, count] of cases) {
    it(table, async () => {
      expect(await asUser(db, ME, () => rows(sql))).toHaveLength(count);
      const p = await plan(sql);
      expect(p).toMatch(new RegExp(`Index Scan using \\w+ on ${table}|Bitmap Index Scan on \\w+`));
      expect(p).not.toMatch(/Seq Scan/);
      expect(p).not.toMatch(/has_any_module|has_module|is_own_employee|payroll_run_published/);
    });
  }

  it('HR still reads the whole company', async () => {
    for (const table of ['hr_notifications', 'leave_application', 'salary_history']) {
      const all = await rows<{ n: number }>(`select count(*)::int as n from ${table} where tenant_id = '${A}'`);
      expect(all[0].n).toBeGreaterThan(2000);
      expect(await asUser(db, HR, () => rows(`select count(*)::int as n from ${table}`))).toEqual(all);
    }
  });
});
