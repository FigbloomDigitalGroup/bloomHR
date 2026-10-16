// @vitest-environment node
//
// Contract signing: HR ('employees' or 'hr-lifecycle' module, or an administrator) sends an employee a contract; the
// employee opens it (viewed), uploads the signed copy (signed, HR hears of it) and may replace it until HR accepts it;
// HR accepts it or sends it back with a reason (the employee hears of it and uploads again), or cancels it. Each company
// sees only its own; staff only their own. The test database has no storage schema, so the storage policies are
// checked against a minimal stand-in (objects table, foldername/filename helpers), as in private_files_storage.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000c001';
const LIFE = '00000000-0000-0000-0000-00000000c002'; // hr-lifecycle module only
const ADMIN = '00000000-0000-0000-0000-00000000c003';
const S1 = '00000000-0000-0000-0000-00000000c004';
const S2 = '00000000-0000-0000-0000-00000000c005';
const HRB = '00000000-0000-0000-0000-00000000c006';

const C1 = '11111111-0000-0000-0000-000000000001'; // to E1
const C2 = '11111111-0000-0000-0000-000000000002'; // to E2
const C3 = '11111111-0000-0000-0000-000000000003'; // to E1, cancelled later
const CB = '11111111-0000-0000-0000-0000000000b1'; // in the other company

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const send = (user: string, id: string, employee: string, tenant = A, extra = '') =>
  as(user, `insert into employee_contracts (id, employee_number, title, file_path, file_name${extra ? ', message, sign_by' : ''})
            values ('${id}', '${employee}', 'Employment contract 2027', '${tenant}/${id}/original-x.pdf', 'contract.pdf'${extra})`);
const contract = async (id: string) =>
  (
    await rows<{ status: string; signed_path: string | null; viewed_at: string | null; signed_at: string | null; send_back_reason: string | null; reviewed_by: string | null; sent_by: string | null }>(
      `select status, signed_path, viewed_at, signed_at, send_back_reason, reviewed_by, sent_by from employee_contracts where id = '${id}'`
    )
  )[0];
const notes = (type: string, employee: string) =>
  rows<{ title: string; message: string }>(`select title, message from hr_notifications where notification_type = '${type}' and employee_number = '${employee}' order by id`);
const put = (name: string) => db.query(`insert into storage.objects (bucket_id, name) values ('employee-contracts', '${name}')`);
const visible = async () =>
  (await db.query<{ name: string }>(`select name from storage.objects where bucket_id = 'employee-contracts' order by name`)).rows.map((r) => r.name);

beforeAll(async () => {
  db = await bootLiveDb();
  // a stand-in for Supabase storage, then this migration again so its storage part applies to it
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
  `);
  await db.exec(readFileSync(join(__dirname, '..', 'migrations', '20261017400000_contract_signing.sql'), 'utf8'));
  await db.exec('reset search_path');

  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values
      ('${HR}', 'hr@a.co'), ('${LIFE}', 'life@a.co'), ('${ADMIN}', 'admin@a.co'), ('${S1}', 's1@a.co'), ('${S2}', 's2@a.co'),
      ('${HRB}', 'hr@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${LIFE}', 'life@a.co', 'MANAGER', '${A}'), ('${ADMIN}', 'admin@a.co', 'ADMIN', '${A}'),
      ('${S1}', 's1@a.co', 'STAFF', '${A}'), ('${S2}', 's2@a.co', 'STAFF', '${A}'), ('${HRB}', 'hr@b.co', 'HR', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees'], '${A}'), ('MANAGER', array['hr-lifecycle'], '${A}'), ('STAFF', array['dashboard'], '${A}'),
      ('HR', array['employees'], '${B}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", onboarding_status, tenant_id) values
      ('H1', 'Hana', 'Hr', 'hr@a.co', 'approved', '${A}'),
      ('E1', 'Esther', 'One', 's1@a.co', 'approved', '${A}'),
      ('E2', 'Eric', 'Two', 's2@a.co', 'approved', '${A}'),
      ('X1', 'Xena', 'Other', 'x1@b.co', 'approved', '${B}');
  `);
}, 120000);

