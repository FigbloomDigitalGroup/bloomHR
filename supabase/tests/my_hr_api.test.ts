// @vitest-environment node
//
// "My HR" for Figbloom Schools staff (20261107100000_my_hr_api.sql): the functions the backend calls (my_hr_routes.js)
// answer for one company and one employee only, with the staff portal's rules:
//   my_hr_person      the company must be that platform tenant's; the person only through external_people
//   payslips          only approved or paid countries' payslips; never another employee's or company's
//   a draft employee  no data at all
//   leave, attendance, KPIs: theirs only (another employee with the same number in another company never shows)
//   only service_role may call them
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const PT = '7a1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c10';
const PT_OTHER = '8b2c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c11';
const STAFF_USER = '00000000-0000-0000-0000-00000000d001';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the functions' JSON answers
type J = any;

let db: PGlite;
let school: string;
let other: string;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const val = async <T = unknown>(sql: string, params: unknown[] = []) => (await rows<{ v: T }>(sql, params))[0]?.v;

type Person = { outcome: string; employee_number: string | null; onboarding_status: string | null };
const person = async (tenant: string, pt: string, external: string) =>
  (await rows<Person>(`select outcome, employee_number, onboarding_status from my_hr_person($1, $2, $3)`, [tenant, pt, external]))[0];

const slip = (tenant: string, emp: string, period: string, gross: number, country = 'Kenya') =>
  db.query(
    `insert into salary_history (tenant_id, employee_id, employee_name, pay_period, gross_pay, net_pay, total_deductions, country, currency, account_number)
     values ($1, $2, $2, $3, $4, $4 * 0.8, $4 * 0.2, $5, 'KES', '0123456789') returning id`,
    [tenant, emp, period, gross, country]
  ).then((r) => (r.rows[0] as { id: string }).id);
const runStatus = async (tenant: string, period: string, status: string) => {
  await db.query(
    `update payroll_run_countries c set status = $3 from payroll_runs r where r.id = c.run_id and r.tenant_id = $1 and r.pay_period = $2`,
    [tenant, period, status]
  );
};

let mine: { approved: string; draftRun: string; colleague: string; otherCompany: string };

