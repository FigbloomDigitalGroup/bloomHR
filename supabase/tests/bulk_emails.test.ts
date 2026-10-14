// @vitest-environment node
//
// Email throughput (20261014500000): the company-wide email queue (queue, claim with SKIP LOCKED, retries, finish)
// and notification releases that do not use up a try (Resend's rate limit).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b3';
const HR = '00000000-0000-0000-0000-00000000a401';

let db: PGlite;
type Queued = { bulk_email_id: string | null; queued: number; skipped: number };
type Claimed = { id: number; bulk_email_id: string; tenant_id: string; to_email: string };

const queue = async (emails: string[], tenant = A) =>
  (
    await db.query<Queued>(`select * from queue_bulk_email($1, $2, 'email-portal', 'HR <hr@a.co>', 'Hello', '<p>Hi</p>', '[]'::jsonb, $3)`, [
      tenant,
      HR,
      emails,
    ])
  ).rows[0];
const claim = async (limit = 100) => (await db.query<Claimed>(`select * from claim_bulk_emails($1)`, [limit])).rows;
const release = (ids: number[], count = true) => db.query(`select release_bulk_emails($1::bigint[], 'Resend 500', $2)`, [ids, count]);
const statuses = async () =>
  (await db.query<{ to_email: string; status: string; attempts: number }>(`select to_email, status, attempts from bulk_email_recipients order by id`)).rows;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${HR}', 'hr@a.co', 'HR', '${A}');
    insert into employees ("Employee Number", "First Name", "Work Email", tenant_id) values
      ('E1', 'Amina', 'amina@a.co', '${A}'), ('E2', 'Otieno', ' Otieno@A.co ', '${A}'), ('E3', 'Wanjiru', 'wanjiru@a.co', '${A}'),
      ('E4', 'Nobody', '', '${A}');
    insert into employees ("Employee Number", "First Name", "Work Email", tenant_id) values ('X1', 'Outsider', 'out@b.co', '${B}');
  `);
}, 120000);

beforeEach(async () => {
  await db.exec(`delete from bulk_emails; delete from hr_notifications`);
});

describe('queue_bulk_email', () => {
  it("queues only the company's own employees' work emails, each once", async () => {
    const got = await queue(['amina@a.co', 'AMINA@a.co', 'otieno@a.co', 'out@b.co', 'stranger@x.co']);
    expect(got).toMatchObject({ queued: 2, skipped: 2 });
    expect((await statuses()).map((r) => [r.to_email, r.status])).toEqual([
      ['amina@a.co', 'queued'],
      ['Otieno@A.co', 'queued'], // as recorded on the employee, trimmed
    ]);
    const job = (await db.query<{ recipient_count: number; tenant_id: string }>(`select recipient_count, tenant_id from bulk_emails`)).rows[0];
    expect(job).toEqual({ recipient_count: 2, tenant_id: A });
  });

  it('queues nothing when nobody matches', async () => {
    expect(await queue(['out@b.co'])).toEqual({ bulk_email_id: null, queued: 0, skipped: 1 });
    expect((await db.query(`select count(*)::int as n from bulk_emails`)).rows[0]).toEqual({ n: 0 });
  });
});

describe('claim_bulk_emails', () => {
  it('claims each recipient once, oldest first, in pieces', async () => {
    await queue(['amina@a.co', 'otieno@a.co', 'wanjiru@a.co']);
    const first = await claim(2);
    expect(first.map((c) => c.to_email)).toEqual(['amina@a.co', 'Otieno@A.co']);
    expect(first[0].tenant_id).toBe(A);
    expect((await claim(2)).map((c) => c.to_email)).toEqual(['wanjiru@a.co']);
    expect(await claim()).toEqual([]);
  });

  it('marks them sent with the provider id', async () => {
    await queue(['amina@a.co', 'otieno@a.co']);
    const ids = (await claim()).map((c) => c.id);
    await db.query(`select finish_bulk_emails($1::bigint[], $2::text[])`, [ids, ['re_1', 're_2']]);
    const rows = (await db.query<{ status: string; provider_id: string }>(`select status, provider_id from bulk_email_recipients order by id`)).rows;
    expect(rows).toEqual([{ status: 'sent', provider_id: 're_1' }, { status: 'sent', provider_id: 're_2' }]);
    expect(await claim()).toEqual([]);
  });

  it('retries a failed send up to 5 times; a rate-limited one does not use up a try', async () => {
    await queue(['amina@a.co']);
    let [{ id }] = await claim();
    await release([id], false);
    expect((await statuses())[0]).toMatchObject({ status: 'queued', attempts: 0 });
    for (let i = 1; i <= 4; i++) {
      [{ id }] = await claim();
      await release([id]);
      expect((await statuses())[0]).toMatchObject({ status: 'queued', attempts: i });
    }
    [{ id }] = await claim();
    await release([id]);
    expect((await statuses())[0]).toMatchObject({ status: 'failed', attempts: 5 });
    expect(await claim()).toEqual([]);
  });

  it('takes back one left sending by a run that died, after 15 minutes', async () => {
    await queue(['amina@a.co']);
    await claim();
    expect(await claim()).toEqual([]);
    await db.exec(`update bulk_email_recipients set claimed_at = now() - interval '16 minutes'`);
    expect(await claim()).toHaveLength(1);
  });
});

describe('notification releases', () => {
  it('a rate-limited send goes back without using up a try', async () => {
    await db.exec(`insert into hr_notifications (tenant_id, employee_number, notification_type, title, message, created_at)
                   values ('${A}', 'E1', 'document_accepted', 'Accepted', 'x', now() - interval '5 minutes')`);
    const [{ ids }] = (await db.query<{ ids: number[] }>(`select ids from claim_notification_emails(interval '2 minutes', 100)`)).rows;
    await db.query(`select release_notification_emails($1::bigint[], 'Resend 429', false)`, [ids]);
    expect((await db.query(`select email_sent, email_attempts from hr_notifications`)).rows[0]).toEqual({ email_sent: false, email_attempts: 0 });
  });
});

describe('access', () => {
  it('only the server can queue, claim or read the queue', async () => {
    await queue(['amina@a.co']);
    const denied = (sql: string) => asUser(db, HR, () => db.query(sql).then(() => '', (e) => (e as Error).message));
    expect(await denied(`select * from claim_bulk_emails()`)).toMatch(/permission denied/);
    expect(await denied(`select * from queue_bulk_email('${A}', null, 'email-portal', null, 's', 'h', '[]', array['amina@a.co'])`)).toMatch(/permission denied/);
    const rows = (sql: string) => asUser(db, HR, () => db.query(sql).then((r) => r.rows));
    expect(await rows(`select * from bulk_email_recipients`)).toEqual([]); // no policy lets a signed-in user see any
    expect(await rows(`select * from bulk_emails`)).toEqual([]);
    expect(await rows(`update bulk_email_recipients set status = 'sent' returning id`)).toEqual([]);
  });
});
