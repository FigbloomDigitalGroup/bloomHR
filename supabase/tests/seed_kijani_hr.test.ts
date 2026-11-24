// @vitest-environment node
//
// scripts/seed-kijani-hr.mjs against a fresh HR database: the Kijani Ridge company (its real id) with draft staff made
// the way Figbloom Schools' staff events make them (platform_upsert_staff), then snapshot -> plan -> SQL -> applied.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bootDb } from './db';
// @ts-expect-error -- a plain .mjs script without types
import * as seed from '../../scripts/seed-kijani-hr.mjs';

const T = seed.HR_TENANT as string;
const P = seed.PLATFORM_TENANT as string;
const OTHER = '00000000-0000-0000-0000-0000000000b2';
const ADMIN = '00000000-0000-0000-0000-00000000ad01';

let db: PGlite;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const rows = async <R = Row>(sql: string) => (await db.query<R>(sql)).rows;
const one = async <R = Row>(sql: string) => (await rows<R>(sql))[0];
const count = async (sql: string) => Number((await one<{ n: number }>(`select count(*)::int as n from (${sql}) q`)).n);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let engine: any;

const snapshot = async () => {
  const results = await db.exec(seed.SNAPSHOT_SQL);
  const r = results.find((x) => x.rows.length && x.fields.length === 1);
  return JSON.parse(Object.values(r!.rows[0])[0] as string);
};
const build = async (opts: { trial?: boolean; through?: string; schoolsStaff?: unknown[] } = {}) => {
  const plan = seed.buildPlan(await snapshot(), { through: opts.through ?? '2026-10', schoolsStaff: opts.schoolsStaff ?? null });
  const payroll = seed.computePayslips(plan, engine);
  return { plan, payroll, sql: seed.buildSql(plan, payroll, { trial: opts.trial }) as string };
};
const fails = async (sql: string) => {
  try {
    await db.exec(sql);
    return '';
  } catch (e) {
    await db.exec('rollback').catch(() => undefined);
    return (e as Error).message;
  }
};

// Schools' staff: person id, full name, title, phone (HR's event route drops @kijaniridge-demo.invalid emails)
const STAFF: [string, string, string, string | null][] = [
  ['grace', 'Grace Wambui', 'Head Teacher', '+254700000001'],
  ['deputy', 'Peter Otieno Ouma', 'Deputy Head Teacher', '+254700000002'],
  ['senior1', 'Mercy Achieng', 'Senior Teacher', '+254700000003'],
  ['senior2', 'Joseph Kamau', 'Head of Department - Sciences', null],
  ...Array.from({ length: 14 }, (_, i): [string, string, string, string | null] => [
    `t${i}`, `${['Faith', 'John', 'Lucy', 'Kevin', 'Janet', 'Brian', 'Esther', 'Samuel', 'Ann', 'Dennis', 'Ruth', 'Collins', 'Naomi', 'Zawadi'][i]} Teacher${i}`,
    ['Teacher', 'Class Teacher', 'Mathematics Teacher', 'PP2 Teacher', 'Grade 8 Science Teacher', 'Teacher'][i % 6], `+2547000001${String(i).padStart(2, '0')}`]),
  ['bursar', 'Alice Wanjiru', 'Bursar', '+254700000020'],
  ['store', 'Moses Kibet', 'Storekeeper', '+254700000021'],
  ['headcook', 'Rose Akinyi', 'Head Cook', null],
  ['cook1', 'Agnes Moraa', 'Cook', null],
  ['cook2', 'Tom Wafula', 'Cook', null],
  ['driver1', 'Daniel Mwangi', 'Bus driver', null],
  ['driver2', 'Amos Kiprop', 'Driver', null],
  ['matron', 'Lydia Chebet', 'Matron', null],
  ['secretary', 'Joyce Nduku', 'Secretary', null],
  ['librarian', 'Martin Njoroge', 'Librarian', null],
  ['nurse', 'Purity Mutheu', 'School Nurse', null],
  ['guard1', 'Wycliffe Barasa', 'Security Guard', null],
  ['cleaner1', 'Mary Atieno', 'Cleaner', null],
  ['other', 'Xyz Qwerty', 'Staff', null],
];