beforeAll(async () => {
  db = await bootLiveDb();
  school = (await rows<{ tenant_id: string }>(`select tenant_id from platform_enable_hr($1, 'Hillside Primary', 'hillside', '[]')`, [PT]))[0].tenant_id;
  other = (await rows<{ tenant_id: string }>(`select tenant_id from platform_enable_hr($1, 'Other School', 'other-school', '[]')`, [PT_OTHER]))[0].tenant_id;
  await db.exec(`
    insert into employees ("Employee Number", "First Name", "Last Name", "Job Title", "Start Date", worker_kind, onboarding_status, tenant_id) values
      ('E1', 'Mary', 'Teacher', 'Teacher', '2025-01-01', 'employee', 'approved', '${school}'),
      ('E2', 'John', 'Colleague', 'Driver', '2025-01-01', 'employee', 'approved', '${school}'),
      ('E3', 'New', 'Person', 'Teacher', '2025-01-01', 'employee', 'draft', '${school}'),
      ('E1', 'Same', 'Number', 'Bursar', '2025-01-01', 'employee', 'approved', '${other}');
    insert into external_people (tenant_id, employee_number, source, external_id) values
      ('${school}', 'E1', 'schools', 'person-mary'), ('${school}', 'E2', 'schools', 'person-john'),
      ('${school}', 'E3', 'schools', 'person-new'), ('${other}', 'E1', 'schools', 'person-other');
  `);
  // payslips: E1's January (approved), February (still draft); E2's January; the other company's E1
  const approved = await slip(school, 'E1', '2026-01', 100000);
  const colleague = await slip(school, 'E2', '2026-01', 50000);
  const draftRun = await slip(school, 'E1', '2026-02', 100000);
  const otherCompany = await slip(other, 'E1', '2026-01', 999999);
  await runStatus(school, '2026-01', 'approved');
  await runStatus(other, '2026-01', 'approved');
  mine = { approved, draftRun, colleague, otherCompany };

  // leave
  await db.exec(`
    insert into leave_application (tenant_id, "Employee Number", name, "Leave Type", "Start Date", "End Date", status, days, reason) values
      ('${school}', 'E1', 'Mary Teacher', 'Annual Leave', '2026-12-01', '2026-12-03', 'pending', 3, 'Family'),
      ('${school}', 'E2', 'John Colleague', 'Annual Leave', '2026-12-01', '2026-12-03', 'pending', 3, 'Secret'),
      ('${other}', 'E1', 'Same Number', 'Annual Leave', '2026-12-01', '2026-12-03', 'pending', 3, 'Other company');
    insert into attendance_settings (tenant_id, tracking_from) values ('${school}', '2026-01-01'), ('${other}', '2026-01-01')
      on conflict (tenant_id) do update set tracking_from = excluded.tracking_from;
    insert into attendance_logs (tenant_id, employee_number, work_date, login_time, status, source) values
      ('${school}', 'E1', '2026-03-02', '2026-03-02 05:00:00+00', 'present', 'app'),
      ('${school}', 'E2', '2026-03-02', '2026-03-02 05:00:00+00', 'present', 'app'),
      ('${other}', 'E1', '2026-03-03', '2026-03-03 05:00:00+00', 'present', 'app');
    insert into attendance_missed_scan_requests (tenant_id, employee_number, work_date, came_in_at, reason, status, approver) values
      ('${school}', 'E1', '2026-03-04', '2026-03-04 05:00:00+00', 'Scanner down', 'pending', 'hr'),
      ('${other}', 'E1', '2026-03-04', '2026-03-04 05:00:00+00', 'Other company', 'pending', 'hr');
    insert into possible_absence_notices (tenant_id, employee_number, start_date, end_date, notified_on, reply_by) values
      ('${school}', 'E1', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-10'),
      ('${school}', 'E2', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-10');
  `);
  // a KPI period: E1's KPI, E2's KPI, and a draft period E1 must not see
  await db.exec(`
    insert into kpis (id, tenant_id, name, unit, direction) values
      ('00000000-0000-0000-0000-0000000aa001', '${school}', 'Lessons planned', 'number', 'higher_is_better'),
      ('00000000-0000-0000-0000-0000000aa002', '${other}', 'Other KPI', 'number', 'higher_is_better');
    insert into kpi_periods (id, tenant_id, name, starts_on, ends_on, status) values
      ('00000000-0000-0000-0000-0000000bb001', '${school}', 'Term 1', '2026-01-01', '2026-03-31', 'open'),
      ('00000000-0000-0000-0000-0000000bb002', '${school}', 'Next term', '2027-01-01', '2027-03-31', 'draft'),
      ('00000000-0000-0000-0000-0000000bb003', '${other}', 'Other term', '2026-01-01', '2026-03-31', 'open');
    insert into kpi_assignments (tenant_id, period_id, kpi_id, employee_number, target, weight) values
      ('${school}', '00000000-0000-0000-0000-0000000bb001', '00000000-0000-0000-0000-0000000aa001', 'E1', 10, 100),
      ('${school}', '00000000-0000-0000-0000-0000000bb001', '00000000-0000-0000-0000-0000000aa001', 'E2', 99, 100),
      ('${school}', '00000000-0000-0000-0000-0000000bb002', '00000000-0000-0000-0000-0000000aa001', 'E1', 77, 100),
      ('${other}', '00000000-0000-0000-0000-0000000bb003', '00000000-0000-0000-0000-0000000aa002', 'E1', 55, 100);
  `);
}, 180000);

