// @vitest-environment node
//
// Notification emails (20261013800000): what the Edge Function is handed to send, and when. One email per employee
// once their latest notification has settled; claimed once only; the opt-out (except what is always emailed); retries.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const STAFF = '00000000-0000-0000-0000-00000000a201'; // E-ME

let db: PGlite;
let me = '';
type Claim = { employee_number: string; to_email: string; first_name: string; company_name: string; ids: number[]; items: { type: string; title: string }[] };
const claim = async (settle = '2 minutes') =>
  (await db.query<Claim>(`select * from claim_notification_emails(interval '${settle}')`)).rows;
const notify = (type: string, title: string, number = 'E-ME', ago = '5 minutes') =>
  db.exec(`insert into hr_notifications (tenant_id, employee_number, notification_type, title, message, created_at)
           values ('${A}', '${number}', '${type}', '${title}', 'x', now() - interval '${ago}')`);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${STAFF}', 'me@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${STAFF}', 'me@a.co', 'STAFF', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values ('STAFF', array['dashboard'], '${A}');
    insert into employees ("Employee Number", "First Name", "Work Email", tenant_id) values
      ('E-ME', 'Amina', 'me@a.co', '${A}'), ('E-THEM', 'Otieno', 'them@a.co', '${A}');
  `);
  me = (await db.query<{ id: string }>(`select id from employees where "Employee Number" = 'E-ME'`)).rows[0].id;
}, 120000);

beforeEach(async () => {
  await db.exec(`delete from hr_notifications; delete from notification_preferences`);
});

describe('claim_notification_emails', () => {
  it('one email per employee with everything not yet emailed, to their work email', async () => {
    await notify('document_accepted', 'Document accepted', 'E-ME', '6 minutes');
    await notify('document_rejected', 'Document not accepted', 'E-ME', '5 minutes');
    await notify('payslip_ready', 'Payslip ready', 'E-THEM');
    const got = await claim();
    const mine = got.find((c) => c.employee_number === 'E-ME')!;
    expect(got).toHaveLength(2);
    expect(mine).toMatchObject({ to_email: 'me@a.co', first_name: 'Amina' });
    expect(mine.items.map((i) => i.title)).toEqual(['Document accepted', 'Document not accepted']); // oldest first
    expect(await claim()).toEqual([]); // claimed once only
  });

  it('waits until the latest has settled, so a burst is one email', async () => {
    await notify('document_accepted', 'First', 'E-ME', '10 minutes');
    await notify('document_accepted', 'Just now', 'E-ME', '10 seconds');
    expect(await claim()).toEqual([]);
    expect((await claim('5 seconds'))[0].items).toHaveLength(2);
  });

  it('not for someone who turned emails off, except warnings, suspensions and payslips', async () => {
    await asUser(db, STAFF, () => db.query(`insert into notification_preferences (employee_id, email) values ('${me}', false)`));
    await notify('document_accepted', 'Document accepted');
    await notify('warning_issued', 'Warning: Lateness');
    const got = await claim();
    expect(got[0].items.map((i) => i.type)).toEqual(['warning_issued']);
    const skipped = (await db.query<{ email_sent: boolean; email_error: string }>(`select email_sent, email_error from hr_notifications where notification_type = 'document_accepted'`)).rows[0];
    expect(skipped).toEqual({ email_sent: true, email_error: 'not emailed: turned off by the employee' });
  });

  it('never the reminders meant for HR to the employee (they go to HR: email_everything.test.ts)', async () => {
    await notify('contract_expiring', 'Contract ending');
    expect(await claim()).toEqual([]);
    expect((await db.query(`select email_error from hr_notifications`)).rows[0]).toEqual({ email_error: 'not emailed: for HR (emailed to HR)' });
  });

  it('a failed send is tried again, up to 5 times', async () => {
    await notify('document_accepted', 'Document accepted');
    const [{ ids }] = await claim();
    for (let i = 1; i <= 4; i++) {
      await db.query(`select release_notification_emails(array[${ids.join(',')}]::bigint[], 'Resend 500')`);
      expect(await claim()).toHaveLength(1);
    }
    await db.query(`select release_notification_emails(array[${ids.join(',')}]::bigint[], 'Resend 500')`);
    expect(await claim()).toEqual([]); // the fifth failure is the last
    expect((await db.query(`select email_attempts, email_error from hr_notifications`)).rows[0]).toEqual({ email_attempts: 5, email_error: 'Resend 500' });
  });

  it('only the server can claim or release; an employee sets only their own preference', async () => {
    expect(await asUser(db, STAFF, () => db.query(`select claim_notification_emails()`).then(() => '', (e) => (e as Error).message))).toMatch(/permission denied/);
    const them = (await db.query<{ id: string }>(`select id from employees where "Employee Number" = 'E-THEM'`)).rows[0].id;
    expect(await asUser(db, STAFF, () => db.query(`insert into notification_preferences (employee_id, email) values ('${them}', false)`).then(() => '', (e) => (e as Error).message))).toMatch(/row-level security/);
  });
});