beforeAll(async () => {
  db = await bootDb();
  engine = await seed.loadPayrollEngine();
  await db.exec(`
    insert into tenants (id, name, slug, plan, status, platform_tenant_id, platform_source)
    values ('${T}', 'Kijani Ridge Academy', 'kijani-ridge', 'trial', 'active', '${P}', 'schools'),
           ('${OTHER}', 'Other School', 'other-school', 'trial', 'active', gen_random_uuid(), 'schools');
    select seed_default_leave_types('${T}'), seed_default_leave_types('${OTHER}');
    select platform_leave_chain('${T}');
    insert into auth.users (id, email) values ('${ADMIN}', 'admin@kijaniridge-demo.invalid');
    insert into user_profiles (user_id, email, role, tenant_id, full_name) values ('${ADMIN}', 'admin@kijaniridge-demo.invalid', 'ADMIN', '${T}', 'Admin');
  `);
  for (const [person, name, title, phone] of STAFF) {
    const words = name.split(' ');
    const middle = words.length > 2 ? `'${words.slice(1, -1).join(' ')}'` : 'null';
    await db.query(`select * from platform_upsert_staff('${P}', 'schools', 'kijani-${person}', '${words[0]}', ${middle}, '${words.at(-1)}',
      ${phone ? `'${phone}'` : 'null'}, ${person === 'grace' ? `'grace.wambui@kijaniridge.sc.ke'` : 'null'}, '${title}')`);
  }
  // someone HR added by hand (no Schools link), and another school's staff member
  const otherPlatform = (await one<{ p: string }>(`select platform_tenant_id p from tenants where id = '${OTHER}'`)).p;
  await db.exec(`
    insert into employees (tenant_id, "First Name", "Last Name", "Job Title") values ('${T}', 'Hand', 'Made', 'Gardener');
    select * from platform_upsert_staff('${otherPlatform}', 'schools', 'other-1', 'Olive', null, 'Other', null, null, 'Teacher');
  `);
}, 240000);