describe('who is calling', () => {
  it('finds the employee only through external_people, in the platform tenant\'s company', async () => {
    expect(await person(school, PT, 'person-mary')).toEqual({ outcome: 'found', employee_number: 'E1', onboarding_status: 'approved' });
    expect(await person(school, PT, 'person-new')).toEqual({ outcome: 'found', employee_number: 'E3', onboarding_status: 'draft' });
    expect((await person(school, PT, 'nobody')).outcome).toBe('not_linked');
    // the other company's person is not this company's
    expect((await person(school, PT, 'person-other')).outcome).toBe('not_linked');
  });

  it('a company that is not that platform tenant\'s is unknown_company', async () => {
    expect((await person(school, PT_OTHER, 'person-mary')).outcome).toBe('unknown_company');
    expect((await person(other, PT, 'person-other')).outcome).toBe('unknown_company');
    expect((await person('00000000-0000-0000-0000-0000000000ff', PT, 'person-mary')).outcome).toBe('unknown_company');
  });

  it('an inactive company answers nothing', async () => {
    expect((await person(other, PT_OTHER, 'person-other')).outcome).toBe('found');
    await db.query(`update tenants set status = 'suspended' where id = $1`, [other]);
    expect((await person(other, PT_OTHER, 'person-other')).outcome).toBe('unknown_company');
    await db.query(`update tenants set status = 'active' where id = $1`, [other]);
  });
});

describe('payslips', () => {
  it('lists only the employee\'s own, approved or paid', async () => {
    const list = await val<{ id: string; pay_period: string; gross_pay: number; run_status: string }[]>(`select my_hr_payslips($1, 'E1') v`, [school]);
    expect(list.map((p) => [p.id, p.pay_period, p.run_status])).toEqual([[mine.approved, '2026-01', 'approved']]);
  });

  it('one payslip: every figure, the account only as its last 4, never someone else\'s or a draft', async () => {
    const p = await val<Record<string, unknown>>(`select my_hr_payslip($1, 'E1', $2) v`, [school, mine.approved]);
    expect(p).toMatchObject({ id: mine.approved, employee_id: 'E1', pay_period: '2026-01', account_number_last4: '6789', run_status: 'approved' });
    expect(Number(p.gross_pay)).toBe(100000);
    expect(p).not.toHaveProperty('account_number');
    expect(p).not.toHaveProperty('tenant_id');
    expect(await val(`select my_hr_payslip($1, 'E1', $2) v`, [school, mine.draftRun])).toBeNull();
    expect(await val(`select my_hr_payslip($1, 'E1', $2) v`, [school, mine.colleague])).toBeNull();
    expect(await val(`select my_hr_payslip($1, 'E1', $2) v`, [school, mine.otherCompany])).toBeNull();
  });

  it('a month shows once approved, and still once paid', async () => {
    await runStatus(school, '2026-02', 'approved');
    expect((await val<{ pay_period: string }[]>(`select my_hr_payslips($1, 'E1') v`, [school])).map((p) => p.pay_period)).toEqual(['2026-02', '2026-01']);
    await runStatus(school, '2026-02', 'paid');
    expect((await val<{ run_status: string }[]>(`select my_hr_payslips($1, 'E1') v`, [school]))[0].run_status).toBe('paid');
    expect(await val(`select my_hr_payslip($1, 'E1', $2) v`, [school, mine.draftRun])).not.toBeNull();
  });
});

describe('a draft employee', () => {
  it('gets no data from J function', async () => {
    for (const fn of ['my_hr_summary', 'my_hr_payslips', 'my_hr_leave', 'my_hr_kpis']) {
      await expect(db.query(`select ${fn}($1, 'E3')`, [school])).rejects.toThrow(/not approved/);
    }
    await expect(db.query(`select my_hr_attendance($1, 'E3', '2026-03-01', '2026-03-10')`, [school])).rejects.toThrow(/not approved/);
  });
  it('an employee of another company is no such employee', async () => {
    await expect(db.query(`select my_hr_payslips($1, 'E2')`, [other])).rejects.toThrow(/No such employee/);
  });
});

