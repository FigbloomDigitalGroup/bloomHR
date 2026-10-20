// @vitest-environment node
//
// A company's own mail server (20261022300000): only the backend (service role) reads or writes the settings, so no
// signed-in user, not even the administrator, can read the stored password; sends through it are logged as 'own_server'.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const ADMIN = '00000000-0000-0000-0000-00000000c701';

let db: PGlite;
const run = async (sql: string) => {
  try {
    await db.query(sql);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN}', 'admin@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${ADMIN}', 'admin@a.co', 'ADMIN', '${A}');
    insert into company_mail_servers (tenant_id, host, username, from_address, password_encrypted, enabled)
      values ('${A}', 'mail.a.co', 'hr@a.co', 'hr@a.co', 'v1:secret', true);
  `);
}, 120000);

describe('company_mail_servers', () => {
  it('defaults to port 465 with SSL/TLS, off until turned on', async () => {
    await db.exec(`insert into tenants (id, name, slug) values ('00000000-0000-0000-0000-0000000000c2', 'Company Two', 'company-two')`);
    await db.exec(`insert into company_mail_servers (tenant_id, host, username, from_address)
                   values ('00000000-0000-0000-0000-0000000000c2', 'mail.c2.co', 'u', 'u@c2.co')`);
    const row = (await db.query<{ port: number; secure: boolean; enabled: boolean }>(
      `select port, secure, enabled from company_mail_servers where tenant_id = '00000000-0000-0000-0000-0000000000c2'`)).rows[0];
    expect(row).toEqual({ port: 465, secure: true, enabled: false });
  });

  it('cannot be read or changed by a signed-in user, even the administrator', async () => {
    const read = await asUser(db, ADMIN, () => run(`select password_encrypted from company_mail_servers`));
    expect(read).toMatch(/permission denied/);
    const write = await asUser(db, ADMIN, () => run(`update company_mail_servers set host = 'evil.example'`));
    expect(write).toMatch(/permission denied/);
  });

  it("logs sends through a company's own server as 'own_server', and still refuses unknown providers", async () => {
    expect(await run(`insert into sent_emails (tenant_id, provider, purpose, subject) values ('${A}', 'own_server', 'email-portal', 'Hi')`)).toBe('');
    expect(await run(`insert into sent_emails (tenant_id, provider, purpose, subject) values ('${A}', 'sendgrid', 'email-portal', 'Hi')`))
      .toMatch(/check constraint/);
  });
});