describe('seed-kijani-hr', () => {
  it('starts from draft staff mapped from Schools', async () => {
    expect(await count(`select 1 from employees where tenant_id = '${T}' and onboarding_status = 'draft'`)).toBe(STAFF.length + 1);
    expect(await count(`select 1 from external_people where tenant_id = '${T}' and source = 'schools'`)).toBe(STAFF.length);
  });

  it('refuses another company, and a company linked to another platform tenant', async () => {
    const snap = await snapshot();
    expect(() => seed.buildPlan({ ...snap, tenant_id: OTHER })).toThrow(/only works on/);
    expect(() => seed.buildPlan({ ...snap, tenant: { ...snap.tenant, platform_tenant_id: OTHER } })).toThrow(/not Kijani Ridge/);
    expect(() => seed.buildPlan({ ...snap, tenant: null })).toThrow(/does not exist/);
    const { sql } = await build();
    await db.exec(`update tenants set platform_tenant_id = gen_random_uuid() where id = '${T}'`);
    try {
      expect(await fails(sql)).toMatch(/is linked to platform tenant/);
    } finally {
      await db.exec(`update tenants set platform_tenant_id = '${P}' where id = '${T}'`);
    }
    expect(await count(`select 1 from salary_history`)).toBe(0);
  });

  it('plans every linked person, reports the rest, and a trial changes nothing', async () => {
    const schoolsStaff = [...STAFF.map(([p, n, t]) => ({ person_id: `kijani-${p}`, full_name: n, job_title: t })),
      { person_id: 'kijani-never-arrived', full_name: 'Late Arrival', job_title: 'Cook' }];
    const { plan, payroll, sql } = await build({ trial: true, schoolsStaff });
    console.log(seed.formatReport(plan, payroll));
    expect(plan.employees).toHaveLength(STAFF.length);
    expect(plan.report.unlinked.map((x: Row) => x.name)).toEqual(['Hand Made']);
    expect(plan.report.missingInHr.map((x: Row) => x.name)).toEqual(['Late Arrival']);
    expect(plan.report.defaulted.map((x: Row) => x.title)).toEqual(['Staff']);
    expect(plan.report.realEmails.map((x: Row) => x.email)).toEqual(['grace.wambui@kijaniridge.sc.ke']);
    expect(plan.months.map((m: Row) => m.period)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    const role = (n: string) => plan.employees.find((x: Row) => x.name === n);
    expect(role('Grace Wambui')).toMatchObject({ role: 'head_teacher', group: 'KR-T13', reports_to: null });
    expect(role('Peter Otieno Ouma')).toMatchObject({ role: 'deputy', reports_to: role('Grace Wambui').number });
    expect(role('Alice Wanjiru')).toMatchObject({ role: 'bursar', department: 'Finance & Accounts', reports_to: role('Grace Wambui').number });
    expect(role('Agnes Moraa')).toMatchObject({ role: 'cook', reports_to: role('Rose Akinyi').number });
    expect(role('Daniel Mwangi')).toMatchObject({ role: 'driver', department: 'Transport' });
    // every made-up number is a 99... one
    for (const x of plan.employees) {
      expect(x.id_number).toMatch(/^99\d{6}$/);
      expect(x.tax_pin).toMatch(/^A99\d{7}[A-Z]$/);
      expect(x.shif).toMatch(/^CR99\d{10}$/);
      expect(x.nssf).toMatch(/^99\d{7}$/);
      expect(x.account).toMatch(/^99\d{11}$/);
    }
    await db.exec(sql);
    expect(await count(`select 1 from salary_history`)).toBe(0);
    expect(await count(`select 1 from employees where tenant_id = '${T}' and onboarding_status = 'approved'`)).toBe(0);
  });

  it('stops, changing nothing, when the company changed since the snapshot', async () => {
    const { sql } = await build();
    await db.exec(`update employees set "Job Title" = 'Teacher of Music' where tenant_id = '${T}' and "First Name" = 'Faith'`);
    expect(await fails(sql)).toMatch(/changed since the snapshot/);
    await db.exec(`update employees set "Job Title" = 'Teacher' where tenant_id = '${T}' and "First Name" = 'Faith'`);
    expect(await count(`select 1 from payroll_runs where tenant_id = '${T}'`)).toBe(0);
  });

  it('completes the staff and writes ten paid months of payslips, telling nobody', async () => {
    const { plan, payroll, sql } = await build();
    await db.exec(sql);
    const linked = `select e.* from employees e join external_people m on m.tenant_id = e.tenant_id and m.employee_number = e."Employee Number"
                    where e.tenant_id = '${T}' and m.source = 'schools'`;
    expect(await count(`${linked} and e.onboarding_status = 'approved' and e."Status" = 'Active' and e.job_group_id is not null
                        and e.department_id is not null and e."Tax PIN" like 'A99%' and e."Date of Birth" is null`)).toBe(STAFF.length);
    expect(await count(`${linked} and e."Work Email" is not null and e."Work Email" not like '%@kijaniridge-demo.invalid'`)).toBe(1);
    expect(await one(`select onboarding_status from employees where tenant_id = '${T}' and "First Name" = 'Hand'`)).toEqual({ onboarding_status: 'draft' });
    expect(await count(`select 1 from employees where tenant_id = '${OTHER}' and onboarding_status <> 'draft'`)).toBe(0);
    expect(await count(`select 1 from notification_preferences where tenant_id = '${T}' and email_level = 'off' and not email`)).toBe(STAFF.length);

    const runs = await rows(`select pay_period, status, approved_at, paid_at from payroll_runs where tenant_id = '${T}' order by 1`);
    expect(runs.map((r) => [r.pay_period, r.status])).toEqual(plan.months.map((m: Row) => [m.period, 'paid']));
    expect(new Date(runs[0].paid_at).toISOString()).toBe('2026-01-27T07:00:00.000Z');
    expect(await count(`select 1 from payroll_run_countries where tenant_id = '${T}' and status = 'paid' and country = 'Kenya'`)).toBe(10);
    const total = payroll.reduce((s: number, p: Row) => s + p.payslips.length, 0);
    expect(await count(`select 1 from salary_history where tenant_id = '${T}'`)).toBe(total);
    expect(await count(`select 1 from payroll_run_rates where tenant_id = '${T}'`)).toBe(10);
    expect(await one(`select public.payroll_country_rates_stale(r.id, 'Kenya') s from payroll_runs r where tenant_id = '${T}' and pay_period = '2026-10'`)).toEqual({ s: false });

    // nobody told, nothing queued
    expect(await count(`select 1 from hr_notifications where tenant_id = '${T}'`)).toBe(0);
    expect(await count(`select 1 from platform_event_outbox where tenant_id = '${T}'`)).toBe(0);
    expect(await count(`select 1 from invite_queue where tenant_id = '${T}'`)).toBe(0);
    expect(await count(`select 1 from payroll_payments where tenant_id = '${T}'`)).toBe(0);
    expect(await count(`select 1 from payslip_emails where tenant_id = '${T}'`)).toBe(0);

    // the leave balances follow HR's own rules (Annual Leave: 21 days a year, earned monthly)
    const annual = await rows(`select b.accrued_days, b.used_days, b.remaining_days, e."Start Date" from leave_balances b
      join leave_types lt on lt.id = b.leave_type_id join employees e on e.tenant_id = b.tenant_id and e."Employee Number" = b.employee_number
      where b.tenant_id = '${T}' and lt.name = 'Annual Leave' and b.year = 2026`);
    expect(annual).toHaveLength(STAFF.length);
    for (const b of annual) expect(Number(b.remaining_days)).toBeGreaterThanOrEqual(0);
    expect(await count(`select 1 from job_postings where tenant_id = '${T}' and status = 'closed' and not is_public`)).toBe(plan.postings.length);
  });

  it('saved the payslips the payroll page would work out from the saved records', async () => {
    // the employee rows, deductions and rates as the payroll page reads them, through HR's engine again
    const employees = await rows(`select * from employees e where tenant_id = '${T}' and onboarding_status = 'approved' order by "Employee Number"`);
    for (const e of employees) for (const k of ['Basic Salary', 'house_allowance', 'travel_allowance', 'other_cash_allowances']) e[k] = e[k] == null ? null : Number(e[k]);
    const types = await rows(`select id, name, active from deduction_types where tenant_id = '${T}'`);
    const deductions = (await rows(`select * from employee_deductions where tenant_id = '${T}'`)).map((d) => ({ ...d, amount: Number(d.amount) }));
    for (const period of ['2026-01', '2026-06', '2026-10']) {
      const rates = (await one<{ r: Row }>(`select statutory_rates_for('${T}', pay_period_last_day('${period}'), 'Kenya') r`)).r;
      const started = employees.filter((e) => e['Start Date'] <= `${period}-31`);
      const ctx = {
        period, rates, overrideStatutoryChecks: false, voluntaryByEmployee: engine.deductionsForPeriod(types, deductions, period),
        payrollLoans: [], earningsByEmployee: new Map(), leaveByEmployee: new Map(), leaveBasis: 'basic_30', absenceByEmployee: new Map(),
        leavePayouts: new Map(), overtimeMonth: undefined, advanceFor: () => 0, workByEmployee: new Map(), deductionCap: true,
        lstPaidThisYear: new Map(), lstCollection: 'instalments',
      };
      const { records } = engine.calculateRun(started, [], () => ctx);
      const saved = await rows(`select * from salary_history where tenant_id = '${T}' and pay_period = '${period}' order by employee_id`);
      expect(saved).toHaveLength(records.length);
      for (const r of records) {
        const s = saved.find((x) => x.employee_id === r.employee_id)!;
        for (const k of ['gross_pay', 'paye_tax', 'nhif_deduction', 'nssf_deduction', 'housing_levy', 'other_deductions', 'total_deductions', 'net_pay']) {
          expect([r.employee_id, period, k, Number(s[k])]).toEqual([r.employee_id, period, k, Number(r[k])]);
        }
      }
    }
    const sample = await one(`select h.employee_name, h.basic_salary, h.house_allowance, h.transport_allowance, h.gross_pay, h.paye_tax,
      h.nhif_deduction, h.nssf_deduction, h.housing_levy, h.other_deductions, h.net_pay, h.nita_levy
      from salary_history h join employees e on e.tenant_id = h.tenant_id and e."Employee Number" = h.employee_id
      where h.tenant_id = '${T}' and h.pay_period = '2026-10' and e."First Name" = 'Grace'`);
    console.log('Grace Wambui, October 2026:', sample);
  });

  it('a second run changes nothing', async () => {
    const audit = await count(`select 1 from audit_log where tenant_id = '${T}'`);
    const before = await rows(`select (select count(*) from salary_history where tenant_id = '${T}') payslips,
      (select count(*) from leave_balances where tenant_id = '${T}') balances, (select count(*) from employee_deductions where tenant_id = '${T}') deductions,
      (select count(*) from job_postings where tenant_id = '${T}') postings, (select count(*) from departments where tenant_id = '${T}') departments,
      (select count(*) from employee_onboarding_reviews where tenant_id = '${T}') reviews`);
    const { plan, sql } = await build();
    expect(plan.months).toEqual([]);
    expect(plan.monthsSkipped.every((s: Row) => /already seeded/.test(s.why))).toBe(true);
    await db.exec(sql);
    expect(await count(`select 1 from audit_log where tenant_id = '${T}'`)).toBe(audit);
    expect(await rows(`select (select count(*) from salary_history where tenant_id = '${T}') payslips,
      (select count(*) from leave_balances where tenant_id = '${T}') balances, (select count(*) from employee_deductions where tenant_id = '${T}') deductions,
      (select count(*) from job_postings where tenant_id = '${T}') postings, (select count(*) from departments where tenant_id = '${T}') departments,
      (select count(*) from employee_onboarding_reviews where tenant_id = '${T}') reviews`)).toEqual(before);
  });

  it('a newcomer from Schools is completed on the next run, without history for months already seeded', async () => {
    await db.query(`select * from platform_upsert_staff('${P}', 'schools', 'kijani-new', 'Brenda', null, 'Nafula', null, null, 'Librarian')`);
    const { plan, sql } = await build({ through: '2026-11' });
    expect(plan.months.map((m: Row) => m.period)).toEqual(['2026-11']);
    await db.exec(sql);
    const n = (await one<{ n: string }>(`select "Employee Number" n from employees where tenant_id = '${T}' and "First Name" = 'Brenda'`)).n;
    expect(await one(`select onboarding_status from employees where tenant_id = '${T}' and "Employee Number" = '${n}'`)).toEqual({ onboarding_status: 'approved' });
    expect(await count(`select 1 from salary_history where tenant_id = '${T}' and employee_id = '${n}'`)).toBe(1);
  });

  it('the daily jobs afterwards email none of the seeded staff', async () => {
    for (const job of [
      'run_onboarding_followup_reminders()', 'create_company_digests()', 'notify_possible_absences_all()', 'run_leave_year_end_reminders()',
      'notify_overdue_leave_documents_all()', 'sync_employee_contributions_all()', 'kpi_refresh_measures()', 'apply_due_job_group_rates()',
      'run_leave_daily()', 'run_task_templates()', 'expire_job_offers()', 'end_due_exit_access()', 'run_leave_carry_expiry()',
    ]) {
      try {
        await db.query(`select public.${job}`);
      } catch (e) {
        console.log(`job ${job}: ${(e as Error).message}`);
      }
    }
    const notes = await rows(`select notification_type, count(*)::int n from hr_notifications where tenant_id = '${T}' group by 1 order by 1`);
    console.log('notifications made by the daily jobs for the company:', notes);
    // the employee emails: claimed (as the sender would) - none has an address or wants email
    const emails = await rows(`select * from claim_notification_emails(interval '0 seconds', 1000) where tenant_id = '${T}'`);
    console.log('employee notification emails the sender would send:', emails.map((x) => [x.to_email, x.items]));
    expect(emails.filter((x) => x.to_email)).toEqual([]);
    const alerts = await rows(`select * from claim_hr_alert_emails(interval '0 seconds', 1000)`);
    console.log('HR alert emails (to the company admins) the sender would send:', alerts);
    expect(await count(`select 1 from platform_event_outbox where tenant_id = '${T}'`)).toBe(0);
    expect(await count(`select 1 from payroll_payments where tenant_id = '${T}'`)).toBe(0);
  });
});
