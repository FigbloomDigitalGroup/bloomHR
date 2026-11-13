// @vitest-environment node
//
// The training and company-logo buckets (20261113100000): made where missing, and who may upload training files. The
// test database has no storage schema, so a minimal stand-in is created and the real migration is applied to it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const TRAINER = '00000000-0000-0000-0000-00000000d001'; // HR in A, has the Training module
const CLERK = '00000000-0000-0000-0000-00000000d002'; // STAFF in A, no Training module

const MIGRATION = readFileSync(join(__dirname, '..', 'migrations', '20261113100000_training_and_logo_buckets.sql'), 'utf8');
let db: PGlite;
const upload = (bucket: string, name: string) => db.query(`insert into storage.objects (bucket_id, name) values ('${bucket}', '${name}')`);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant all on storage.objects to anon, authenticated;
    -- a bucket that already exists (private) is left as it is
    insert into storage.buckets (id, name, public) values ('company-logo', 'company-logo', false);
  `);
  await db.exec(MIGRATION);
  await db.exec(`
    insert into auth.users (id, email) values ('${TRAINER}', 'trainer@a.co'), ('${CLERK}', 'clerk@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${TRAINER}', 'trainer@a.co', 'HR', '${A}'), ('${CLERK}', 'clerk@a.co', 'STAFF', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['training'], '${A}'), ('STAFF', array['dashboard'], '${A}')
    on conflict do nothing;
    update role_permissions set permissions = array['training'] where tenant_id = '${A}' and role_name = 'HR';
    update role_permissions set permissions = array['dashboard'] where tenant_id = '${A}' and role_name = 'STAFF';
  `);
}, 120000);

describe('the buckets', () => {
  it('makes the two training buckets, public', async () => {
    const { rows } = await db.query<{ id: string; public: boolean }>(
      `select id, public from storage.buckets where id like 'training-%' order by id`);
    expect(rows).toEqual([{ id: 'training-documents', public: true }, { id: 'training-videos', public: true }]);
  });

  it('leaves a bucket that already exists as it is', async () => {
    const { rows } = await db.query<{ public: boolean }>(`select public from storage.buckets where id = 'company-logo'`);
    expect(rows).toEqual([{ public: false }]);
  });

  it('gives company-logo the policies production has', async () => {
    const { rows } = await db.query<{ policyname: string }>(
      `select policyname from pg_policies where schemaname = 'storage' and policyname like 'company-logo %' order by policyname`);
    expect(rows.map((r) => r.policyname)).toEqual([
      'company-logo authenticated delete', 'company-logo authenticated insert', 'company-logo authenticated update', 'company-logo public read',
    ]);
  });

  it('can run again (a server that already has everything)', async () => {
    await expect(db.exec(MIGRATION)).resolves.toBeTruthy();
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from storage.buckets`);
    expect(rows).toEqual([{ n: 3 }]);
  });
});

describe('training files', () => {
  it('someone with the Training module can upload videos, thumbnails and documents', async () => {
    await asUser(db, TRAINER, async () => {
      await expect(upload('training-videos', 'Health & Safety/1b2c.mp4')).resolves.toBeTruthy();
      await expect(upload('training-videos', 'thumbnails/1b2c.jpg')).resolves.toBeTruthy();
      await expect(upload('training-documents', 'documents/3d4e.pdf')).resolves.toBeTruthy();
    });
  });

  it('and replace or remove them', async () => {
    await asUser(db, TRAINER, async () => {
      const replaced = await db.query(`update storage.objects set name = name where name = 'documents/3d4e.pdf' returning 1`);
      expect(replaced.rows).toHaveLength(1);
      const removed = await db.query(`delete from storage.objects where name = 'thumbnails/1b2c.jpg' returning 1`);
      expect(removed.rows).toHaveLength(1);
    });
  });

  it('someone without it cannot upload, replace or remove them', async () => {
    await asUser(db, CLERK, async () => {
      await expect(upload('training-documents', 'documents/5f6a.pdf')).rejects.toThrow(/row-level security/);
      const removed = await db.query(`delete from storage.objects where name = 'documents/3d4e.pdf' returning 1`);
      expect(removed.rows).toHaveLength(0);
    });
  });

  it('signed-out visitors cannot upload', async () => {
    await asAnon(db, async () => {
      await expect(upload('training-videos', 'x/7b8c.mp4')).rejects.toThrow(/permission denied|row-level security/);
    });
  });

  it('the Training module does not open other buckets', async () => {
    await asUser(db, TRAINER, async () => {
      await expect(upload('documents', 'documents/3d4e.pdf')).rejects.toThrow(/row-level security/);
    });
  });
});