describe('summary, leave, attendance, KPIs: the employee\'s own only', () => {
  it('summary', async () => {
    const s = await val<Record<string, J>>(`select my_hr_summary($1, 'E1') v`, [school]);
    expect(s.employee).toMatchObject({ employee_number: 'E1', name: 'Mary Teacher', job_title: 'Teacher' });
    expect(s.company).toEqual({ name: 'Hillside Primary' });
    expect(s.latest_payslip.id).toBe(mine.draftRun); // February, paid by now (the test above)
    expect(Number(s.leave_pending)).toBe(1);
  });

  it('leave', async () => {
    const l = await val<Record<string, J>>(`select my_hr_leave($1, 'E1') v`, [school]);
    expect(Array.isArray(l.leave_types)).toBe(true);
    expect(Array.isArray(l.balances)).toBe(true);
    expect(l.applications.map((a: J) => [a.leave_type, a.status, a.reason])).toEqual([['Annual Leave', 'pending', 'Family']]);
    for (const b of l.balances) expect(Object.keys(b)).toEqual(expect.arrayContaining(['leave_type', 'available_days', 'pending_days']));
  });

  it('attendance: days, notices, missed-scan requests', async () => {
    const a = await val<Record<string, J>>(`select my_hr_attendance($1, 'E1', '2026-03-01', '2026-03-10') v`, [school]);
    expect(a.from).toBe('2026-03-01');
    expect(a.days.length).toBe(10);
    expect(a.days.find((d: J) => d.day === '2026-03-02')).toMatchObject({ status: expect.stringMatching(/present|late/) });
    // the other company's E1 clocked in on the 3rd: not here
    expect(a.days.find((d: J) => d.day === '2026-03-03')?.clock_in ?? null).toBeNull();
    expect(a.possible_absence_notices).toEqual([{ start_date: '2026-03-05', end_date: '2026-03-06', notified_on: '2026-03-07', reply_by: '2026-03-10' }]);
    expect(a.missed_scan_requests.map((q: J) => [q.work_date, q.reason, q.status, q.approver_name])).toEqual([['2026-03-04', 'Scanner down', 'pending', 'HR']]);
    await expect(db.query(`select my_hr_attendance($1, 'E1', '2026-01-01', '2026-06-01')`, [school])).rejects.toThrow(/93 days/);
  });

  it('KPIs: the open period, never a draft one or a colleague\'s', async () => {
    const k = await val<Record<string, J>>(`select my_hr_kpis($1, 'E1') v`, [school]);
    expect(k.period).toMatchObject({ name: 'Term 1', status: 'open' });
    expect(k.items.map((i: J) => [i.name, Number(i.target)])).toEqual([['Lessons planned', 10]]);
    expect(k.attendance).toMatchObject({ from: '2026-01-01' });
    const o = await val<Record<string, J>>(`select my_hr_kpis($1, 'E1') v`, [other]);
    expect(o.items.map((i: J) => i.name)).toEqual(['Other KPI']);
  });
});

describe('who may call', () => {
  it('only the backend (service role): not a signed-in user, not anon', async () => {
    await db.exec(`insert into auth.users (id, email) values ('${STAFF_USER}', 'mary@hillside.ac.ke')`);
    await expect(asUser(db, STAFF_USER, () => db.query(`select my_hr_payslips($1, 'E1')`, [school]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, STAFF_USER, () => db.query(`select * from my_hr_person($1, $2, 'person-mary')`, [school, PT]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, STAFF_USER, () => db.query(`select * from my_hr_api_log`))).rejects.toThrow(/permission denied/);
    await db.exec(`set role service_role`);
    try {
      expect((await val<unknown[]>(`select my_hr_payslips($1, 'E1') v`, [school])).length).toBe(2);
      await db.query(`insert into my_hr_api_log (tenant_id, employee_number, route, status) values ($1, 'E1', 'payslips', 200)`, [school]);
    } finally {
      await db.exec(`reset role`);
    }
  });
});
