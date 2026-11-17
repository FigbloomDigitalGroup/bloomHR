// @vitest-environment node
//
// Signed offer letters (20261026200000): sending keeps the sender's drawn signature and name on the offer, accepting
// keeps the candidate's, the candidate's page shows both, and nobody writes them any other way.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const HR = '00000000-0000-0000-0000-00000000c411';
const SIG = 'data:image/png;base64,iVBORw0KGgo=';
const CAND = 'data:image/png;base64,Q0FORA==';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) => asUser(db, user, () => rows<T>(sql, params));
const anon = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => asAnon(db, () => rows<T>(sql, params));
const fails = (p: Promise<unknown>) => p.then(() => '', (e) => (e as Error).message);
const newOffer = async () =>
  (await as<{ id: string }>(HR, `insert into job_offers (candidate_first_name, candidate_email, job_title, body, start_date, expiry_date)
    values ('Jane', 'jane@gmail.com', 'Accountant', 'Dear {{candidate_name}}', current_date + 30, current_date + 7) returning id`))[0].id;
const offer = async (id: string) =>
  (await rows<{ status: string; signature: string | null; signed_by: string | null; candidate_signature: string | null }>(
    `select status, signature, signed_by, candidate_signature from job_offers where id = $1`, [id]))[0];

beforeAll(async () => {
  db = await bootDb();
  await db.exec(`delete from public.role_permissions where tenant_id = '${A}'`);
  await db.exec(`
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${HR}', 'hr@a.co', 'HR', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values ('HR', array['employees'], '${A}');
  `);
}, 120000);

describe('signing an offer', () => {
  it('sending keeps the sender’s signature and name; the candidate sees both, and signs to accept', async () => {
    const id = await newOffer();
    const token = (await as<{ t: string }>(HR, `select send_offer($1, $2, $3) t`, [id, SIG, ' Mary Hr ']))[0].t;
    expect(await offer(id)).toMatchObject({ status: 'sent', signature: SIG, signed_by: 'Mary Hr', candidate_signature: null });

    const page = (await anon<{ o: Record<string, unknown> }>(`select offer_by_token($1) o`, [token]))[0].o;
    expect(page).toMatchObject({ signature: SIG, signed_by: 'Mary Hr', candidate_signature: null });

    expect(await anon<{ s: string }>(`select respond_to_offer($1, true, null, $2) s`, [token, CAND])).toEqual([{ s: 'accepted' }]);
    expect(await offer(id)).toMatchObject({ status: 'accepted', candidate_signature: CAND });
    expect((await anon<{ o: Record<string, unknown> }>(`select offer_by_token($1) o`, [token]))[0].o).toMatchObject({ candidate_signature: CAND });
  });

  it('a decline keeps no signature; anything but a drawn PNG is refused', async () => {
    const id = await newOffer();
    expect(await fails(as(HR, `select send_offer($1, $2)`, [id, 'data:text/html;base64,PHNjcmlwdD4=']))).toMatch(/drawn signature/);
    const token = (await as<{ t: string }>(HR, `select send_offer($1) t`, [id]))[0].t; // no signature: allowed, left blank
    expect(await fails(anon(`select respond_to_offer($1, true, null, 'javascript:alert(1)')`, [token]))).toMatch(/drawn signature/);
    await anon(`select respond_to_offer($1, false, 'Took another job', $2)`, [token, CAND]);
    expect(await offer(id)).toMatchObject({ status: 'declined', signature: null, candidate_signature: null });
  });

  it('the old calls still work (one argument to send, three to answer)', async () => {
    const id = await newOffer();
    const token = (await as<{ t: string }>(HR, `select send_offer($1) t`, [id]))[0].t;
    expect(await anon<{ s: string }>(`select respond_to_offer($1, true) s`, [token])).toEqual([{ s: 'accepted' }]);
  });

  it('HR can’t put on, change or remove a signature by hand', async () => {
    const id = await newOffer();
    await as(HR, `update job_offers set signature = $1, candidate_signature = $1, signed_by = 'Forged' where id = $2`, [SIG, id]);
    expect(await offer(id)).toMatchObject({ signature: null, signed_by: null, candidate_signature: null });
    await as(HR, `select send_offer($1, $2, 'Mary Hr')`, [id, SIG]);
    expect(await fails(as(HR, `update job_offers set signature = null where id = $1`, [id]))).toMatch(/can no longer be changed/);
    expect(await offer(id)).toMatchObject({ signature: SIG });
    expect(await fails(as(HR, `insert into job_offers (candidate_first_name, job_title, body, candidate_signature) values ('X', 'Y', 'Z', $1)`, [CAND])))
      .toBe('');
    expect((await rows(`select candidate_signature from job_offers where candidate_first_name = 'X'`))[0]).toEqual({ candidate_signature: null });
  });

  it('the default template signs off with the signature', async () => {
    const t = await rows<{ body: string }>(`select body from offer_letter_templates where tenant_id = '${A}' and is_default`);
    expect(t[0].body).toMatch(/Yours sincerely,\r?\n\r?\n\{\{signature\}\}\r?\n\{\{company_name\}\}$/);
    expect((await rows<{ b: string }>(`select default_offer_letter_body() b`))[0].b).toContain('{{signature}}');
  });
});