describe('sending', () => {
  it('HR sends a contract; it starts as sent whatever HR claims, and the employee hears of it', async () => {
    await send(HR, C1, 'E1', A, `, 'Please sign and return', current_date + 14`);
    await as(HR, `update employee_contracts set status = 'accepted' where id = '${C1}'`); // no update policy: nothing happens
    expect(await contract(C1)).toMatchObject({ status: 'sent', sent_by: HR, viewed_at: null, signed_path: null });
    const [n] = await notes('contract_sent', 'E1');
    expect(n.title).toBe('Contract to sign');
    expect(n.message).toMatch(/"Employment contract 2027" to sign by .*Message: Please sign and return\./);
    expect((await rows<{ hr: boolean }>(`select public.hr_only_notification('contract_sent') hr`))[0].hr).toBe(false);
  });

  it('the hr-lifecycle module and administrators can send too; other companies and staff cannot', async () => {
    await send(LIFE, C2, 'E2');
    await send(ADMIN, C3, 'E1');
    await expect(send(S1, '11111111-0000-0000-0000-0000000000f1', 'E1')).rejects.toThrow(/row-level security|Only HR/);
    await expect(send(HRB, '11111111-0000-0000-0000-0000000000f2', 'E1', A)).rejects.toThrow(/row-level security|Unknown employee/);
    await send(HRB, CB, 'X1', B);
  });

  it('checks the file is in the contract’s folder and the sign-by date', async () => {
    const id = '11111111-0000-0000-0000-0000000000f3';
    await expect(
      as(HR, `insert into employee_contracts (id, employee_number, title, file_path) values ('${id}', 'E2', 'X', '${A}/${C1}/original-x.pdf')`)
    ).rejects.toThrow(/own folder/);
    await expect(
      as(HR, `insert into employee_contracts (id, employee_number, title, file_path) values ('${id}', 'E2', 'X', '${B}/${id}/original-x.pdf')`)
    ).rejects.toThrow(/own folder/);
    await expect(
      as(HR, `insert into employee_contracts (id, employee_number, title, file_path, sign_by) values ('${id}', 'E2', 'X', '${A}/${id}/original-x.pdf', current_date - 1)`)
    ).rejects.toThrow(/in the past/);
    await expect(
      as(HR, `insert into employee_contracts (id, employee_number, title, file_path) values ('${id}', 'E2', '  ', '${A}/${id}/original-x.pdf')`)
    ).rejects.toThrow(/check/i);
  });
});

describe('who sees what', () => {
  it('an employee sees only their own contracts; not colleagues’ or another company’s', async () => {
    expect((await read<{ id: string }>(S1, `select id from employee_contracts order by id`)).map((r) => r.id)).toEqual([C1, C3]);
    expect((await read<{ id: string }>(S2, `select id from employee_contracts`)).map((r) => r.id)).toEqual([C2]);
  });

  it('HR sees every contract in its company and none of another company’s', async () => {
    expect((await read<{ id: string }>(HR, `select id from employee_contracts order by id`)).map((r) => r.id)).toEqual([C1, C2, C3]);
    expect((await read<{ id: string }>(HRB, `select id from employee_contracts`)).map((r) => r.id)).toEqual([CB]);
  });

  it('signed-out visitors see nothing', async () => {
    await asAnon(db, async () => {
      await expect(db.query(`select 1 from employee_contracts`)).rejects.toThrow(/permission denied/);
    });
  });
});

