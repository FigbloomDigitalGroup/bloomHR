// @vitest-environment node
//
// Adding thousands of employees (FIG-818, 20261014300000): the upload saved in batches with each row's result; the
// invitation queue (who may queue, claiming once, the same invitation as create_invitation, retries, other companies
// kept out); onboarding started for many at once.
import { createHash } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const ADMIN = '00000000-0000-0000-0000-00000000f001';
const HR = '00000000-0000-0000-0000-00000000f002';
const STAFF = '00000000-0000-0000-0000-00000000f003';
const ADMIN_B = '00000000-0000-0000-0000-00000000f004';
const BATCH = '11111111-1111-1111-1111-111111111111';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const message = (p: Promise<unknown>) => p.then(() => '', (e) => (e as Error).message);
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

type Saved = { row_no: number; employee_number: string | null; outcome: string; employee_id: string | null; work_email: string | null; error_code: string | null; error_message: string | null };
const save = (as: string, batch: unknown[]) =>
  asUser(db, as, () => rows<Saved>(`select * from save_employees_batch($1::jsonb)`, [JSON.stringify(batch)]));

type Queued = { batch_id: string; queued: number; skipped: number; rejected: { email: string; reason: string }[] };
const enqueue = (as: string, people: { email: string; role?: string }[], batch: string | null = BATCH) =>
  asUser(db, as, async () => (await rows<Queued>(`select * from enqueue_invitations($1::jsonb, $2::uuid)`, [JSON.stringify(people), batch]))[0]);

