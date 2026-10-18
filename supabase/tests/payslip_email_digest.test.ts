// @vitest-environment node
//
// Payslips emailed with their PDF (FIG-732) and the daily events and birthdays email (FIG-771), migration
// 20261019600000: the payslip-pdfs bucket's access, the queue (who is skipped and why, retries, the server's claim and
// release), the PDFs' clean-up, the digest (once a day, birthdays never to the person themselves and never with the
// year, events N days before and on the day), the company and personal settings, and companies kept apart.
//
// The test database has no storage schema: a minimal stand-in is created just before the migration, so the
// migration's own bucket and policies are applied to it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const PAY = '00000000-0000-0000-0000-00000000d701'; // FINANCE (payroll) in A
const STAFF = '00000000-0000-0000-0000-00000000d702'; // E1 in A
const STAFF2 = '00000000-0000-0000-0000-00000000d703'; // E2 in A (no ID number)
const HR = '00000000-0000-0000-0000-00000000d704'; // HR (employees, no payroll) in A
const PAY_B = '00000000-0000-0000-0000-00000000d705'; // FINANCE in B
const PERIOD = '2026-09';
const FILE = (emp: string, tenant = A) => `${tenant}/${PERIOD}/${emp}.pdf`;

let db: PGlite;
let runId: string;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const one = async <T = Record<string, unknown>>(sql: string) => (await rows<T>(sql))[0];
const attempt = async (sql: string) => {
  try {
    await db.query(sql);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const as = (user: string, sql: string) => asUser(db, user, () => attempt(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));

type Queued = { employee_number: string; status: string; error: string | null; to_email: string | null; attempts: number; pdf_path: string; password_protected: boolean };
const queue = () => rows<Queued>(`select employee_number, status, error, to_email, attempts, pdf_path, password_protected
                                  from payslip_emails where run_id = '${runId}' order by employee_number`);
const statusOf = async (emp: string) => (await queue()).find((q) => q.employee_number === emp)?.status;
const idOf = async (emp: string) => (await one<{ id: number }>(`select id from payslip_emails where run_id = '${runId}' and employee_number = '${emp}'`)).id;
const upload = (user: string, name: string) => as(user, `insert into storage.objects (bucket_id, name, owner) values ('payslip-pdfs', '${name}', auth.uid())`);
type Claim = { id: number; employee_number: string; to_email: string; first_name: string | null; company_name: string; pay_period: string; pdf_path: string; password_protected: boolean; keep_days: number };
const claim = () => rows<Claim>(`select * from claim_payslip_emails(10)`);

beforeAll(async () => {
  db = await bootDb({
    file: '20261019600000_payslip_email_digest.sql',
    seed: async (d) => {
      await d.exec(`
        create schema storage;
        create table storage.buckets (id text primary key, name text, public boolean);
        create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
        alter table storage.objects enable row level security;
        create function storage.foldername(name text) returns text[] language sql immutable as
          $$ select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;
        create function storage.filename(name text) returns text language sql immutable as
          $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
        grant usage on schema storage to anon, authenticated;
        grant all on storage.objects to anon, authenticated;
      `);
    },
  });
  await db.exec(`delete from public.role_permissions where tenant_id = '${A}'`);
  await db.exec(`
    update tenants set name = 'Acme Ltd' where id = '${A}';
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values ('${PAY}', 'pay@a.co'), ('${STAFF}', 'me@a.co'), ('${STAFF2}', 'you@a.co'),
      ('${HR}', 'hr@a.co'), ('${PAY_B}', 'pay@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${PAY}', 'pay@a.co', 'FINANCE', '${A}'), ('${STAFF}', 'me@a.co', 'STAFF', '${A}'), ('${STAFF2}', 'you@a.co', 'STAFF', '${A}'),
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${PAY_B}', 'pay@b.co', 'FINANCE', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('FINANCE', array['payroll'], '${A}'), ('STAFF', array['dashboard'], '${A}'), ('HR', array['employees'], '${A}'),
      ('FINANCE', array['payroll'], '${B}');
    insert into employees ("Employee Number", "First Name", "Middle Name", "Last Name", "Work Email", "ID Number", "Date of Birth", "Status", tenant_id) values
      ('P1', 'Pat', null, 'Payroll', 'pay@a.co', '11111111', '1985-01-05', 'Active', '${A}'),
      ('E1', 'Mia', 'Njeri', 'Me', 'me@a.co', '22222222', '1990-10-20', 'Active', '${A}'),
      ('E2', 'Yusuf', null, 'You', 'you@a.co', null, '1992-03-03', 'Active', '${A}'),
      ('E3', 'Nora', null, 'Nomail', null, '33333333', '17/10/1995', 'Active', '${A}'),
      ('E4', 'Gone', null, 'Away', 'gone@a.co', '44444444', '1980-10-20', 'Terminated', '${A}'),
      ('X1', 'Xena', null, 'Other', 'x@b.co', '55555555', '1991-10-20', 'Active', '${B}'),
      ('X2', 'Xavier', null, 'Bee', 'x2@b.co', '66666666', '1993-06-06', 'Active', '${B}');
    insert into salary_history (employee_id, employee_name, pay_period, basic_salary, gross_pay, net_pay, tenant_id) values
      ('E1', 'Mia Me', '${PERIOD}', 50000, 50000, 40000, '${A}'),
      ('E2', 'Yusuf You', '${PERIOD}', 50000, 50000, 40000, '${A}'),
      ('E3', 'Nora Nomail', '${PERIOD}', 50000, 50000, 40000, '${A}'),
      ('X1', 'Xena Other', '${PERIOD}', 50000, 50000, 40000, '${B}');
  `);
  runId = (await one<{ id: string }>(`select id from payroll_runs where tenant_id = '${A}' and pay_period = '${PERIOD}'`)).id;
}, 120000);

describe('emailing payslips: the queue', () => {
  it('only payroll can email payslips, and only once the month is approved', async () => {
    expect(await as(STAFF, `select queue_payslip_emails('${runId}')`)).toMatch(/Only payroll/);
    expect(await as(HR, `select queue_payslip_emails('${runId}')`)).toMatch(/Only payroll/);
    expect(await as(PAY, `select queue_payslip_emails('${runId}')`)).toMatch(/Approve the payroll/);
    expect(await queue()).toEqual([]);
  });

  it('approving tells people their payslip is ready; queuing adds each payslip, with who is skipped and why', async () => {
    await db.exec(`update payroll_runs set status = 'approved' where id = '${runId}'`);
    expect((await rows(`select 1 from hr_notifications where notification_type = 'payslip_ready' and tenant_id = '${A}'`)).length).toBe(3);

    const summary = await asUser(db, PAY, () => one<{ s: Record<string, unknown> }>(`select queue_payslip_emails('${runId}') as s`));
    expect(summary.s).toMatchObject({ total: 3, waiting_pdf: 1, skipped: 2, sent: 0 });
    expect(summary.s.skipped_people).toEqual([
      { employee_number: 'E2', employee_name: 'Yusuf You', reason: 'Not emailed: no ID number for the PDF password' },
      { employee_number: 'E3', employee_name: 'Nora Nomail', reason: 'Not emailed: no work email' },
    ]);
    expect(await queue()).toEqual([
      { employee_number: 'E1', status: 'waiting_pdf', error: null, to_email: 'me@a.co', attempts: 0, pdf_path: FILE('E1'), password_protected: true },
      expect.objectContaining({ employee_number: 'E2', status: 'skipped', to_email: null }),
      expect.objectContaining({ employee_number: 'E3', status: 'skipped', to_email: null }),
    ]);
  });

  it('the "Payslip ready" notification of a payslip emailed with its PDF is not emailed on its own', async () => {
    const notes = await rows<{ employee_number: string; email_sent: boolean }>(
      `select employee_number, email_sent from hr_notifications where notification_type = 'payslip_ready' order by employee_number`);
    expect(notes).toEqual([
      { employee_number: 'E1', email_sent: true },
      { employee_number: 'E2', email_sent: false },
      { employee_number: 'E3', email_sent: false },
    ]);
  });

  it('payroll sees the progress; staff and other companies do not', async () => {
    expect(await read(PAY, `select employee_number from payslip_emails`)).toHaveLength(3);
    expect(await read(STAFF, `select employee_number from payslip_emails`)).toEqual([]);
    expect(await read(HR, `select employee_number from payslip_emails`)).toEqual([]);
    expect(await read(PAY_B, `select employee_number from payslip_emails`)).toEqual([]);
    expect(await as(STAFF, `update payslip_emails set status = 'sent'`)).toMatch(/permission denied/);
    expect(await as(PAY, `update payslip_emails set status = 'sent'`)).toMatch(/permission denied/);
  });

  it("another company's payroll cannot queue or mark this company's payslips", async () => {
    expect(await as(PAY_B, `select queue_payslip_emails('${runId}')`)).toMatch(/not found/);
    const id = await idOf('E1');
    expect(await read<{ n: number }>(PAY_B, `select payslip_pdfs_uploaded(array[${id}]::bigint[]) as n`)).toEqual([{ n: 0 }]);
  });
});

describe('the payslip-pdfs bucket', () => {
  it('is private', async () => {
    expect(await rows(`select public from storage.buckets where id = 'payslip-pdfs'`)).toEqual([{ public: false }]);
  });

  it('payroll uploads to its own company folder only; staff and HR cannot upload', async () => {
    expect(await upload(STAFF, FILE('E1'))).toMatch(/row-level security/);
    expect(await upload(HR, FILE('E1'))).toMatch(/row-level security/);
    expect(await upload(PAY, FILE('E1', B))).toMatch(/row-level security/);
    expect(await upload(PAY_B, FILE('E1'))).toMatch(/row-level security/);
    expect(await upload(PAY, FILE('E1'))).toBe('');
  });

  it('the employee reads their own PDF only; payroll reads the company folder; others nothing', async () => {
    const names = (user: string) => read<{ name: string }>(user, `select name from storage.objects where bucket_id = 'payslip-pdfs'`);
    expect(await names(STAFF)).toEqual([{ name: FILE('E1') }]);
    expect(await names(STAFF2)).toEqual([]);
    expect(await names(HR)).toEqual([]);
    expect(await names(PAY)).toEqual([{ name: FILE('E1') }]);
    expect(await names(PAY_B)).toEqual([]);
    expect(await as(STAFF, `delete from storage.objects where name = '${FILE('E1')}'`)).toBe('');
    expect(await names(PAY)).toHaveLength(1); // the employee's delete removed nothing
  });
});

describe('sending: claim, retry, finish', () => {
  it('a payslip is ready once its PDF is in the bucket', async () => {
    const e1 = await idOf('E1');
    const e2 = await idOf('E2');
    expect(await as(STAFF, `select payslip_pdfs_uploaded(array[${e1}]::bigint[])`)).toMatch(/Only payroll/);
    // E2 is skipped (not waiting for a PDF), so it is not touched
    expect(await read<{ n: number }>(PAY, `select payslip_pdfs_uploaded(array[${e1}, ${e2}]::bigint[]) as n`)).toEqual([{ n: 1 }]);
    expect(await statusOf('E1')).toBe('pending');
    expect(await statusOf('E2')).toBe('skipped');
  });

  it('not for signed-in users: only the server claims', async () => {
    expect(await as(PAY, `select * from claim_payslip_emails(10)`)).toMatch(/permission denied/);
  });

  it('a reopened month waits; once approved again the server claims it, once', async () => {
    await db.exec(`update payroll_runs set status = 'draft' where id = '${runId}'`);
    expect(await claim()).toEqual([]);
    await db.exec(`update payroll_runs set status = 'approved' where id = '${runId}'`);
    const got = await claim();
    expect(got).toEqual([expect.objectContaining({
      employee_number: 'E1', to_email: 'me@a.co', first_name: 'Mia', company_name: 'Acme Ltd', pay_period: PERIOD,
      pdf_path: FILE('E1'), password_protected: true, keep_days: 0,
    })]);
    expect(await statusOf('E1')).toBe('sending');
    expect(await claim()).toEqual([]);
  });

  it('a failed send goes back to be tried again; after the 5th try it is failed', async () => {
    const id = await idOf('E1');
    await db.exec(`select release_payslip_emails(array[${id}]::bigint[], 'Resend 500', true)`);
    expect((await queue())[0]).toMatchObject({ status: 'pending', attempts: 1, error: 'Resend 500' });
    // a rate limit is not counted as a try
    await claim();
    await db.exec(`select release_payslip_emails(array[${id}]::bigint[], 'Resend 429', false)`);
    expect((await queue())[0]).toMatchObject({ status: 'pending', attempts: 1 });
    for (let i = 0; i < 4; i++) {
      await claim();
      await db.exec(`select release_payslip_emails(array[${id}]::bigint[], 'Resend 500', true)`);
    }
    expect((await queue())[0]).toMatchObject({ status: 'failed', attempts: 5 });
    expect(await claim()).toEqual([]);
  });

  it('pressing "Email payslips" again retries the failed and skipped ones (with the password turned off, E2 can go)', async () => {
    await db.exec(`insert into company_payroll_settings (tenant_id, payslip_pdf_password) values ('${A}', false)
                   on conflict (tenant_id) do update set payslip_pdf_password = false`);
    await asUser(db, PAY, () => db.query(`select queue_payslip_emails('${runId}')`));
    expect(await queue()).toEqual([
      expect.objectContaining({ employee_number: 'E1', status: 'waiting_pdf', attempts: 0, error: null, password_protected: false }),
      expect.objectContaining({ employee_number: 'E2', status: 'waiting_pdf', to_email: 'you@a.co', password_protected: false }),
      expect.objectContaining({ employee_number: 'E3', status: 'skipped', error: 'Not emailed: no work email' }),
    ]);
  });

  it('sent once: finished with the provider id, and never queued again', async () => {
    const id = await idOf('E1');
    await asUser(db, PAY, () => db.query(`select payslip_pdfs_uploaded(array[${id}]::bigint[])`));
    await claim();
    await db.exec(`select finish_payslip_emails(array[${id}]::bigint[], array['re_123'])`);
    expect(await one(`select status, provider_id, sent_at is not null as has_sent_at from payslip_emails where id = ${id}`))
      .toEqual({ status: 'sent', provider_id: 're_123', has_sent_at: true });
    await asUser(db, PAY, () => db.query(`select queue_payslip_emails('${runId}')`));
    expect(await statusOf('E1')).toBe('sent');
  });

  it('an address the server cannot use is skipped, not retried', async () => {
    await db.exec(`update payslip_emails set status = 'pending' where employee_number = 'E2' and run_id = '${runId}'`);
    const id = await idOf('E2');
    await claim();
    await db.exec(`select skip_payslip_emails(array[${id}]::bigint[], 'not emailed: no valid email address')`);
    expect(await statusOf('E2')).toBe('skipped');
  });

  it('the PDF is deleted once sent, or kept for the days the company chose', async () => {
    const id = await idOf('E1');
    expect(await rows(`select id, pdf_path from payslip_pdfs_to_delete(100)`)).toEqual([{ id, pdf_path: FILE('E1') }]);
    await db.exec(`update company_payroll_settings set payslip_pdf_keep_days = 7 where tenant_id = '${A}'`);
    expect(await rows(`select id from payslip_pdfs_to_delete(100)`)).toEqual([]);
    await db.exec(`update payslip_emails set sent_at = now() - interval '8 days' where id = ${id}`);
    expect(await rows(`select id from payslip_pdfs_to_delete(100)`)).toEqual([{ id }]);
    await db.exec(`select mark_payslip_pdfs_deleted(array[${id}]::bigint[])`);
    expect(await rows(`select id from payslip_pdfs_to_delete(100)`)).toEqual([]);
    expect(await as(PAY, `update company_payroll_settings set payslip_pdf_keep_days = 999`)).toMatch(/keep_days_check/);
  });
});

describe('the daily events and birthdays email', () => {
  const DAY = '2026-10-20'; // E1's (and the terminated E4's, and B's X1's) birthday
  type Note = { employee_number: string; title: string; message: string; notification_type: string };
  const digests = (tenant = A) =>
    rows<Note>(`select employee_number, title, message, notification_type from hr_notifications
                where notification_type = 'company_digest' and tenant_id = '${tenant}' order by employee_number`);
  const make = async (day: string) => (await one<{ n: number }>(`select create_company_digests('${day}') as n`)).n;

  beforeEach(async () => {
    await db.exec(`
      delete from hr_notifications where notification_type = 'company_digest';
      delete from company_digest_log; delete from company_events; delete from company_email_settings;
      delete from notification_preferences;
    `);
  });

  it('colleagues hear about a birthday: first and last name only, never the year or an age', async () => {
    await make(DAY);
    const got = await digests();
    // E3 has no work email, E4 has left
    expect(got.map((n) => n.employee_number)).toEqual(['E1', 'E2', 'P1']);
    const e2 = got.find((n) => n.employee_number === 'E2')!;
    expect(e2).toMatchObject({ title: "Today is Mia Me's birthday 🎉", message: "Today is Mia Me's birthday 🎉" });
    for (const n of got) {
      expect(`${n.title} ${n.message}`).not.toMatch(/1990|Njeri|\b36\b|years/);
      expect(`${n.title} ${n.message}`).not.toMatch(/Gone Away|Xena/);
    }
  });

  it('the birthday person is never told about their own birthday; the company wishes them a happy birthday', async () => {
    await make(DAY);
    const e1 = (await digests()).find((n) => n.employee_number === 'E1')!;
    expect(e1.title).toBe('Happy birthday! 🎉');
    expect(e1.message).toBe('Happy birthday from everyone at Acme Ltd! 🎉');
    expect(e1.message).not.toMatch(/Mia Me's birthday/);
  });

  it("it is the employee's own: it does not show in HR's bell", async () => {
    await make(DAY);
    expect(await rows(`select 1 from hr_notifications where notification_type = 'company_digest' and not is_read_admin`)).toEqual([]);
  });

  it('once a day: running it again creates nothing new', async () => {
    expect(await make(DAY)).toBe(5); // 3 in this company, 2 in the other
    expect(await make(DAY)).toBe(0);
    expect(await digests()).toHaveLength(3);
    // the next day is a new day (nothing to say: nothing created)
    expect(await make('2026-10-21')).toBe(0);
  });

  it('only when there is something to say', async () => {
    expect(await make('2026-07-15')).toBe(0);
    expect(await digests()).toEqual([]);
  });

  it('events on the day and a reminder the day before, all in one notification with the birthdays', async () => {
    await db.exec(`insert into company_events (title, date, tenant_id) values
      ('Town hall', '${DAY}', '${A}'), ('Staff party', '2026-10-21', '${A}'), ('Later thing', '2026-10-25', '${A}'),
      ('B only', '${DAY}', '${B}')`);
    await make(DAY);
    const e2 = (await digests()).find((n) => n.employee_number === 'E2')!;
    expect(e2.title).toBe('Today at Acme Ltd');
    expect(e2.message.split('\n')).toEqual(["Today is Mia Me's birthday 🎉", 'Today: Town hall', 'Tomorrow: Staff party']);
  });

  it('the days before is a company setting', async () => {
    await db.exec(`insert into company_events (title, date, tenant_id) values ('Staff party', '2026-10-23', '${A}')`);
    await db.exec(`insert into company_email_settings (tenant_id, event_reminder_days, birthday_emails) values ('${A}', 3, false)`);
    await make(DAY);
    const got = await digests();
    expect(got.find((n) => n.employee_number === 'E2')!.message).toBe('On Friday 23 October: Staff party');
    // birthdays turned off: E1 gets no wish either
    expect(got.find((n) => n.employee_number === 'E1')!.message).toBe('On Friday 23 October: Staff party');
  });

  it('a company can turn both off', async () => {
    await db.exec(`insert into company_events (title, date, tenant_id) values ('Town hall', '${DAY}', '${A}')`);
    await db.exec(`insert into company_email_settings (tenant_id, event_reminders, birthday_emails) values ('${A}', false, false)`);
    await make(DAY);
    expect(await digests()).toEqual([]);
    expect((await digests(B)).length).toBeGreaterThan(0);
  });

  it('a person can leave birthdays, or events, out of theirs', async () => {
    await db.exec(`insert into company_events (title, date, tenant_id) values ('Town hall', '${DAY}', '${A}')`);
    // their own preference row, through the app's rules
    expect(await as(STAFF2, `insert into notification_preferences (employee_id, birthday_emails)
                             select id, false from employees where "Employee Number" = 'E2' and tenant_id = '${A}'`)).toBe('');
    const p1 = (await one<{ id: string }>(`select id from employees where "Employee Number" = 'P1' and tenant_id = '${A}'`)).id;
    expect(await as(STAFF2, `insert into notification_preferences (employee_id, event_emails) values ('${p1}', false)`)).toMatch(/row-level security/);
    await db.exec(`insert into notification_preferences (employee_id, tenant_id, event_emails)
                   select id, tenant_id, false from employees where "Employee Number" = 'P1' and tenant_id = '${A}'`);
    await make(DAY);
    const got = await digests();
    expect(got.find((n) => n.employee_number === 'E2')!.message).toBe('Today: Town hall');
    expect(got.find((n) => n.employee_number === 'P1')!.message).toBe("Today is Mia Me's birthday 🎉");
  });

  it('companies are kept apart', async () => {
    await make(DAY);
    const b = await digests(B);
    expect(b.map((n) => n.employee_number)).toEqual(['X1', 'X2']);
    expect(b.find((n) => n.employee_number === 'X2')!.message).toBe("Today is Xena Other's birthday 🎉");
    expect(b.find((n) => n.employee_number === 'X1')!.message).toBe('Happy birthday from everyone at Other Co! 🎉');
    expect((await digests()).every((n) => !/Xena/.test(n.message))).toBe(true);
  });

  it('company settings: everyone sees them, HR and settings admins change them, staff cannot', async () => {
    expect(await as(HR, `insert into company_email_settings (event_reminder_days) values (2)`)).toBe('');
    expect(await read(STAFF, `select event_reminder_days from company_email_settings`)).toEqual([{ event_reminder_days: 2 }]);
    expect(await as(STAFF, `update company_email_settings set birthday_emails = false`)).toBe('');
    expect(await one(`select birthday_emails from company_email_settings where tenant_id = '${A}'`)).toEqual({ birthday_emails: true });
    expect(await read(PAY_B, `select * from company_email_settings`)).toEqual([]);
    expect(await as(HR, `update company_email_settings set event_reminder_days = 99`)).toMatch(/reminder_days_check/);
  });

  it('it is emailed by the existing pipeline, following the person\'s "My updates" level', async () => {
    await db.exec(`delete from hr_notifications where notification_type <> 'company_digest'`);
    await make(DAY);
    await db.exec(`update hr_notifications set created_at = now() - interval '5 minutes' where notification_type = 'company_digest'`);
    await db.exec(`insert into notification_preferences (employee_id, tenant_id, email_level)
                   select id, tenant_id, 'important' from employees where "Employee Number" = 'P1' and tenant_id = '${A}'`);
    const claims = await rows<{ employee_number: string; items: { type: string }[] }>(
      `select employee_number, items from claim_notification_emails(interval '2 minutes', 100) where tenant_id = '${A}' order by employee_number`);
    expect(claims.map((c) => c.employee_number)).toEqual(['E1', 'E2']);
    expect(claims[0].items.map((i) => i.type)).toEqual(['company_digest']);
  });

  it('dates of birth as the app keeps them, and 29 February', async () => {
    const md = async (v: string) => (await one<{ v: string | null }>(`select birthday_month_day('${v}') as v`)).v;
    expect(await md('1990-10-20')).toBe('10-20');
    expect(await md('1990-10-20T00:00:00Z')).toBe('10-20');
    expect(await md('17/10/1995')).toBe('10-17');
    expect(await md('not a date')).toBeNull();
    expect(await md('1990-13-01')).toBeNull();
    const on = async (dob: string, day: string) => (await one<{ v: boolean }>(`select is_birthday_on('${dob}', '${day}') as v`)).v;
    expect(await on('2000-02-29', '2027-02-28')).toBe(true);
    expect(await on('2000-02-29', '2028-02-28')).toBe(false);
    expect(await on('2000-02-29', '2028-02-29')).toBe(true);
  });

  it('not for signed-in users: only the server makes the digests', async () => {
    expect(await as(HR, `select create_company_digests('${DAY}')`)).toMatch(/permission denied/);
    expect(await as(HR, `select * from company_digest_log`)).toMatch(/permission denied/);
  });
});

describe('the migration', () => {
  it('runs again safely, keeping what is there', async () => {
    const before = (await one<{ n: number }>(`select count(*)::int as n from payslip_emails`)).n;
    await db.exec(readFileSync(join(__dirname, '..', 'migrations', '20261019600000_payslip_email_digest.sql'), 'utf8'));
    await db.exec('reset search_path');
    expect((await one<{ n: number }>(`select count(*)::int as n from payslip_emails`)).n).toBe(before);
    expect(await rows(`select public from storage.buckets where id = 'payslip-pdfs'`)).toEqual([{ public: false }]);
  });
});
