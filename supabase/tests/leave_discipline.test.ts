// @vitest-environment node
//
// Leave discipline (FIG-881): absences recorded by HR or the supervisor (unexcused absence, failure to notify),
// excused by HR, unexcused days off pay, leave documents gone overdue (HR told once per application), and warnings
// issued for any of these, linked to the record.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000fd01';
const SUP = '00000000-0000-0000-0000-00000000fd02';
const STAFF = '00000000-0000-0000-0000-00000000fd03';
const PAY = '00000000-0000-0000-0000-00000000fd04';
const HR_B = '00000000-0000-0000-0000-00000000fd05';
const DISC = '00000000-0000-0000-0000-00000000fd06';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const run = async (sql: string) => {
  try {
    await db.query(sql);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const q = (s: string | null) => (s === null ? 'null' : `'${s.replace(/'/g, "''")}'`);
const record = (user: string, emp: string, kind: string, start: string, end: string, note: string | null = null) =>
  asUser(db, user, () => run(`select record_absence(${q(emp)}, ${q(kind)}, '${start}', '${end}', ${q(note)})`));
const absence = async (emp: string, start: string) =>
  (await rows<{ id: string; days: string; status: string; leave_application_id: string | null }>(
    `select id, days, status, leave_application_id from leave_absences where employee_number = '${emp}' and start_date = '${start}'`))[0];
const payFor = async (period: string, user = PAY) =>
  asUser(db, user, () => rows<{ employee_number: string; absence_days: string; month_working_days: string; absences: { id: string; days_in_month: number }[] }>(
    `select * from absence_pay_deductions('${period}')`));

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return iso(d);
};
/** n days ago, or the weekday before it */
const weekdayAgo = (n: number) => {
  let k = n;
  while ([0, 6].includes(new Date(`${daysAgo(k)}T00:00:00Z`).getUTCDay())) k += 1;
  return daysAgo(k);
};

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${SUP}', 'sup@a.co'), ('${STAFF}', 'me@a.co'),
      ('${PAY}', 'pay@a.co'), ('${HR_B}', 'hr@b.co'), ('${DISC}', 'disc@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${SUP}', 'sup@a.co', 'STAFF', '${A}'), ('${STAFF}', 'me@a.co', 'STAFF', '${A}'),
      ('${PAY}', 'pay@a.co', 'FINANCE', '${A}'), ('${HR_B}', 'hr@b.co', 'HR', '${B}'), ('${DISC}', 'disc@a.co', 'DISC', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['leaves', 'employees'], '${A}'), ('STAFF', array['dashboard'], '${A}'), ('FINANCE', array['payroll'], '${A}'),
      ('DISC', array['staffcheck'], '${A}'), ('HR', array['leaves', 'employees'], '${B}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", manager_email, tenant_id) values
      ('ME', 'Mia', 'Me', 'me@a.co', 'sup@a.co', '${A}'), ('YOU', 'Yusuf', 'You', 'you@a.co', null, '${A}'),
      ('SUPE', 'Sam', 'Sup', 'sup@a.co', null, '${A}'), ('FARM', 'Faith', 'Farm', 'farm@a.co', 'sup@a.co', '${A}'),
      ('OTHER', 'Otto', 'Other', 'o@b.co', null, '${B}');
    select seed_default_leave_types('${A}');
    select seed_default_leave_types('${B}');
    -- no public holidays (auto-added for this year and next), so the day counts are plain work weeks
    delete from holidays;
    -- the farm works a half day on Saturdays
    insert into departments (tenant_id, name, work_week) values ('${A}', 'Farm', '{1,1,1,1,1,0.5,0}');
    update employees set department_id = (select id from departments where tenant_id = '${A}' and name = 'Farm')
      where "Employee Number" = 'FARM';
  `);
}, 120000);

describe('recording absences', () => {
  it('HR records an unexcused absence; the days are working days and the employee is told', async () => {
    // Thu 5 - Mon 9 March 2026: Thu, Fri, Mon
    expect(await record(HR, 'ME', 'unexcused_absence', '2026-03-05', '2026-03-09', 'No call, no show')).toBe('');
    expect(await absence('ME', '2026-03-05')).toMatchObject({ days: '3', status: 'recorded' });
    const n = await rows<{ notification_type: string; title: string; message: string }>(
      `select notification_type, title, message from hr_notifications where employee_number = 'ME' order by id desc limit 1`);
    expect(n[0]).toMatchObject({ notification_type: 'employment_update', title: 'Unexcused absence recorded' });
    expect(n[0].message).toMatch(/5 Mar - 9 Mar 2026 \(3 working days\).*No call, no show/);
  });

  it("days follow the employee's work week (a half-day Saturday counts half)", async () => {
    // Fri 6 - Mon 9 March: Fri 1 + Sat 0.5 + Mon 1
    expect(await record(HR, 'FARM', 'unexcused_absence', '2026-03-06', '2026-03-09')).toBe('');
    expect((await absence('FARM', '2026-03-06')).days).toBe('2.5');
  });

  it('holidays are left out, and a range with no working days is refused', async () => {
    await db.exec(`insert into holidays (tenant_id, name, date) values ('${A}', 'Test Day', '2026-03-16')`);
    expect(await record(HR, 'YOU', 'unexcused_absence', '2026-03-16', '2026-03-17')).toBe('');
    expect((await absence('YOU', '2026-03-16')).days).toBe('1');
    expect(await record(HR, 'YOU', 'unexcused_absence', '2026-03-14', '2026-03-15')).toMatch(/not working days/);
    await db.exec(`delete from holidays where name = 'Test Day'`);
  });

  it('the supervisor records for their team only; staff and the employee cannot', async () => {
    expect(await record(SUP, 'ME', 'failed_to_notify', '2026-03-10', '2026-03-10')).toBe('');
    expect(await record(SUP, 'YOU', 'failed_to_notify', '2026-03-10', '2026-03-10')).toMatch(/Only HR or the employee's supervisor/);
    expect(await record(STAFF, 'YOU', 'unexcused_absence', '2026-03-10', '2026-03-10')).toMatch(/Only HR or the employee's supervisor/);
    expect(await record(STAFF, 'ME', 'unexcused_absence', '2026-03-11', '2026-03-11')).toMatch(/Only HR or the employee's supervisor/);
    // and nobody writes the table directly
    expect(await asUser(db, HR, () => run(`insert into leave_absences (employee_number, kind, start_date, end_date) values ('YOU', 'unexcused_absence', '2026-03-03', '2026-03-03')`)))
      .toMatch(/permission denied|row-level security/);
    expect(await asUser(db, HR, () => run(`update leave_absences set status = 'excused'`))).toMatch(/permission denied|row-level security/);
  });

  it('refuses the future, overlaps, and days of approved leave', async () => {
    expect(await record(HR, 'YOU', 'unexcused_absence', daysAgo(-3), daysAgo(-3))).toMatch(/days still to come/);
    expect(await record(HR, 'ME', 'unexcused_absence', '2026-03-09', '2026-03-09')).toMatch(/overlapping unexcused absence/);
    await asUser(db, HR, () => db.query(`insert into leave_application ("Employee Number", name, "Leave Type", "Start Date", "End Date", status)
      values ('YOU', 'Yusuf', 'Annual Leave', '2026-03-23', '2026-03-24', 'approved')`));
    expect(await record(HR, 'YOU', 'unexcused_absence', '2026-03-24', '2026-03-25')).toMatch(/approved leave/);
  });

  it('each sees what they may: HR all, the supervisor their team, the employee their own', async () => {
    const list = (u: string) => asUser(db, u, () => rows<{ employee_number: string }>(`select employee_number from leave_absences_list('2026-01-01')`));
    expect(new Set((await list(HR)).map((r) => r.employee_number))).toEqual(new Set(['ME', 'FARM', 'YOU']));
    expect(new Set((await list(SUP)).map((r) => r.employee_number))).toEqual(new Set(['ME', 'FARM']));
    expect(await list(STAFF)).toEqual([]);
    const own = await asUser(db, STAFF, () => rows<{ kind: string }>(`select kind from leave_absences order by kind`));
    expect(own.map((r) => r.kind)).toEqual(['failed_to_notify', 'unexcused_absence']);
  });
});

describe('excusing', () => {
  it('only HR excuses; the employee is told', async () => {
    const a = await absence('YOU', '2026-03-16');
    expect(await asUser(db, SUP, () => run(`select excuse_absence('${a.id}', 'Doctor''s note')`))).toMatch(/Only HR/);
    expect(await asUser(db, HR, () => run(`select excuse_absence('${a.id}', 'Doctor''s note')`))).toBe('');
    expect((await absence('YOU', '2026-03-16')).status).toBe('excused');
    expect(await asUser(db, HR, () => run(`select excuse_absence('${a.id}')`))).toMatch(/already excused/);
    const n = await rows<{ title: string }>(`select title from hr_notifications where employee_number = 'YOU' order by id desc limit 1`);
    expect(n[0].title).toBe('Unexcused absence excused');
  });

  it('can turn the absence into approved leave', async () => {
    expect(await record(HR, 'YOU', 'unexcused_absence', '2026-04-06', '2026-04-07')).toBe('');
    const a = await absence('YOU', '2026-04-06');
    expect(await asUser(db, HR, () => run(`select excuse_absence('${a.id}', 'Was sick', 'Annual Leave')`))).toBe('');
    const after = await absence('YOU', '2026-04-06');
    expect(after.status).toBe('excused');
    const leave = await rows<{ status: string; 'Leave Type': string; days: string }>(
      `select status, "Leave Type", days from leave_application where id = '${after.leave_application_id}'`);
    expect(leave[0]).toMatchObject({ status: 'approved', 'Leave Type': 'Annual Leave' });
    expect(Number(leave[0].days)).toBe(2);
  });

  it('a mistaken record is removed by HR or whoever recorded it', async () => {
    expect(await record(SUP, 'FARM', 'failed_to_notify', '2026-03-12', '2026-03-12')).toBe('');
    const a = await absence('FARM', '2026-03-12');
    expect(await asUser(db, STAFF, () => run(`select delete_absence('${a.id}')`))).toMatch(/Only HR, or whoever recorded it/);
    expect(await asUser(db, SUP, () => run(`select delete_absence('${a.id}')`))).toBe('');
    expect(await absence('FARM', '2026-03-12')).toBeUndefined();
  });
});

describe('unexcused absence in payroll', () => {
  it('only unexcused absence still recorded counts (not excused, not failure to notify)', async () => {
    const march = await payFor('2026-03');
    // ME: 3 days (the failure to notify on the 10th is not deducted); FARM: 2.5; YOU's absence was excused
    expect(march.map((r) => [r.employee_number, r.absence_days])).toEqual([['FARM', '2.5'], ['ME', '3']]);
    expect(march.find((r) => r.employee_number === 'ME')!.month_working_days).toBe('22');
    expect(march.find((r) => r.employee_number === 'FARM')!.month_working_days).toBe('24');
    expect(await payFor('2026-04')).toEqual([]);
  });

  it('an absence across the month end is split by month', async () => {
    expect(await record(HR, 'YOU', 'unexcused_absence', '2026-04-29', '2026-05-04')).toBe('');
    expect((await payFor('2026-04')).map((r) => [r.employee_number, r.absence_days])).toEqual([['YOU', '2']]);
    expect((await payFor('2026-05')).map((r) => [r.employee_number, r.absence_days])).toEqual([['YOU', '2']]);
  });

  it('nothing when the company does not deduct them', async () => {
    expect(await asUser(db, PAY, () => run(`insert into company_payroll_settings (deduct_unexcused_absence) values (false)`))).toBe('');
    expect(await payFor('2026-03')).toEqual([]);
    await asUser(db, PAY, () => db.query(`update company_payroll_settings set deduct_unexcused_absence = true`));
    expect((await payFor('2026-03')).length).toBe(2);
  });

  it('only payroll may ask', async () => {
    expect(await asUser(db, HR, () => run(`select * from absence_pay_deductions('2026-03')`))).toMatch(/Only payroll/);
    expect(await asUser(db, PAY, () => run(`select * from absence_pay_deductions('March')`))).toMatch(/should look like/);
  });
});

describe('overdue leave documents', () => {
  it('lists applications missing a required document and tells HR once per application', async () => {
    const start = weekdayAgo(20);
    // HR enters sick leave without the report (needed with the application)
    await asUser(db, HR, () => db.query(`insert into leave_application ("Employee Number", name, "Leave Type", "Start Date", "End Date", status)
      values ('ME', 'Mia', 'Sick Leave', '${start}', '${start}', 'approved')`));
    // paternity: the birth notification, here due 7 days after the leave starts
    await db.exec(`update leave_policies set document_when = 'after', document_within_days = 7
      where leave_type_id = (select id from leave_types where tenant_id = '${A}' and name = 'Paternity Leave')`);
    await asUser(db, HR, () => db.query(`insert into leave_application ("Employee Number", name, "Leave Type", "Start Date", "End Date", status)
      values ('YOU', 'Yusuf', 'Paternity Leave', '${daysAgo(10)}', '${daysAgo(10)}', 'approved'),
             ('FARM', 'Faith', 'Paternity Leave', '${daysAgo(3)}', '${daysAgo(3)}', 'approved')`));

    const list = await asUser(db, HR, () => rows<{ employee_number: string; leave_type: string; document_kind: string; due_date: string }>(
      `select employee_number, leave_type, document_kind, due_date::text from overdue_leave_documents()`));
    // FARM's isn't due yet
    expect(list.map((r) => [r.employee_number, r.leave_type])).toEqual(expect.arrayContaining([['ME', 'Sick Leave'], ['YOU', 'Paternity Leave']]));
    expect(list.some((r) => r.employee_number === 'FARM')).toBe(false);
    // paternity is counted in calendar days: due 7 days after it started
    expect(list.find((r) => r.employee_number === 'YOU')!.due_date).toBe(daysAgo(3));

    expect(await asUser(db, HR, () => rows<{ n: number }>(`select check_overdue_leave_documents() n`))).toEqual([{ n: 2 }]);
    // again (page load, or the daily job): nothing new
    expect(await asUser(db, HR, () => rows<{ n: number }>(`select check_overdue_leave_documents() n`))).toEqual([{ n: 0 }]);
    expect(await rows<{ n: number }>(`select notify_overdue_leave_documents_all() n`)).toEqual([{ n: 0 }]);
    const notes = await rows<{ employee_number: string; message: string }>(
      `select employee_number, message from hr_notifications where notification_type = 'leave_document_overdue' order by employee_number`);
    expect(notes.map((n) => n.employee_number)).toEqual(['ME', 'YOU']);
    expect(notes[0].message).toMatch(/Report from a registered medical practitioner.*due with the application/);
    expect((await rows<{ v: boolean }>(`select hr_only_notification('leave_document_overdue') v`))[0].v).toBe(true);
    expect((await rows<{ v: string[] }>(`select hr_alert_modules('leave_document_overdue') v`))[0].v).toEqual(['leaves']);
  });

  it('a document added takes it off the list; rejected leave is not listed', async () => {
    const leave = (await rows<{ id: string }>(`select id from leave_application where "Employee Number" = 'YOU' and "Leave Type" = 'Paternity Leave'`))[0];
    await asUser(db, HR, () => db.query(`select attach_leave_document('${leave.id}', 'main', '${A}/${HR}/birth.pdf', 'birth.pdf')`));
    await asUser(db, HR, () => db.query(`update leave_application set status = 'rejected' where "Employee Number" = 'ME' and "Leave Type" = 'Sick Leave'`));
    expect(await asUser(db, HR, () => rows(`select * from overdue_leave_documents()`))).toEqual([]);
  });

  it('only HR sees the list', async () => {
    expect(await asUser(db, SUP, () => run(`select * from overdue_leave_documents()`))).toMatch(/Only HR/);
    expect(await asUser(db, STAFF, () => run(`select check_overdue_leave_documents()`))).toMatch(/Only HR/);
  });
});

describe('warnings', () => {
  it('HR issues a warning for an absence; it is linked to it and the employee is notified', async () => {
    const a = await absence('ME', '2026-03-05');
    expect(await asUser(db, HR, () => run(
      `select issue_discipline_warning('${a.id}', null, 'Unexcused absence', 'medium', 'You were absent without leave.')`))).toBe('');
    const w = await rows<{ employee_id: string; absence_id: string; type: string }>(`select employee_id, absence_id, type from warnings`);
    expect(w).toEqual([{ employee_id: 'ME', absence_id: a.id, type: 'Unexcused absence' }]);
    const n = await rows<{ notification_type: string }>(`select notification_type from hr_notifications where employee_number = 'ME' order by id desc limit 1`);
    expect(n[0].notification_type).toBe('warning_issued');
    const listed = await asUser(db, HR, () => rows<{ warnings: number }>(`select warnings from leave_absences_list('2026-01-01') where id = '${a.id}'`));
    expect(listed[0].warnings).toBe(1);
  });

  it('for a leave application without its document, too (the Disciplinary module may issue them)', async () => {
    const leave = (await rows<{ id: string }>(`select id from leave_application where "Employee Number" = 'ME' and "Leave Type" = 'Sick Leave'`))[0];
    expect(await asUser(db, DISC, () => run(
      `select issue_discipline_warning(null, '${leave.id}', 'Leave without the required document', 'low', 'Bring the report.')`))).toBe('');
    expect(await rows(`select employee_id, leave_application_id from warnings where leave_application_id is not null`))
      .toEqual([{ employee_id: 'ME', leave_application_id: leave.id }]);
  });

  it('supervisors and staff cannot; one record at a time; a message is needed', async () => {
    const a = await absence('ME', '2026-03-05');
    expect(await asUser(db, SUP, () => run(`select issue_discipline_warning('${a.id}', null, 'X', 'low', 'Y')`))).toMatch(/Only HR/);
    expect(await asUser(db, STAFF, () => run(`select issue_discipline_warning('${a.id}', null, 'X', 'low', 'Y')`))).toMatch(/Only HR/);
    expect(await asUser(db, HR, () => run(`select issue_discipline_warning(null, null, 'X', 'low', 'Y')`))).toMatch(/one absence or one leave/);
    expect(await asUser(db, HR, () => run(`select issue_discipline_warning('${a.id}', null, 'X', 'low', '  ')`))).toMatch(/Write the warning/);
    expect(await asUser(db, HR, () => run(`select issue_discipline_warning('${a.id}', null, 'X', 'severe', 'Y')`))).toMatch(/Severity/);
  });

  it('per employee counts for the last 12 months', async () => {
    const counts = await asUser(db, HR, () => rows<{ employee_number: string; unexcused_absences: number; unexcused_days: string; failed_to_notify: number; missing_documents: number; warnings: number }>(
      `select * from leave_discipline_counts()`));
    const me = counts.find((c) => c.employee_number === 'ME')!;
    // the absences were in March 2026: within 12 months while this test is younger than that, so check only what is
    // stable: one overdue document notice and two warnings, now
    expect(me).toMatchObject({ missing_documents: 1, warnings: 2 });
    const sup = await asUser(db, SUP, () => rows<{ employee_number: string }>(`select employee_number from leave_discipline_counts()`));
    expect(sup.every((c) => ['ME', 'FARM'].includes(c.employee_number))).toBe(true);
  });
});

describe('company isolation', () => {
  it("another company's HR sees and changes none of it", async () => {
    const a = await absence('ME', '2026-03-05');
    expect(await asUser(db, HR_B, () => rows(`select * from leave_absences`))).toEqual([]);
    expect(await asUser(db, HR_B, () => rows(`select * from leave_absences_list('2000-01-01')`))).toEqual([]);
    expect(await asUser(db, HR_B, () => rows(`select * from overdue_leave_documents()`))).toEqual([]);
    expect(await asUser(db, HR_B, () => rows(`select * from leave_discipline_counts()`))).toEqual([]);
    expect(await asUser(db, HR_B, () => run(`select excuse_absence('${a.id}')`))).toMatch(/No such absence/);
    expect(await asUser(db, HR_B, () => run(`select delete_absence('${a.id}')`))).toMatch(/No such absence/);
    expect(await asUser(db, HR_B, () => run(`select issue_discipline_warning('${a.id}', null, 'X', 'low', 'Y')`))).toMatch(/No such absence/);
    expect(await asUser(db, HR_B, () => run(`select record_absence('ME', 'unexcused_absence', '2026-03-02', '2026-03-02')`))).toMatch(/No such employee/);
  });
});