describe('the employee signs', () => {
  it('opening it marks it viewed, once; HR opening it does not; a colleague cannot', async () => {
    await read(HR, `select public.contract_mark_viewed('${C1}')`);
    expect((await contract(C1)).status).toBe('sent');
    await expect(read(S2, `select public.contract_mark_viewed('${C1}')`)).rejects.toThrow(/not found/);
    await read(S1, `select public.contract_mark_viewed('${C1}')`);
    const first = await contract(C1);
    expect(first.status).toBe('viewed');
    expect(first.viewed_at).not.toBeNull();
    await read(S1, `select public.contract_mark_viewed('${C1}')`);
    expect((await contract(C1)).viewed_at).toEqual(first.viewed_at);
  });

  it('cannot change the contract directly', async () => {
    await as(S1, `update employee_contracts set status = 'accepted' where id = '${C1}'`);
    expect((await contract(C1)).status).toBe('viewed');
  });

  it('uploads the signed copy: signed, and HR hears of it (not the employee’s bell)', async () => {
    await expect(read(S1, `select public.contract_submit_signed('${C1}', '${A}/${C2}/signed-a.pdf', 'signed.pdf')`)).rejects.toThrow(/own folder/);
    await expect(read(S1, `select public.contract_submit_signed('${C1}', '${A}/${C1}/original-a.pdf', 'signed.pdf')`)).rejects.toThrow(/own folder/);
    await expect(read(S2, `select public.contract_submit_signed('${C1}', '${A}/${C1}/signed-a.pdf', 'signed.pdf')`)).rejects.toThrow(/not found/);
    await read(S1, `select public.contract_submit_signed('${C1}', '${A}/${C1}/signed-a.pdf', 'signed.pdf')`);
    expect(await contract(C1)).toMatchObject({ status: 'signed', signed_path: `${A}/${C1}/signed-a.pdf` });
    const [n] = await notes('contract_signed', 'E1');
    expect(n).toMatchObject({ title: 'Signed contract to review' });
    expect(n.message).toMatch(/Esther One returned their signed "Employment contract 2027"/);
    expect((await rows<{ hr: boolean }>(`select public.hr_only_notification('contract_signed') hr`))[0].hr).toBe(true);
  });

  it('can replace the signed copy while HR has not accepted it', async () => {
    await read(S1, `select public.contract_submit_signed('${C1}', '${A}/${C1}/signed-b.pdf', 'signed2.pdf')`);
    expect(await contract(C1)).toMatchObject({ status: 'signed', signed_path: `${A}/${C1}/signed-b.pdf` });
  });
});

describe('HR reviews', () => {
  it('staff cannot accept or send back, and nor can another company', async () => {
    await expect(read(S1, `select public.contract_review('${C1}', true)`)).rejects.toThrow(/Only HR/);
    await expect(read(HRB, `select public.contract_review('${C1}', true)`)).rejects.toThrow(/not found/);
    await expect(read(S1, `select public.contract_cancel('${C1}')`)).rejects.toThrow(/Only HR/);
  });

  it('only a signed contract can be reviewed; sending back needs a reason', async () => {
    await expect(read(HR, `select public.contract_review('${C2}', true)`)).rejects.toThrow(/signed copy waiting/);
    await expect(read(HR, `select public.contract_review('${C1}', false, '  ')`)).rejects.toThrow(/what needs fixing/);
  });

  it('sent back with a reason: the employee hears of it and uploads again', async () => {
    await read(HR, `select public.contract_review('${C1}', false, 'Signature missing on page 3')`);
    expect(await contract(C1)).toMatchObject({ status: 'sent_back', send_back_reason: 'Signature missing on page 3', reviewed_by: HR });
    const [n] = await read<{ title: string; message: string }>(S1, `select title, message from hr_notifications where notification_type = 'contract_sent_back'`);
    expect(n.title).toBe('Contract sent back');
    expect(n.message).toMatch(/What to fix: Signature missing on page 3\./);
    await read(S1, `select public.contract_submit_signed('${C1}', '${A}/${C1}/signed-c.pdf', 'signed3.pdf')`);
    expect(await contract(C1)).toMatchObject({ status: 'signed', signed_path: `${A}/${C1}/signed-c.pdf`, reviewed_by: null });
    expect(await notes('contract_signed', 'E1')).toHaveLength(3);
  });

  it('accepted: the employee hears of it and can no longer replace it; it cannot be cancelled', async () => {
    await read(HR, `select public.contract_review('${C1}', true)`);
    expect((await contract(C1)).status).toBe('accepted');
    expect(await notes('contract_accepted', 'E1')).toHaveLength(1);
    await expect(read(S1, `select public.contract_submit_signed('${C1}', '${A}/${C1}/signed-d.pdf', 'x.pdf')`)).rejects.toThrow(/already accepted/);
    await expect(read(HR, `select public.contract_review('${C1}', false, 'again')`)).rejects.toThrow(/signed copy waiting/);
    await expect(read(HR, `select public.contract_cancel('${C1}')`)).rejects.toThrow(/already accepted/);
  });

  it('HR cancels a contract: the employee no longer sees it or can sign it', async () => {
    await read(HR, `select public.contract_cancel('${C3}', 'Wrong template')`);
    expect((await contract(C3)).status).toBe('cancelled');
    expect((await read<{ id: string }>(S1, `select id from employee_contracts`)).map((r) => r.id)).toEqual([C1]);
    await expect(read(S1, `select public.contract_submit_signed('${C3}', '${A}/${C3}/signed-a.pdf', 'x.pdf')`)).rejects.toThrow(/not found/);
  });

  it('renumbering an employee moves their contracts along', async () => {
    await db.exec(`update employees set "Employee Number" = 'E2B' where tenant_id = '${A}' and "Employee Number" = 'E2'`);
    expect((await rows<{ employee_number: string }>(`select employee_number from employee_contracts where id = '${C2}'`))[0].employee_number).toBe('E2B');
    await db.exec(`update employees set "Employee Number" = 'E2' where tenant_id = '${A}' and "Employee Number" = 'E2B'`);
  });
});

