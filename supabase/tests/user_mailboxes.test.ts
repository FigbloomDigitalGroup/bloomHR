// @vitest-environment node
//
// Each person's own mailbox (20261025200000, FIG-1205): only the owner reads their row (never the password column),
// nobody else does (administrators included, and nobody in another company), and no signed-in user writes it: the
// backend (service role) connects, changes and disconnects mailboxes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const MARY = '00000000-0000-0000-0000-00000000aa01'; // company A, owns a mailbox
const JOHN = '00000000-0000-0000-0000-00000000aa02'; // company A, no mailbox
const ADMIN = '00000000-0000-0000-0000-00000000aa03'; // company A's administrator
const OTHER = '00000000-0000-0000-0000-00000000bb01'; // company B, owns a mailbox

let db: PGlite;
const run = async (sql: string) => {
  try {
    await db.query(sql);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const COLUMNS = 'user_id, tenant_id, email, imap_host, imap_port, secure, username, smtp_host, smtp_port, connected_at, last_ok_at, last_error';

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Company B', 'company-b');
    insert into auth.users (id, email) values
      ('${MARY}', 'mary@a.co'), ('${JOHN}', 'john@a.co'), ('${ADMIN}', 'admin@a.co'), ('${OTHER}', 'other@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${MARY}', 'mary@a.co', 'HR', '${A}'), ('${JOHN}', 'john@a.co', 'HR', '${A}'),
      ('${ADMIN}', 'admin@a.co', 'ADMIN', '${A}'), ('${OTHER}', 'other@b.co', 'ADMIN', '${B}');
    insert into user_mailboxes (user_id, tenant_id, email, imap_host, username, password_encrypted, smtp_host, smtp_port)
      values ('${MARY}', '${A}', 'mary@a.co', 'mail.a.co', 'mary@a.co', 'v1:secret-a', 'mail.a.co', 465),
             ('${OTHER}', '${B}', 'other@b.co', 'mail.b.co', 'other@b.co', 'v1:secret-b', null, null);
  `);
}, 120000);

describe('user_mailboxes', () => {
  it('defaults to port 993 with SSL/TLS, and only allows 993 (SSL) or 143 (STARTTLS)', async () => {
    expect(await rows(`select imap_port, secure from user_mailboxes where user_id = '${MARY}'`)).toEqual([{ imap_port: 993, secure: true }]);
    const ins = (port: number, secure: boolean) =>
      run(`insert into user_mailboxes (user_id, tenant_id, email, imap_host, imap_port, secure, username, password_encrypted)
           values ('${JOHN}', '${A}', 'john@a.co', 'mail.a.co', ${port}, ${secure}, 'john@a.co', 'v1:x')`);
    expect(await ins(110, false)).toMatch(/check constraint/);
    expect(await ins(143, true)).toMatch(/check constraint/);
    expect(await ins(143, false)).toBe('');
    await db.exec(`delete from user_mailboxes where user_id = '${JOHN}'`);
    expect(await run(`update user_mailboxes set smtp_port = 8080 where user_id = '${MARY}'`)).toMatch(/check constraint/);
  });

  it('the owner reads their own row, without the password column', async () => {
    const own = await asUser(db, MARY, () => rows<{ email: string }>(`select ${COLUMNS} from user_mailboxes`));
    expect(own.map((r) => r.email)).toEqual(['mary@a.co']);
    expect(await asUser(db, MARY, () => run(`select password_encrypted from user_mailboxes`))).toMatch(/permission denied/);
    expect(await asUser(db, MARY, () => run(`select * from user_mailboxes`))).toMatch(/permission denied/);
  });

  it('nobody else sees it: not a colleague, not the administrator, not another company, not anonymous', async () => {
    expect(await asUser(db, JOHN, () => rows(`select ${COLUMNS} from user_mailboxes`))).toEqual([]);
    expect(await asUser(db, ADMIN, () => rows(`select ${COLUMNS} from user_mailboxes`))).toEqual([]);
    expect(await asUser(db, ADMIN, () => run(`select password_encrypted from user_mailboxes`))).toMatch(/permission denied/);
    // company B's owner sees their own row only, never company A's
    const other = await asUser(db, OTHER, () => rows<{ email: string }>(`select ${COLUMNS} from user_mailboxes`));
    expect(other.map((r) => r.email)).toEqual(['other@b.co']);
    expect(await asAnon(db, () => run(`select email from user_mailboxes`))).toMatch(/permission denied/);
  });

  it('no signed-in user writes a row directly, the owner included: the backend does', async () => {
    for (const who of [MARY, ADMIN, JOHN]) {
      expect(await asUser(db, who, () => run(`update user_mailboxes set imap_host = 'evil.example' where user_id = '${MARY}'`))).toMatch(/permission denied/);
      expect(await asUser(db, who, () => run(`delete from user_mailboxes where user_id = '${MARY}'`))).toMatch(/permission denied/);
    }
    expect(await asUser(db, JOHN, () => run(
      `insert into user_mailboxes (user_id, tenant_id, email, imap_host, username, password_encrypted)
       values ('${JOHN}', '${A}', 'john@a.co', 'mail.a.co', 'john@a.co', 'v1:x')`)))
      .toMatch(/permission denied/);
    expect(await rows(`select imap_host from user_mailboxes where user_id = '${MARY}'`)).toEqual([{ imap_host: 'mail.a.co' }]);
  });

  it('goes when the login is deleted', async () => {
    await db.exec(`insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000aa09', 'gone@a.co');
      insert into user_mailboxes (user_id, tenant_id, email, imap_host, username, password_encrypted)
      values ('00000000-0000-0000-0000-00000000aa09', '${A}', 'gone@a.co', 'mail.a.co', 'gone@a.co', 'v1:x');
      delete from auth.users where id = '00000000-0000-0000-0000-00000000aa09';`);
    expect(await rows(`select 1 from user_mailboxes where user_id = '00000000-0000-0000-0000-00000000aa09'`)).toEqual([]);
  });

  it('registers the My mailbox module, given to no role', async () => {
    expect(await rows(`select module_name, category from permissions where module_id = 'mailbox'`)).toEqual([
      { module_name: 'My mailbox', category: 'workspace' },
    ]);
    expect(await rows(`select role_name from role_permissions where 'mailbox' = any (permissions)`)).toEqual([]);
  });

  it('runs again safely', async () => {
    const sql = readFileSync(join(__dirname, '..', 'migrations', '20261025200000_user_mailboxes.sql'), 'utf8');
    await db.exec(sql);
    await db.exec('reset search_path; reset check_function_bodies; reset row_security');
    expect(await rows(`select count(*)::int as n from user_mailboxes`)).toEqual([{ n: 2 }]);
    expect(await rows(`select count(*)::int as n from permissions where module_id = 'mailbox'`)).toEqual([{ n: 1 }]);
    expect(await asUser(db, MARY, () => run(`select password_encrypted from user_mailboxes`))).toMatch(/permission denied/);
  });
});
