// @vitest-environment node
//
// 20261104100000: the storage policies put back on a server whose storage.objects came across with none (the move to
// the self-hosted server). The test database has no storage schema, so a stand-in with row-level security on and no
// policies (as on that server) is created, and only the new migration is applied to it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const STAFF = '00000000-0000-0000-0000-00000000d001'; // EMP-001
const OTHER = '00000000-0000-0000-0000-00000000d002'; // EMP-002
const PAYROLL = '00000000-0000-0000-0000-00000000d003';
const MIGRATION = readFileSync(join(__dirname, '..', 'migrations', '20261104100000_restore_storage_policies.sql'), 'utf8');

let db: PGlite;
const upload = (bucket: string, name: string) => db.query(`insert into storage.objects (bucket_id, name) values ('${bucket}', '${name}')`);
const policies = async () =>
  (await db.query<{ n: number }>(`select count(*)::int as n from pg_policies where schemaname = 'storage' and tablename = 'objects'`)).rows[0].n;

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
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

    insert into auth.users (id, email) values ('${STAFF}', 'one@a.co'), ('${OTHER}', 'two@a.co'), ('${PAYROLL}', 'pay@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${STAFF}', 'one@a.co', 'STAFF', '${A}'), ('${OTHER}', 'two@a.co', 'STAFF', '${A}'), ('${PAYROLL}', 'pay@a.co', 'PAYROLL', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('STAFF', array['dashboard'], '${A}'), ('PAYROLL', array['payroll'], '${A}');
    insert into employees ("Employee Number", "First Name", "Work Email", tenant_id) values
      ('EMP-001', 'One', 'one@a.co', '${A}'), ('EMP-002', 'Two', 'two@a.co', '${A}');
  `);
}, 120000);

describe('a server whose storage came across without policies', () => {
  it('refuses every upload before the migration (what the self-hosted server did)', async () => {
    expect(await policies()).toBe(0);
    await asUser(db, STAFF, async () => {
      await expect(upload('documents', `${A}/${STAFF}/onboarding/id.pdf`)).rejects.toThrow(/row-level security/);
    });
  });

  it('gets every storage policy back', async () => {
    await db.exec(MIGRATION);
    expect(await policies()).toBe(49);
  });

  it('can run again without changing anything', async () => {
    await db.exec(MIGRATION);
    expect(await policies()).toBe(49);
  });

  it('lets an employee upload an onboarding document to their own folder, and no one else’s', async () => {
    await asUser(db, STAFF, async () => {
      await expect(upload('documents', `${A}/${STAFF}/onboarding/id.pdf`)).resolves.toBeTruthy();
      await expect(upload('documents', `${A}/${OTHER}/onboarding/id.pdf`)).rejects.toThrow(/row-level security/);
    });
  });

  it('lets an employee save their own profile picture', async () => {
    await asUser(db, STAFF, async () => {
      await expect(upload('employeeavatar', `${A}/profile_images/EMP-001.png`)).resolves.toBeTruthy();
      await expect(upload('employeeavatar', `${A}/profile_images/EMP-002.png`)).rejects.toThrow(/row-level security/);
    });
  });

  it('lets payroll save payslip PDFs in the company’s folder; an employee cannot', async () => {
    await asUser(db, PAYROLL, async () => {
      await expect(upload('payslip-pdfs', `${A}/2026-10/EMP-001.pdf`)).resolves.toBeTruthy();
    });
    await asUser(db, STAFF, async () => {
      await expect(upload('payslip-pdfs', `${A}/2026-10/EMP-002.pdf`)).rejects.toThrow(/row-level security/);
    });
  });

  it('lets a signed-in user upload a company logo, as on Cloud', async () => {
    // these policies check auth.role(), which reads the role claim storage sets from the user's token (asUser doesn't)
    await asUser(db, PAYROLL, async () => {
      await db.exec(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
      await expect(upload('company-logo', '7d1f0c2e-logo.png')).resolves.toBeTruthy();
    });
    await db.exec(`select set_config('request.jwt.claim.role', '', false)`);
  });
});
