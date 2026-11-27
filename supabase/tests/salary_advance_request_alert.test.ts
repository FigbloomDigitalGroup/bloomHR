// @vitest-environment node
//
// Admins and finance hear of every salary advance request as it is made (20261127100000, 20261127200000): one HR
// alert, emailed to the company's admins and the roles with "Payments to make" (not the approvers: the chain already
// tells them), never shown or emailed to the employee who asked. An advance
// recorded as already approved writes none.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000e001';
const FIN = '00000000-0000-0000-0000-00000000e002';
const ADMIN = '00000000-0000-0000-0000-00000000e003';
const S1 = '00000000-0000-0000-0000-00000000e004';
const ADMINB = '00000000-0000-0000-0000-00000000e006';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const alerts = () => rows<{ id: number; tenant_id: string; employee_number: string; title: string; message: string }>(
  `select id, tenant_id, employee_number, title, message from hr_notifications
   where notification_type = 'salary_advance_requested' order by id`);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${HR}', 'hr@a.co'), ('${FIN}', 'fin@a.co'), ('${ADMIN}', 'admin@a.co'), ('${S1}', 's1@a.co'), ('${ADMINB}', 'admin@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${FIN}', 'fin@a.co', 'CHECKER', '${A}'), ('${ADMIN}', 'admin@a.co', 'ADMIN', '${A}'),
      ('${S1}', 's1@a.co', 'STAFF', '${A}'), ('${ADMINB}', 'admin@b.co', 'ADMIN', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees', 'salaryadmin'], '${A}'), ('CHECKER', array['payments'], '${A}'),
      ('STAFF', array['dashboard'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Basic Salary", onboarding_status, tenant_id) values
      ('H1', 'Hana', 'Hr', 'hr@a.co', 100000, 'approved', '${A}'),
      ('E1', 'Esther', 'One', 's1@a.co', 60000, 'approved', '${A}');
  `);
}, 120000);

describe('a salary advance request', () => {
  it('writes one alert for the company, naming the request', async () => {
    await db.exec(`insert into salary_advance ("Employee Number", "Full Name", "Amount Requested", "Reason for Advance", tenant_id)
      values ('E1', 'Esther One', 10000, 'School fees', '${A}')`);
    const a = await alerts();
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ tenant_id: A, employee_number: 'E1', title: 'Salary advance requested' });
    expect(a[0].message).toBe(
      "Esther One's salary advance of KES 10,000.00 was requested (School fees). It is waiting on its approvers in Salary Advance.");
  });

  it('is an important HR alert, so the employee never sees it', async () => {
    const r = (await rows<{ hr: boolean; imp: boolean }>(
      `select public.hr_only_notification('salary_advance_requested') as hr, public.important_notification('salary_advance_requested') as imp`))[0];
    expect(r).toEqual({ hr: true, imp: true });
  });

  it("is emailed to that company's admins and finance: not to the approvers, the employee or another company", async () => {
    const to = (await rows<{ user_id: string }>(`select user_id from public.hr_alert_recipients($1, 'salary_advance_requested')`, [A]))
      .map((r) => r.user_id).sort();
    expect(to).toEqual([FIN, ADMIN].sort());
    await db.query(`select public.queue_hr_alert_emails()`);
    const sent = await rows<{ user_id: string; to_email: string; status: string }>(
      `select d.user_id, d.to_email, d.status from notification_email_deliveries d
       join hr_notifications n on n.id = d.notification_id
       where n.notification_type = 'salary_advance_requested'`);
    expect(sent.sort((a, b) => a.user_id.localeCompare(b.user_id))).toEqual([
      { user_id: FIN, to_email: 'fin@a.co', status: 'pending' },
      { user_id: ADMIN, to_email: 'admin@a.co', status: 'pending' },
    ].sort((a, b) => a.user_id.localeCompare(b.user_id)));
  });

  it('the approvers are still told by the chain', async () => {
    const told = await rows<{ employee_number: string }>(
      `select employee_number from hr_notifications where notification_type = 'approval_needed' and title like 'Salary advance%'`);
    expect(told.map((r) => r.employee_number)).toEqual(['H1']);
  });

  it('an advance recorded as already approved writes no alert', async () => {
    await db.exec(`insert into salary_advance ("Employee Number", "Amount Requested", status, tenant_id) values ('E1', 3000, 'approved', '${A}')`);
    expect(await alerts()).toHaveLength(1);
  });

  it('a quiet load writes no alert', async () => {
    await db.exec(`begin; set local app.approval_quiet = 'on';
      insert into salary_advance ("Employee Number", "Amount Requested", tenant_id) values ('E1', 4000, '${A}'); commit;`);
    expect(await alerts()).toHaveLength(1);
  });
});
