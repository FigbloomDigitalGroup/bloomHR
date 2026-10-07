// @vitest-environment node
//
// Staff documents, expense receipts and CVs in private storage. Storage only signs a link for a file the caller can
// select, so the select policies below are what decide who can open a file. The test database has no storage schema,
// so a minimal stand-in (objects table, the foldername/filename helpers) is created and the real policy SQL from the
// migration is applied to it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const STAFF = '00000000-0000-0000-0000-00000000d001'; // staff in A
const OTHER_STAFF = '00000000-0000-0000-0000-00000000d002'; // staff in A
const HR = '00000000-0000-0000-0000-00000000d003'; // HR in A (employees, expenses, recruitment)
const B_HR = '00000000-0000-0000-0000-00000000d004'; // HR in B, same modules

let db: PGlite;
const put = (bucket: string, name: string) => db.query(`insert into storage.objects (bucket_id, name) values ('${bucket}', '${name}')`);
const visible = async (bucket: string) =>
  (await db.query<{ name: string }>(`select name from storage.objects where bucket_id = '${bucket}' order by name`)).rows.map((r) => r.name);
const remove = async (bucket: string, name: string) =>
  (await db.query(`delete from storage.objects where bucket_id = '${bucket}' and name = '${name}' returning 1`)).rows.length;
const asSuper = (sql: string) => db.exec(sql);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as
      $$ select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;
    create function storage.filename(name text) returns text language sql immutable as
      $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
    grant usage on schema storage to anon, authenticated;
    grant all on storage.objects to anon, authenticated;
    insert into storage.buckets values ('documents', 'documents', true), ('resumes', 'resumes', true);
  `);
  await db.exec(readFileSync(join(__dirname, '..', 'migrations', '20261007000100_private_files_storage.sql'), 'utf8'));

  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${STAFF}', 'john@a.co'), ('${OTHER_STAFF}', 'two@a.co'), ('${HR}', 'hr@a.co'), ('${B_HR}', 'hr@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${STAFF}', 'john@a.co', 'STAFF', '${A}'), ('${OTHER_STAFF}', 'two@a.co', 'STAFF', '${A}'),
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${B_HR}', 'hr@b.co', 'HR', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('STAFF', array['dashboard'], '${A}'),
      ('HR', array['employees', 'expenses', 'recruitment'], '${A}'),
      ('HR', array['employees', 'expenses', 'recruitment'], '${B}');
  `);
}, 120000);

describe('buckets', () => {
  it('are private, including ones that were public before', async () => {
    const rows = (await db.query<{ id: string; public: boolean }>(`select id, public from storage.buckets order by id`)).rows;
    expect(rows).toEqual([
      { id: 'documents', public: false },
      { id: 'expense-receipts', public: false },
      { id: 'resumes', public: false },
    ]);
  });
});

describe('staff documents', () => {
  it('a person can save files only in their own folder in their own company', async () => {
    await asUser(db, STAFF, async () => {
      await expect(put('documents', `${A}/${STAFF}/id_front_1.jpg`)).resolves.toBeTruthy();
      await expect(put('documents', `${A}/${OTHER_STAFF}/id_front_1.jpg`)).rejects.toThrow(/row-level security/);
      await expect(put('documents', `${B}/${STAFF}/id_front_1.jpg`)).rejects.toThrow(/row-level security/);
      await expect(put('documents', `john/id_front_1.jpg`)).rejects.toThrow(/row-level security/); // the old layout
    });
    await asUser(db, OTHER_STAFF, async () => {
      await expect(put('documents', `${A}/${OTHER_STAFF}/kra_pin_1.jpg`)).resolves.toBeTruthy();
    });
  });

  it("a person can open their own files but not a colleague's", async () => {
    await asUser(db, STAFF, async () => {
      expect(await visible('documents')).toEqual([`${A}/${STAFF}/id_front_1.jpg`]);
    });
  });

  it("HR can open everyone's files in their company, and no other company's", async () => {
    await asUser(db, HR, async () => {
      expect(await visible('documents')).toEqual([`${A}/${STAFF}/id_front_1.jpg`, `${A}/${OTHER_STAFF}/kra_pin_1.jpg`]);
    });
    await asUser(db, B_HR, async () => {
      expect(await visible('documents')).toEqual([]);
    });
  });

  it("a person can remove their own files but not a colleague's", async () => {
    await asUser(db, STAFF, async () => {
      expect(await remove('documents', `${A}/${OTHER_STAFF}/kra_pin_1.jpg`)).toBe(0);
    });
    await asUser(db, OTHER_STAFF, async () => {
      expect(await remove('documents', `${A}/${OTHER_STAFF}/kra_pin_1.jpg`)).toBe(1);
    });
  });

  it('signed-out visitors can neither save nor open files', async () => {
    await asAnon(db, async () => {
      await expect(put('documents', `${A}/${STAFF}/x.jpg`)).rejects.toThrow(/permission denied|row-level security/);
      expect(await visible('documents')).toEqual([]);
    });
  });
});

describe('expense receipts', () => {
  it('people with the Expenses module save receipts in their company folder; others cannot', async () => {
    await asUser(db, HR, async () => {
      await expect(put('expense-receipts', `${A}/receipts/r1.jpg`)).resolves.toBeTruthy();
      await expect(put('expense-receipts', `${B}/receipts/r2.jpg`)).rejects.toThrow(/row-level security/);
      await expect(put('expense-receipts', `receipts/r3.jpg`)).rejects.toThrow(/row-level security/); // the old layout
    });
    await asUser(db, STAFF, async () => {
      await expect(put('expense-receipts', `${A}/receipts/r4.jpg`)).rejects.toThrow(/row-level security/);
    });
  });

  it("only that company's Expenses users can open them", async () => {
    await asUser(db, HR, async () => expect(await visible('expense-receipts')).toEqual([`${A}/receipts/r1.jpg`]));
    await asUser(db, STAFF, async () => expect(await visible('expense-receipts')).toEqual([]));
    await asUser(db, B_HR, async () => expect(await visible('expense-receipts')).toEqual([]));
  });
});

describe('CVs', () => {
  beforeAll(async () => {
    // uploaded by the careers site; one application in each company
    await asSuper(`
      insert into storage.objects (bucket_id, name) values
        ('resumes', 'public/jane_cv.pdf'), ('resumes', 'public/bob_cv.pdf'), ('resumes', 'public/stray.pdf');
      insert into job_applications (resume_file_name, resume_file_url, tenant_id) values
        ('jane_cv.pdf', null, '${A}'),
        (null, 'https://x.supabase.co/storage/v1/object/public/resumes/public/bob_cv.pdf', '${B}');
    `);
  });

  it("a recruiter can open CVs of their own company's applications only", async () => {
    await asUser(db, HR, async () => expect(await visible('resumes')).toEqual(['public/jane_cv.pdf']));
    await asUser(db, B_HR, async () => expect(await visible('resumes')).toEqual(['public/bob_cv.pdf']));
  });

  it('people without the Recruitment module, and signed-out visitors, open none', async () => {
    await asUser(db, STAFF, async () => expect(await visible('resumes')).toEqual([]));
    await asAnon(db, async () => expect(await visible('resumes')).toEqual([]));
  });
});