describe('the files', () => {
  it('the bucket is private', async () => {
    expect(await rows(`select public from storage.buckets where id = 'employee-contracts'`)).toEqual([{ public: false }]);
  });

  it('HR saves contract files in its own company only', async () => {
    await asUser(db, HR, async () => {
      await expect(put(`${A}/${C1}/original-x.pdf`)).resolves.toBeTruthy();
      await expect(put(`${A}/${C2}/original-x.pdf`)).resolves.toBeTruthy();
      await expect(put(`${B}/${CB}/original-x.pdf`)).rejects.toThrow(/row-level security/);
      await expect(put(`${A}/original-x.pdf`)).rejects.toThrow(/row-level security/);
    });
    await asUser(db, HRB, async () => {
      await expect(put(`${B}/${CB}/original-x.pdf`)).resolves.toBeTruthy();
    });
  });

  it('an employee saves signed copies only for their own open contracts', async () => {
    await asUser(db, S2, async () => {
      await expect(put(`${A}/${C2}/signed-a.pdf`)).resolves.toBeTruthy();
      await expect(put(`${A}/${C2}/original-y.pdf`)).rejects.toThrow(/row-level security/); // not as the contract
      await expect(put(`${A}/${C1}/signed-a.pdf`)).rejects.toThrow(/row-level security/); // a colleague's
    });
    await asUser(db, S1, async () => {
      await expect(put(`${A}/${C1}/signed-z.pdf`)).rejects.toThrow(/row-level security/); // accepted: closed
    });
  });

  it('an employee opens only their own contracts’ files; HR its company’s; nobody another company’s', async () => {
    expect(await asUser(db, S1, visible)).toEqual([`${A}/${C1}/original-x.pdf`]);
    expect(await asUser(db, S2, visible)).toEqual([`${A}/${C2}/original-x.pdf`, `${A}/${C2}/signed-a.pdf`]);
    expect(await asUser(db, HR, visible)).toEqual([`${A}/${C1}/original-x.pdf`, `${A}/${C2}/original-x.pdf`, `${A}/${C2}/signed-a.pdf`]);
    expect(await asUser(db, HRB, visible)).toEqual([`${B}/${CB}/original-x.pdf`]);
    await asAnon(db, async () => expect(await visible()).toEqual([]));
  });

  it('an employee may remove their own earlier signed copy, not the contract HR sent', async () => {
    await asUser(db, S2, async () => {
      expect((await db.query(`delete from storage.objects where name = '${A}/${C2}/original-x.pdf' returning 1`)).rows).toHaveLength(0);
      expect((await db.query(`delete from storage.objects where name = '${A}/${C2}/signed-a.pdf' returning 1`)).rows).toHaveLength(1);
    });
  });
});