type Claimed = { id: number; tenant_id: string; email: string; role: string; token: string; expires_at: string; company_name: string; inviter_email: string };
const claim = (limit = 100) => rows<Claimed>(`select * from claim_invitations($1)`, [limit]);
const progress = (as: string, batch = BATCH) =>
  asUser(db, as, async () => (await rows<{ p: Record<string, unknown> }>(`select invitation_batch_progress($1::uuid) p`, [batch]))[0].p);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${ADMIN}', 'admin@a.co'), ('${HR}', 'hr@a.co'), ('${STAFF}', 'staff@a.co'), ('${ADMIN_B}', 'admin@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${ADMIN}', 'admin@a.co', 'ADMIN', '${A}'), ('${HR}', 'hr@a.co', 'HR', '${A}'),
      ('${STAFF}', 'staff@a.co', 'STAFF', '${A}'), ('${ADMIN_B}', 'admin@b.co', 'ADMIN', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('STAFF', array['dashboard'], '${A}'), ('HR', array['dashboard', 'employees', 'invite-people'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", tenant_id) values
      ('E-OLD', 'Old', 'Hand', 'old@a.co', '${A}');
  `);
}, 120000);

describe('save_employees_batch', () => {
  it('adds new employees and updates existing ones, reporting each row', async () => {
    const result = await save(HR, [
      { row: 2, data: { 'Employee Number': 'E-100', 'First Name': 'Amina', 'Last Name': 'Otieno', 'Work Email': 'amina@a.co', 'Basic Salary': 50000, 'ID Number': 12345678 } },
      { row: 3, data: { 'Employee Number': 'E-OLD', 'Job Title': 'Driver' } },
    ]);
    // a new employee's number comes from the system (the typed E-100 belongs to nobody, so it is ignored)
    expect(result.map((r) => [r.row_no, r.outcome, r.work_email])).toEqual([
      [2, 'created', 'amina@a.co'],
      [3, 'updated', 'old@a.co'],
    ]);
    expect(result[0].employee_number).toMatch(/^MCL-\d{6}$/);
    expect(result[1].employee_number).toBe('E-OLD');
    expect(result[0].employee_id).toMatch(/^[0-9a-f-]{36}$/);
    const [created] = await rows<Record<string, unknown>>(`select * from employees where "Work Email" = 'amina@a.co'`);
    expect(created).toMatchObject({ 'First Name': 'Amina', 'ID Number': '12345678', tenant_id: A, onboarding_status: 'draft' });
    expect(created['Payroll Number']).toMatch(/^PR-\d+$/); // the employees triggers still run
    expect(await rows(`select "Job Title", "First Name" from employees where "Employee Number" = 'E-OLD'`)).toEqual([{ 'Job Title': 'Driver', 'First Name': 'Old' }]);
  });

  it('a row that fails is reported and the others are still saved', async () => {
    const result = await save(HR, [
      { row: 2, data: { 'Employee Number': 'E-200', 'First Name': 'No', 'Last Name': 'Email' } },
      { row: 3, data: { 'Employee Number': 'E-201', 'First Name': 'Dup', 'Last Name': 'Mail', 'Work Email': 'amina@a.co' } },
      { row: 4, data: { 'Employee Number': 'E-202', 'First Name': 'Bad', 'Last Name': 'Pin', 'Work Email': 'pin@a.co', 'Tax PIN': 'nope' } },
      { row: 5, data: { 'First Name': 'No number' } },
      { row: 6, data: { 'Employee Number': 'E-203', 'First Name': 'Fine', 'Last Name': 'Row', 'Work Email': 'fine@a.co' } },
    ]);
    // row 3's work email is Amina's: it is about her, so it updates her rather than adding a second employee
    expect(result.map((r) => r.outcome)).toEqual(['error', 'updated', 'error', 'error', 'created']);
    expect(result[0].error_message).toMatch(/no work email/);
    expect(result[2].error_message).toMatch(/KRA PIN/);
    expect(result[3].error_message).toMatch(/no work email/);
    expect(await rows(`select "First Name" from employees where "Work Email" = 'amina@a.co'`)).toEqual([{ 'First Name': 'Dup' }]);
    expect(await rows(`select 1 from employees where "Work Email" in ('pin@a.co', 'fine@a.co')`)).toHaveLength(1);
  });

  it('cannot set the keys or the onboarding state, and runs as the caller (staff cannot add employees)', async () => {
    const [r] = await save(HR, [{ row: 2, data: { 'Employee Number': 'E-300', 'First Name': 'X', 'Last Name': 'Y', 'Work Email': 'x@a.co', tenant_id: B, onboarding_status: 'approved' } }]);
    expect(r.outcome).toBe('created');
    expect(await rows(`select tenant_id, onboarding_status from employees where "Work Email" = 'x@a.co'`)).toEqual([{ tenant_id: A, onboarding_status: 'draft' }]);
    const [denied] = await save(STAFF, [{ row: 2, data: { 'Employee Number': 'E-301', 'First Name': 'X', 'Last Name': 'Y', 'Work Email': 'y@a.co' } }]);
    expect(denied.outcome).toBe('error');
    expect(denied.error_message).toMatch(/row-level security/);
    expect(await asAnon(db, () => message(db.query(`select * from save_employees_batch('[]')`)))).toMatch(/permission denied/);
  });

  it('refuses more than 500 rows in one call', async () => {
    const many = Array.from({ length: 501 }, (_, i) => ({ row: i + 2, data: { 'Employee Number': `M-${i}` } }));
    expect(await message(save(HR, many))).toMatch(/at most 500/);
  });
});

describe('the invitation queue', () => {
  beforeEach(async () => {
    await db.exec(`delete from invite_queue; delete from invitations`);
  });

  it('only administrators and HR can queue, and HR only staff', async () => {
    expect(await message(enqueue(STAFF, [{ email: 'x@gmail.com' }]))).toMatch(/Only an administrator or HR/);
    const got = await enqueue(HR, [{ email: 'new@gmail.com' }, { email: 'boss@gmail.com', role: 'ADMIN' }, { email: 'not-an-email' }]);
    expect(got).toMatchObject({ batch_id: BATCH, queued: 1, skipped: 0 });
    expect(got.rejected).toEqual([
      { email: 'boss@gmail.com', reason: 'only an administrator can invite this role' },
      { email: 'not-an-email', reason: 'not a valid email address' },
    ]);
    expect(await asAnon(db, () => message(db.query(`select * from enqueue_invitations('[]')`)))).toMatch(/permission denied/);
  });

  it('clients cannot write the queue directly', async () => {
    await asUser(db, ADMIN, async () => {
      expect(await message(db.query(`insert into invite_queue (batch_id, email) values ('${BATCH}', 'x@y.co')`))).toMatch(/row-level security/);
    });
    await enqueue(ADMIN, [{ email: 'a1@gmail.com' }]);
    await asUser(db, ADMIN, async () => {
      expect(await rows(`update invite_queue set status = 'sent' returning 1`)).toEqual([]);
      expect(await rows(`delete from invite_queue returning 1`)).toEqual([]);
    });
  });

  it('skips people already in the company, and queues each address once', async () => {
    const got = await enqueue(ADMIN, [{ email: 'Staff@A.co' }, { email: 'dup@gmail.com' }, { email: ' DUP@gmail.com ' }]);
    expect(got).toMatchObject({ queued: 1, skipped: 1, rejected: [] });
    // queued again from a later upload: moved into that batch, not added twice
    const later = '22222222-2222-2222-2222-222222222222';
    await enqueue(ADMIN, [{ email: 'dup@gmail.com' }], later);
    expect(await rows(`select batch_id, status from invite_queue where email = 'dup@gmail.com'`)).toEqual([{ batch_id: later, status: 'queued' }]);
  });

  it('claims each one once, making the same invitation create_invitation makes (only the hash stored)', async () => {
    await enqueue(HR, [{ email: 'one@gmail.com' }, { email: 'two@gmail.com' }]);
    const claimed = await claim();
    expect(claimed.map((c) => [c.email, c.role, c.company_name, c.inviter_email])).toEqual([
      ['one@gmail.com', 'STAFF', 'Figbloom HR', 'hr@a.co'],
      ['two@gmail.com', 'STAFF', 'Figbloom HR', 'hr@a.co'],
    ]);
    expect(await claim()).toEqual([]); // claimed once only
    const [c] = claimed;
    const [inv] = await rows<{ token_hash: string; invited_by: string; status: string; tenant_id: string }>(
      `select token_hash, invited_by, status, tenant_id from invitations where lower(email) = 'one@gmail.com'`
    );
    expect(inv).toEqual({ token_hash: sha(c.token), invited_by: HR, status: 'pending', tenant_id: A });
    expect(JSON.stringify(await rows(`select * from invite_queue`))).not.toContain(c.token);
    // the emailed link works on the join page like any other
    await asAnon(db, async () => {
      expect(await rows(`select company_name, email, role from invitation_preview('${c.token}')`)).toEqual([
        { company_name: 'Figbloom HR', email: 'one@gmail.com', role: 'STAFF' },
      ]);
    });
    expect(await rows(`select status, attempts from invite_queue order by id`)).toEqual([
      { status: 'sending', attempts: 1 },
      { status: 'sending', attempts: 1 },
    ]);
  });

  it('a new invitation replaces an earlier open link for the address', async () => {
    const old = await asUser(db, ADMIN, async () => (await rows<{ token: string }>(`select * from create_invitation('again@gmail.com', 'STAFF')`))[0]);
    await enqueue(ADMIN, [{ email: 'again@gmail.com' }]);
    const [c] = await claim();
    await asAnon(db, async () => {
      expect(await rows(`select * from invitation_preview('${old.token}')`)).toEqual([]);
      expect(await rows(`select email from invitation_preview('${c.token}')`)).toEqual([{ email: 'again@gmail.com' }]);
    });
  });

  it('respects the limit, and takes the oldest first', async () => {
    await enqueue(ADMIN, Array.from({ length: 5 }, (_, i) => ({ email: `p${i}@gmail.com` })));
    expect((await claim(2)).map((c) => c.email)).toEqual(['p0@gmail.com', 'p1@gmail.com']);
    expect((await claim(10)).map((c) => c.email)).toEqual(['p2@gmail.com', 'p3@gmail.com', 'p4@gmail.com']);
  });

  it('marks sent, tries failures again later, and fails for good when told or after 5 attempts', async () => {
    await enqueue(ADMIN, [{ email: 'ok@gmail.com' }, { email: 'later@gmail.com' }, { email: 'bad@gmail.com' }]);
    const claimed = await claim();
    const [ok, later, bad] = ['ok', 'later', 'bad'].map((name) => claimed.find((c) => c.email === `${name}@gmail.com`)!);
    await db.query(`select finish_invitations(array[${ok.id}]::bigint[])`);
    await db.query(`select release_invitations(array[${later.id}]::bigint[], 'Resend 500', true)`);
    await db.query(`select release_invitations(array[${bad.id}]::bigint[], 'Resend 422: invalid to', false)`);
    expect(await claim()).toEqual([]); // the retry waits a while
    expect(await progress(ADMIN)).toMatchObject({ total: 3, sent: 1, queued: 1, failed: 1, failures: [{ email: 'bad@gmail.com', error: 'Resend 422: invalid to' }] });

    // time passes: tried again, until the fifth attempt is the last
    for (let attempt = 2; attempt <= 5; attempt++) {
      await db.exec(`update invite_queue set next_attempt_at = now() where id = ${later.id}`);
      const again = await claim();
      expect(again.map((c) => c.email)).toEqual(['later@gmail.com']);
      await db.query(`select release_invitations(array[${later.id}]::bigint[], 'Resend 500', true)`);
    }
    expect(await rows(`select status, attempts from invite_queue where id = ${later.id}`)).toEqual([{ status: 'failed', attempts: 5 }]);
  });

  it('a run that died: claimed again after 10 minutes', async () => {
    await enqueue(ADMIN, [{ email: 'stuck@gmail.com' }]);
    await claim();
    expect(await claim()).toEqual([]);
    await db.exec(`update invite_queue set claimed_at = now() - interval '11 minutes'`);
    expect((await claim()).map((c) => c.email)).toEqual(['stuck@gmail.com']);
  });

  it('retry puts a batch’s failures back in the queue', async () => {
    await enqueue(HR, [{ email: 'r1@gmail.com' }, { email: 'r2@gmail.com' }]);
    const claimed = await claim();
    await db.query(`select release_invitations($1::bigint[], 'Resend 422', false)`, [claimed.map((c) => c.id)]);
    expect(await asUser(db, STAFF, () => message(db.query(`select retry_failed_invitations('${BATCH}')`)))).toMatch(/Only an administrator or HR/);
    expect(await asUser(db, HR, async () => (await rows<{ n: number }>(`select retry_failed_invitations('${BATCH}') n`))[0].n)).toBe(2);
    expect(await progress(HR)).toMatchObject({ total: 2, queued: 2, failed: 0 });
    expect((await claim()).length).toBe(2);
  });

  it('is not sent if the person who queued it may no longer invite', async () => {
    await enqueue(HR, [{ email: 'orphan@gmail.com' }]);
    await db.exec(`update memberships set role = 'STAFF' where user_id = '${HR}'`);
    try {
      expect(await claim()).toEqual([]);
      expect(await rows(`select status from invite_queue`)).toEqual([{ status: 'failed' }]);
      expect(await rows(`select 1 from invitations`)).toEqual([]);
    } finally {
      await db.exec(`update memberships set role = 'HR' where user_id = '${HR}'`);
    }
  });

  it('someone who joined meanwhile is skipped, not emailed', async () => {
    await enqueue(ADMIN, [{ email: 'joined@gmail.com' }]);
    await db.exec(`
      insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000f0a1', 'joined@gmail.com');
      insert into memberships (user_id, tenant_id, role, account_status) values ('00000000-0000-0000-0000-00000000f0a1', '${A}', 'STAFF', 'ACTIVE');
    `);
    expect(await claim()).toEqual([]);
    expect(await rows(`select status, error from invite_queue`)).toEqual([{ status: 'skipped', error: 'already has access to this company' }]);
  });

  it('each company sees only its own queue; staff see none; only the server claims', async () => {
    await enqueue(ADMIN, [{ email: 'mine@gmail.com' }]);
    expect((await progress(ADMIN)).total).toBe(1);
    expect((await progress(ADMIN_B)).total).toBe(0);
    await asUser(db, ADMIN_B, async () => {
      expect(await rows(`select 1 from invite_queue`)).toEqual([]);
      expect(await message(db.query(`select retry_failed_invitations('${BATCH}')`))).toBe('');
    });
    await asUser(db, STAFF, async () => {
      expect(await rows(`select 1 from invite_queue`)).toEqual([]);
    });
    for (const fn of [`claim_invitations()`, `finish_invitations('{1}')`, `release_invitations('{1}', 'x')`]) {
      expect(await asUser(db, ADMIN, () => message(db.query(`select ${fn}`)))).toMatch(/permission denied/);
    }
    // B's admin queueing the same address is a separate entry, in B
    await enqueue(ADMIN_B, [{ email: 'mine@gmail.com' }], null);
    expect(await rows(`select tenant_id from invite_queue order by id`)).toEqual([{ tenant_id: A }, { tenant_id: B }]);
  });
});

describe('start_onboarding_by_email', () => {
  it('marks the drafts with those work emails invited, with the history entry', async () => {
    await save(HR, [
      { row: 2, data: { 'Employee Number': 'O-1', 'First Name': 'A', 'Last Name': 'B', 'Work Email': 'o1@a.co' } },
      { row: 3, data: { 'Employee Number': 'O-2', 'First Name': 'C', 'Last Name': 'D', 'Work Email': 'o2@a.co' } },
    ]);
    const n = await asUser(db, HR, async () => (await rows<{ n: number }>(`select start_onboarding_by_email(array['O1@a.co', 'o2@a.co', 'nobody@a.co']) n`))[0].n);
    expect(n).toBe(2);
    expect(await rows(`select onboarding_status from employees where "Work Email" in ('o1@a.co', 'o2@a.co')`)).toEqual([
      { onboarding_status: 'invited' },
      { onboarding_status: 'invited' },
    ]);
    expect(await rows(`select r.action, r.actor from employee_onboarding_reviews r join employees e on e.id = r.employee_id where e."Work Email" = 'o1@a.co'`)).toEqual([
      { action: 'invited', actor: HR },
    ]);
    // already invited: not again
    expect(await asUser(db, HR, async () => (await rows<{ n: number }>(`select start_onboarding_by_email(array['o1@a.co']) n`))[0].n)).toBe(0);
  });

  it('only for people who manage employees', async () => {
    expect(await asUser(db, STAFF, () => message(db.query(`select start_onboarding_by_email(array['o1@a.co'])`)))).toMatch(/Only HR/);
  });
});
