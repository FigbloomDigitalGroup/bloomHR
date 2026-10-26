// @vitest-environment node
//
// Exit letters, drawn signatures and the archive of generated documents (migration 20261026000000). A signature is
// its owner's alone; a generated document is recorded by whoever made it, read by HR and Settings, and never changed
// or removed; every company gets three exit letter templates, which only HR manages.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000f001';
const SET = '00000000-0000-0000-0000-00000000f002';
const S1 = '00000000-0000-0000-0000-00000000f003';
const S2 = '00000000-0000-0000-0000-00000000f004';
const HRB = '00000000-0000-0000-0000-00000000f005';
const MIGRATION = '20261026000000_exit_letters_signatures_documents.sql';
const HASH = 'a'.repeat(64);

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const files = (user: string, bucket: string) =>
  read<{ name: string }>(user, `select name from storage.objects where bucket_id = '${bucket}' order by name`).then((r) => r.map((x) => x.name));

beforeAll(async () => {
  db = await bootLiveDb();
  // a stand-in for Supabase storage, then this migration again so its storage part applies to it
  await db.exec(`
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid());
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as
      $$ select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;
    create function storage.filename(name text) returns text language sql immutable as
      $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
    grant usage on schema storage to anon, authenticated;
    grant all on storage.objects to anon, authenticated;
  `);
  await db.exec(readFileSync(join(__dirname, '..', 'migrations', MIGRATION), 'utf8'));
  await db.exec('reset search_path');

  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${HR}', 'hr@a.co'), ('${SET}', 'set@a.co'), ('${S1}', 's1@a.co'), ('${S2}', 's2@a.co'), ('${HRB}', 'hr@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${SET}', 'set@a.co', 'SETUP', '${A}'), ('${S1}', 's1@a.co', 'STAFF', '${A}'),
      ('${S2}', 's2@a.co', 'STAFF', '${A}'), ('${HRB}', 'hr@b.co', 'HR', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees', 'hr-lifecycle'], '${A}'), ('SETUP', array['settings'], '${A}'), ('STAFF', array['dashboard'], '${A}'),
      ('HR', array['employees', 'hr-lifecycle'], '${B}');
  `);
}, 120000);

describe('exit letter templates', () => {
  it('every company has three, a termination as the default, and a new company gets them too', async () => {
    const t = await rows<{ title: string; is_default: boolean; body: string }>(
      `select title, is_default, body from exit_letter_templates where tenant_id = '${A}' order by created_at, title`
    );
    expect(t.map((x) => x.title).sort()).toEqual(['RE: ACCEPTANCE OF RESIGNATION', 'RE: NON-CONFIRMATION OF EMPLOYMENT', 'RE: TERMINATION OF EMPLOYMENT']);
    expect(t.filter((x) => x.is_default).map((x) => x.title)).toEqual(['RE: TERMINATION OF EMPLOYMENT']);
    expect(t.every((x) => x.body.includes('{{signature}}') && x.body.includes('{{last_working_day}}'))).toBe(true);
    expect((await rows<{ n: number }>(`select count(*)::int n from exit_letter_templates where tenant_id = '${B}'`))[0].n).toBe(3);
  });

  it('only HR reads and manages them, in their own company; one default each', async () => {
    expect(await read(S1, 'select id from exit_letter_templates')).toEqual([]);
    expect((await read(HRB, 'select id from exit_letter_templates')).length).toBe(3);
    await as(HR, `insert into exit_letter_templates (title, body) values ('Summary dismissal', 'Dear {{first_name}},')`);
    await expect(as(S1, `insert into exit_letter_templates (title, body) values ('Mine', 'x')`)).rejects.toThrow(/row-level security/);
    await expect(as(HR, `update exit_letter_templates set is_default = true where title = 'Summary dismissal'`)).rejects.toThrow(/unique|duplicate/);
  });
});

describe('signatures', () => {
  it('each person keeps their own, in their own folder, and nobody else sees it', async () => {
    await as(S1, `insert into storage.objects (bucket_id, name) values ('signatures', '${A}/${S1}/signature-1.png')`);
    await as(S1, `insert into user_signatures (path) values ('${A}/${S1}/signature-1.png')`);
    await expect(as(S1, `insert into storage.objects (bucket_id, name) values ('signatures', '${A}/${S2}/signature-1.png')`)).rejects.toThrow(/row-level security/);
    await expect(as(S2, `insert into user_signatures (path) values ('${A}/${S1}/signature-1.png')`)).rejects.toThrow(/row-level security/);

    expect(await files(S1, 'signatures')).toEqual([`${A}/${S1}/signature-1.png`]);
    expect(await files(HR, 'signatures')).toEqual([]);
    expect(await read(HR, 'select id from user_signatures')).toEqual([]);

    // redrawing replaces it; who it belongs to cannot change
    await as(S1, `update user_signatures set path = '${A}/${S1}/signature-2.png', user_id = '${S2}'`);
    expect(await read(S1, 'select user_id, path from user_signatures')).toEqual([{ user_id: S1, path: `${A}/${S1}/signature-2.png` }]);
  });
});

describe('generated documents', () => {
  const record = (user: string, values = `'exit_letter', 'RE: TERMINATION', 'E1', '${A}/exit_letter/x.pdf', 1200, '${HASH}', array['e1@a.co']`) =>
    as(user, `insert into generated_documents (kind, title, employee_number, file_path, file_size, sha256, emailed_to) values (${values})`);

  it('whoever makes one records it under their own name; HR and Settings read them all, others only their own', async () => {
    await as(HR, `insert into storage.objects (bucket_id, name) values ('generated-documents', '${A}/exit_letter/x.pdf')`);
    await record(HR);
    await as(S1, `insert into storage.objects (bucket_id, name) values ('generated-documents', '${A}/payslip/mine.pdf')`);
    await record(S1, `'payslip', 'My payslip', null, '${A}/payslip/mine.pdf', 10, null, '{}'`);

    // a forged author or another company's folder is refused
    await expect(as(S1, `insert into generated_documents (kind, title, file_path, created_by) values ('x_doc', 'x', '${B}/x_doc/a.pdf', '${HR}')`)).rejects.toThrow(/row-level security/);
    await expect(as(S1, `insert into storage.objects (bucket_id, name) values ('generated-documents', '${B}/payslip/a.pdf')`)).rejects.toThrow(/row-level security/);

    const authors = await rows<{ title: string; created_by: string }>(`select title, created_by from generated_documents order by title`);
    expect(authors).toEqual([{ title: 'My payslip', created_by: S1 }, { title: 'RE: TERMINATION', created_by: HR }]);

    expect((await read(HR, 'select id from generated_documents')).length).toBe(2);
    expect((await read(SET, 'select id from generated_documents')).length).toBe(2);
    expect((await read(S1, 'select title from generated_documents'))).toEqual([{ title: 'My payslip' }]);
    expect(await read(S2, 'select id from generated_documents')).toEqual([]);
    expect(await read(HRB, 'select id from generated_documents')).toEqual([]);

    expect((await files(SET, 'generated-documents')).length).toBe(2);
    expect(await files(S1, 'generated-documents')).toEqual([`${A}/payslip/mine.pdf`]);
    expect(await files(S2, 'generated-documents')).toEqual([]);
  });

  it('nobody changes or removes one, and each is in the audit trail', async () => {
    // no policy lets anyone change one; even a service key (no row security) is stopped by the trigger
    await as(HR, `update generated_documents set title = 'Changed'`);
    await as(HR, `delete from generated_documents`);
    expect((await rows<{ n: number }>(`select count(*)::int n from generated_documents where title <> 'Changed'`))[0].n).toBe(2);
    await expect(db.exec(`update generated_documents set title = 'Changed'`)).rejects.toThrow(/kept as they were made/);
    await expect(db.exec(`delete from generated_documents`)).rejects.toThrow(/kept as they were made/);
    await as(HR, `delete from storage.objects where bucket_id = 'generated-documents'`);
    expect((await rows(`select id from storage.objects where bucket_id = 'generated-documents'`)).length).toBe(2);

    const audit = await rows<{ action_type: string }>(`select action_type from audit_log where table_name = 'generated_documents'`);
    expect(audit.map((a) => a.action_type)).toEqual(['INSERT', 'INSERT']);
  });
});
