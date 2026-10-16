// @vitest-environment node
//
// Every notification by email too (FIG-890, migration 20261017600000): HR-facing notifications to the HR people who
// look after them (each once, with retries), the employee's own by their chosen level, the unread chat digest, and
// the daily cap.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const ADMIN = '00000000-0000-0000-0000-00000000f001'; // no employee record
const HR = '00000000-0000-0000-0000-00000000f002'; // role HR: leaves + employees; also employee E-HR
const RECR = '00000000-0000-0000-0000-00000000f003'; // role RECRUITER: recruitment only
const STAFF = '00000000-0000-0000-0000-00000000f004'; // employee E-ME
const OTHER = '00000000-0000-0000-0000-00000000f005'; // employee E-THEM

const DM = '00000000-0000-0000-0000-0000000d0001'; // HR and STAFF
const TEAM = '00000000-0000-0000-0000-0000000d0002'; // a channel STAFF and OTHER are members of
const GENERAL = '00000000-0000-0000-0000-0000000d0003'; // public, nobody has joined

let db: PGlite;

type HrClaim = { user_id: string; to_email: string; first_name: string | null; role: string; ids: number[]; items: { type: string; title: string }[] };
type ChatClaim = { id: number; user_id: string; to_email: string; first_name: string | null; items: { channel_id: string; kind: string; name: string; unread: number; mentions: number }[] };
type Claim = { employee_number: string; ids: number[]; items: { type: string }[] };

const notify = (type: string, number = 'E-ME', ago = '5 minutes', title = type) =>
  db.exec(`insert into hr_notifications (tenant_id, employee_number, notification_type, title, message, created_at)
           values ('${A}', '${number}', '${type}', '${title}', 'x', now() - interval '${ago}')`);
const claimHr = async () =>
  (await db.query<HrClaim>(`select * from claim_hr_alert_emails(interval '2 minutes')`)).rows;
const claimOwn = async () => (await db.query<Claim>(`select * from claim_notification_emails(interval '2 minutes')`)).rows;
const claimChat = async () => (await db.query<ChatClaim>(`select * from claim_chat_digest_emails()`)).rows;
const post = (channel: string, author: string, minutesAgo: number, content = 'hello') =>
  db.exec(`insert into messages (tenant_id, channel_id, author_id, author_name, content, created_at)
           values ('${A}', '${channel}', '${author}', (select coalesce(full_name, email) from user_profiles where user_id = '${author}'),
                   '${content}', now() - interval '${minutesAgo} minutes')`);
const markRead = (user: string, channel: string, minutesAgo: number) =>
  db.exec(`insert into user_channel_states (user_id, channel_id, tenant_id, last_read_at)
           values ('${user}', '${channel}', '${A}', now() - interval '${minutesAgo} minutes')
           on conflict (user_id, channel_id) do update set last_read_at = excluded.last_read_at`);
const recipients = (rows: HrClaim[]) => rows.map((r) => r.to_email).sort();

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values
      ('${ADMIN}', 'owner@a.co'), ('${HR}', 'hr@a.co'), ('${RECR}', 'recruit@a.co'), ('${STAFF}', 'me@a.co'), ('${OTHER}', 'them@a.co');
    insert into user_profiles (user_id, email, full_name, role, tenant_id) values
      ('${ADMIN}', 'owner@a.co', 'Grace Owner', 'ADMIN', '${A}'), ('${HR}', 'hr@a.co', 'Hellen Rono', 'HR', '${A}'),
      ('${RECR}', 'recruit@a.co', 'Rita Recruit', 'RECRUITER', '${A}'), ('${STAFF}', 'me@a.co', 'Amina Wanjiru', 'STAFF', '${A}'),
      ('${OTHER}', 'them@a.co', 'Otieno Ouma', 'STAFF', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['leaves', 'employees'], '${A}'), ('RECRUITER', array['recruitment'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", tenant_id) values
      ('E-ME', 'Amina', 'Wanjiru', 'me@a.co', '${A}'), ('E-THEM', 'Otieno', 'Ouma', 'them@a.co', '${A}'),
      ('E-HR', 'Hellen', 'Rono', 'hr@a.co', '${A}');
    -- they joined the company a while ago (a digest only covers messages since someone joined)
    update memberships set created_at = now() - interval '30 days';
    insert into channels (id, tenant_id, name, type, is_private, created_by) values
      ('${DM}', '${A}', 'dm', 'dm', true, '${HR}'),
      ('${TEAM}', '${A}', 'ops', 'channel', false, '${OTHER}'),
      ('${GENERAL}', '${A}', 'general-chat', 'channel', false, null);
    insert into channel_members (channel_id, user_id, tenant_id) values
      ('${DM}', '${HR}', '${A}'), ('${DM}', '${STAFF}', '${A}'), ('${TEAM}', '${STAFF}', '${A}'), ('${TEAM}', '${OTHER}', '${A}');
  `);
}, 120000);

beforeEach(async () => {
  await db.exec(`
    delete from notification_email_deliveries; delete from hr_notifications; delete from email_daily_counts;
    delete from chat_email_state; delete from messages; delete from user_channel_states; delete from chat_email_mutes;
    delete from email_preferences; delete from notification_preferences;
  `);
});

describe('HR-facing notifications are emailed to HR', () => {
  it('a leave to approve: to everyone with the leave module and the admin (no employee record), not to staff', async () => {
    await notify('leave_recommended', 'E-ME', '5 minutes', 'Leave recommended');
    const got = await claimHr();
    expect(recipients(got)).toEqual(['hr@a.co', 'owner@a.co']);
    expect(got.find((c) => c.to_email === 'hr@a.co')).toMatchObject({ first_name: 'Hellen', role: 'HR' });
    expect(got.find((c) => c.to_email === 'owner@a.co')).toMatchObject({ first_name: 'Grace', role: 'ADMIN' });
    expect(got[0].items.map((i) => i.title)).toEqual(['Leave recommended']);
    // never twice, and never to the employee it is about
    expect(await claimHr()).toEqual([]);
    expect(await claimOwn()).toEqual([]);
  });

  it('each type to the module that looks after it', async () => {
    await notify('application_received', 'E-ME');
    expect(recipients(await claimHr())).toEqual(['owner@a.co', 'recruit@a.co']);
    await notify('loan_requested', 'E-ME');
    expect(recipients(await claimHr())).toEqual(['hr@a.co', 'owner@a.co']); // the HR role manages loans
    await notify('contract_signed', 'E-ME');
    expect(recipients(await claimHr())).toEqual(['hr@a.co', 'owner@a.co']);
  });

  it('waits for a burst to settle, then one email per person with all of them', async () => {
    await notify('leave_recommended', 'E-ME', '10 minutes', 'First');
    await notify('contract_expiring', 'E-THEM', '30 seconds', 'Second');
    expect(await claimHr()).toEqual([]);
    await db.exec(`update hr_notifications set created_at = now() - interval '5 minutes'`);
    const got = await claimHr();
    expect(got.find((c) => c.to_email === 'hr@a.co')!.items.map((i) => i.title)).toEqual(['First', 'Second']);
  });

  it('not to the employee it is about, even when they are HR', async () => {
    await notify('exit_requested', 'E-HR');
    expect(recipients(await claimHr())).toEqual(['owner@a.co']);
  });

  it('a failed send is tried again for that person only, up to 5 times', async () => {
    await notify('leave_recommended');
    const got = await claimHr();
    const hr = got.find((c) => c.to_email === 'hr@a.co')!;
    for (let i = 1; i <= 4; i++) {
      await db.query(`select release_email_deliveries($1::bigint[], 'Resend 500')`, [hr.ids]);
      expect(recipients(await claimHr())).toEqual(['hr@a.co']);
    }
    await db.query(`select release_email_deliveries($1::bigint[], 'Resend 500')`, [hr.ids]);
    expect(await claimHr()).toEqual([]);
    const row = (await db.query(`select status, attempts, error from notification_email_deliveries where user_id = '${HR}'`)).rows[0];
    expect(row).toEqual({ status: 'failed', attempts: 5, error: 'Resend 500' });
  });

  it('respects HR alerts off and important only', async () => {
    await db.exec(`insert into email_preferences (user_id, tenant_id, hr_alerts) values ('${HR}', '${A}', 'off'), ('${RECR}', '${A}', 'important')`);
    await notify('leave_recommended');
    await notify('application_received');
    const got = await claimHr();
    expect(got.map((c) => [c.to_email, c.items.map((i) => i.type).sort()]).sort()).toEqual([
      ['owner@a.co', ['application_received', 'leave_recommended']],
    ]);
    const skipped = (await db.query(`select user_id, status, error from notification_email_deliveries where status = 'skipped' order by user_id`)).rows;
    expect(skipped).toEqual([
      { user_id: HR, status: 'skipped', error: 'not emailed: HR alerts turned off' },
      { user_id: RECR, status: 'skipped', error: 'not emailed: gets important ones only' },
    ]);
  });

  it('only the server claims; people set only their own preferences and mutes', async () => {
    expect(await asUser(db, HR, () => db.query(`select claim_hr_alert_emails()`).then(() => '', (e) => (e as Error).message))).toMatch(/permission denied/);
    expect(await asUser(db, HR, () => db.query(`select claim_chat_digest_emails()`).then(() => '', (e) => (e as Error).message))).toMatch(/permission denied/);
    expect(await asUser(db, HR, () => db.query(`select * from notification_email_deliveries`).then(() => '', (e) => (e as Error).message))).toMatch(/permission denied/);
    await asUser(db, HR, () => db.query(`insert into email_preferences (user_id, chat) values ('${HR}', 'important')`));
    expect(await asUser(db, HR, () => db.query(`insert into email_preferences (user_id, chat) values ('${STAFF}', 'off')`).then(() => '', (e) => (e as Error).message))).toMatch(/row-level security/);
    await asUser(db, STAFF, () => db.query(`insert into chat_email_mutes (user_id, channel_id) values ('${STAFF}', '${DM}')`));
    expect((await asUser(db, HR, () => db.query(`select * from chat_email_mutes`))).rows).toEqual([]);
  });
});

describe("the employee's own notifications by level", () => {
  const myId = async () => (await db.query<{ id: string }>(`select id from employees where "Employee Number" = 'E-ME'`)).rows[0].id;

  it('important only: decisions yes, acknowledgements no', async () => {
    await db.exec(`insert into notification_preferences (employee_id, tenant_id, email_level) values ('${await myId()}', '${A}', 'important')`);
    await notify('document_accepted');
    await notify('leave_approved');
    expect((await claimOwn())[0].items.map((i) => i.type)).toEqual(['leave_approved']);
    expect((await db.query(`select email_error from hr_notifications where notification_type = 'document_accepted'`)).rows[0])
      .toEqual({ email_error: 'not emailed: the employee gets important ones only' });
  });

  it('off (the new level or the old switch): only what must be sent', async () => {
    await db.exec(`insert into notification_preferences (employee_id, tenant_id, email) values ('${await myId()}', '${A}', false)`);
    await notify('leave_approved');
    await notify('payslip_ready');
    expect((await claimOwn())[0].items.map((i) => i.type)).toEqual(['payslip_ready']);
    await db.exec(`update notification_preferences set email = true, email_level = 'off'`);
    await notify('leave_rejected');
    await notify('suspended');
    expect((await claimOwn())[0].items.map((i) => i.type)).toEqual(['suspended']);
  });
});

describe('the unread chat digest', () => {
  it('an unread direct message after 10 minutes: one digest, never to the sender', async () => {
    await post(DM, HR, 15);
    await post(DM, HR, 12);
    const got = await claimChat();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ user_id: STAFF, to_email: 'me@a.co', first_name: 'Amina' });
    expect(got[0].items).toEqual([expect.objectContaining({ channel_id: DM, kind: 'dm', name: 'Hellen Rono', unread: 2 })]);
    // the same messages are not emailed again; a new one waits for the 30-minute gap
    expect(await claimChat()).toEqual([]);
    await post(DM, HR, 11);
    expect(await claimChat()).toEqual([]);
  });

  it('not before 10 minutes, and not when read in time', async () => {
    await post(DM, HR, 5);
    expect(await claimChat()).toEqual([]);
    await post(DM, HR, 20);
    await markRead(STAFF, DM, 1);
    expect(await claimChat()).toEqual([]);
  });

  it('member channels count as "N new messages"; @mentions anywhere; important only = DMs and mentions', async () => {
    await post(TEAM, OTHER, 15, 'standup');
    await post(TEAM, OTHER, 14, 'standup again');
    await post(GENERAL, OTHER, 13, 'thanks @Amina Wanjiru for the report');
    await post(GENERAL, OTHER, 13, 'nothing for Amina here');
    const [all] = await claimChat();
    expect(all.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel_id: GENERAL, kind: 'channel', name: 'general-chat', unread: 1, mentions: 1 }),
      expect.objectContaining({ channel_id: TEAM, kind: 'channel', name: 'ops', unread: 2, mentions: 0 }),
    ]));
    expect(all.items).toHaveLength(2);

    await db.exec(`delete from notification_email_deliveries; delete from chat_email_state;
                   insert into email_preferences (user_id, tenant_id, chat) values ('${STAFF}', '${A}', 'important')`);
    const [important] = await claimChat();
    expect(important.items.map((i) => i.channel_id)).toEqual([GENERAL]);
  });

  it('a muted chat, or chat emails off, is skipped', async () => {
    await post(DM, HR, 15);
    await db.exec(`insert into chat_email_mutes (user_id, channel_id, tenant_id) values ('${STAFF}', '${DM}', '${A}')`);
    expect(await claimChat()).toEqual([]);
    await db.exec(`delete from chat_email_mutes; insert into email_preferences (user_id, tenant_id, chat) values ('${STAFF}', '${A}', 'off')`);
    expect(await claimChat()).toEqual([]);
  });

  it('a failed digest is sent again on a later run', async () => {
    await post(DM, HR, 15);
    const [first] = await claimChat();
    await db.query(`select release_email_deliveries(array[${first.id}]::bigint[], 'Resend 500')`);
    const [again] = await claimChat();
    expect(again.id).toBe(first.id);
  });
});

describe('the daily cap', () => {
  it('20 emails a day: the rest wait for the next day, except what must be sent', async () => {
    await db.exec(`insert into email_daily_counts (tenant_id, to_email, day, sent) values ('${A}', 'me@a.co', email_day(), 19)`);
    await notify('leave_approved');
    expect(await claimOwn()).toHaveLength(1); // the 20th
    await notify('leave_rejected');
    await post(DM, HR, 15);
    expect(await claimOwn()).toEqual([]);
    expect(await claimChat()).toEqual([]);
    await notify('payslip_ready');
    expect((await claimOwn())[0].items.map((i) => i.type)).toEqual(['leave_rejected', 'payslip_ready']);

    // the next day: the chat messages held back go in the next digest
    await db.exec(`update email_daily_counts set day = day - 1`);
    expect((await claimChat())[0].items[0]).toMatchObject({ channel_id: DM, unread: 1 });
  });

  it('a failed send gives its email back to the count', async () => {
    await notify('leave_recommended');
    const hr = (await claimHr()).find((c) => c.to_email === 'hr@a.co')!;
    expect((await db.query(`select sent from email_daily_counts where to_email = 'hr@a.co'`)).rows[0]).toEqual({ sent: 1 });
    await db.query(`select release_email_deliveries($1::bigint[], 'Resend 429', false)`, [hr.ids]);
    expect((await db.query(`select sent from email_daily_counts where to_email = 'hr@a.co'`)).rows[0]).toEqual({ sent: 0 });
  });
});

describe('the migration', () => {
  it('can be applied again without changing what is there', async () => {
    await notify('leave_recommended');
    await db.exec(readFileSync(join(__dirname, '..', 'migrations', '20261017600000_email_everything.sql'), 'utf8'));
    await db.exec('reset search_path');
    expect(recipients(await claimHr())).toEqual(['hr@a.co', 'owner@a.co']);
  });
});
