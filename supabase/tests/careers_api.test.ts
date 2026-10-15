// @vitest-environment node
//
// Careers API (20261016500000, FIG-838): each company's careers slug and allowed websites, which postings are public,
// and the server-only functions the public API uses. Only open, public postings of the slug's own company are ever
// listed; an application lands in that company, in the job's first stage, with its history and a bell notification.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const ADMIN = '00000000-0000-0000-0000-00000000c801';
const REC = '00000000-0000-0000-0000-00000000c802'; // recruitment, no settings
const STAFF = '00000000-0000-0000-0000-00000000c803';
const B_ADMIN = '00000000-0000-0000-0000-00000000c804';
const CV = (tenant: string) => `careers/${tenant}/0f8fad5b-d9cb-469f-a165-70867728950e.pdf`;

let db: PGlite;
const jobs: Record<string, string> = {};
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const run = async (sql: string) => {
  try {
    await db.query(sql);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const asService = async <T>(fn: () => Promise<T>) => {
  await db.exec('set role service_role');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
};
const listed = async (tenant: string, job?: string) =>
  asService(() => rows<{ id: string; title: string; salary: string | null }>(
    `select * from careers_jobs('${tenant}'${job ? `, '${job}'` : ''})`
  ));
const apply = (tenant: string, job: string, email = 'jane@mail.com', cv = CV(tenant)) =>
  asService(() =>
    rows<{ application_id: string; duplicate: boolean }>(
      `select * from careers_apply('${tenant}', '${job}', 'Jane', 'Doe', '${email}', '+254 700 000000', 'I would love to',
        '[{"question": "Notice period?", "answer": "One month"}]', '${cv}', 'jane-cv.pdf', 'careers_page')`
    )
  );

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  for (const [id, email, role, tenant] of [
    [ADMIN, 'adm@a.co', 'ADMIN', A], [REC, 'rec@a.co', 'REC', A], [STAFF, 'staff@a.co', 'STAFF', A], [B_ADMIN, 'adm@b.co', 'ADMIN', B],
  ]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${tenant}');
    `);
  }
  await db.exec(`insert into role_permissions (role_name, permissions, tenant_id) values
    ('ADMIN', array['settings', 'recruitment'], '${A}'), ('REC', array['recruitment'], '${A}'), ('STAFF', array['dashboard'], '${A}'),
    ('ADMIN', array['settings', 'recruitment'], '${B}');`);
  const post = async (key: string, tenant: string, extra: string, values: string) => {
    jobs[key] = (
      await rows<{ id: string }>(
        `insert into job_postings (tenant_id, job_title, department, location, job_type, description, requirements, salary_range${extra})
         values ('${tenant}', '${key}', 'Sales', 'Nairobi', 'Full-time', 'Sell things', 'Selling', 'KES 80,000'${values}) returning id`
      )
    )[0].id;
  };
  await post('Public open', A, ', status, is_public', `, 'open', true`);
  await post('Private open', A, ', status', `, 'open'`);
  await post('Public closed', A, ', status, is_public', `, 'closed', true`);
  await post('Public expired', A, ', status, is_public, application_deadline', `, 'open', true, current_date - 1`);
  await post('Other company', B, ', status, is_public', `, 'open', true`);
}, 120000);

describe('careers settings', () => {
  it('every company has a slug from its name; a new company with a taken name gets the next free one', async () => {
    expect((await rows(`select tenant_id, slug from careers_settings order by slug`)).map((r) => r.slug)).toEqual(['figbloom-hr', 'other-co']);
    await db.exec(`insert into tenants (id, name, slug) values (gen_random_uuid(), 'Other Co!', 'other-co-x')`);
    expect((await rows(`select slug from careers_settings order by slug`)).map((r) => r.slug)).toContain('other-co-2');
  });

  it('Settings changes the slug and websites (tidied); recruiters read them; others and other companies see nothing', async () => {
    expect(await asUser(db, ADMIN, () => run(
      `update careers_settings set slug = 'Acme-Jobs', allowed_origins = array['https://WWW.acme.co.ke/', 'https://www.acme.co.ke', 'http://localhost:5173']`
    ))).toBe('');
    const [a] = await asUser(db, REC, () => rows<{ slug: string; allowed_origins: string[]; updated_by: string }>(`select * from careers_settings`));
    expect(a).toMatchObject({ slug: 'acme-jobs', allowed_origins: ['https://www.acme.co.ke', 'http://localhost:5173'], updated_by: ADMIN });

    expect(await asUser(db, REC, () => rows(`update careers_settings set show_salary = true returning 1`))).toHaveLength(0);
    expect(await asUser(db, STAFF, () => rows(`select * from careers_settings`))).toHaveLength(0);
    expect(await asUser(db, B_ADMIN, () => rows(`select slug from careers_settings`))).toEqual([{ slug: 'other-co' }]);
    expect(await asAnon(db, () => run(`select * from careers_settings`))).toMatch(/permission denied/);
  });

  it('rejects a bad slug, a taken slug and a website that is not an origin', async () => {
    expect(await asUser(db, ADMIN, () => run(`update careers_settings set slug = 'a b'`))).toMatch(/careers address/);
    expect(await asUser(db, ADMIN, () => run(`update careers_settings set slug = 'other-co'`))).toMatch(/duplicate|unique/);
    expect(await asUser(db, ADMIN, () => run(`update careers_settings set allowed_origins = array['https://acme.co.ke/jobs']`))).toMatch(
      /Not a website address/
    );
  });

  it('a recruiter can show a posting on the careers page (off by default)', async () => {
    expect((await rows<{ is_public: boolean }>(`select is_public from job_postings where id = '${jobs['Private open']}'`))[0].is_public).toBe(false);
    expect(await asUser(db, REC, () => run(`update job_postings set is_public = true where id = '${jobs['Private open']}'`))).toBe('');
    expect(await asUser(db, REC, () => run(`update job_postings set is_public = false where id = '${jobs['Private open']}'`))).toBe('');
  });
});

describe('public reads', () => {
  it('finds the company by slug with its brand and websites; nothing for an unknown slug', async () => {
    const [company] = await asService(() => rows(`select * from careers_company(' ACME-jobs ')`));
    expect(company).toMatchObject({ tenant_id: A, slug: 'acme-jobs', company_name: 'Figbloom HR', show_salary: false });
    expect(await asService(() => rows(`select * from careers_company('no-such-company')`))).toHaveLength(0);
  });

  it('a suspended company has no careers page', async () => {
    await db.exec(`update tenants set status = 'suspended' where id = '${B}'`);
    expect(await asService(() => rows(`select * from careers_company('other-co')`))).toHaveLength(0);
    await db.exec(`update tenants set status = 'active' where id = '${B}'`);
  });

  it('lists only open, public, unexpired postings of that company, without the salary unless shown', async () => {
    const list = await listed(A);
    expect(list.map((j) => j.title)).toEqual(['Public open']);
    expect(list[0]).toMatchObject({ department: 'Sales', location: 'Nairobi', employment_type: 'Full-time', salary: null });
    expect(Object.keys(list[0]).sort()).toEqual(
      ['benefits', 'closing_date', 'department', 'description', 'employment_type', 'id', 'job_level', 'location', 'posted_at',
       'requirements', 'responsibilities', 'salary', 'title'].sort()
    );
    await db.exec(`update careers_settings set show_salary = true where tenant_id = '${A}'`);
    expect((await listed(A))[0].salary).toBe('KES 80,000');
    await db.exec(`update careers_settings set show_salary = false where tenant_id = '${A}'`);
  });

  it("never returns another company's posting, or a private one, by id", async () => {
    expect(await listed(A, jobs['Other company'])).toHaveLength(0);
    expect(await listed(A, jobs['Private open'])).toHaveLength(0);
    expect(await listed(B, jobs['Public open'])).toHaveLength(0);
    expect((await listed(B)).map((j) => j.title)).toEqual(['Other company']);
  });

  it('only the server may call the careers functions', async () => {
    expect(await asAnon(db, () => run(`select * from careers_company('acme-jobs')`))).toMatch(/permission denied/);
    expect(await asAnon(db, () => run(`select * from careers_jobs('${A}')`))).toMatch(/permission denied/);
    expect(await asUser(db, ADMIN, () => run(`select * from careers_apply('${A}', '${jobs['Public open']}', 'x', 'y', 'x@y.co', null, null, null, '${CV(A)}', 'cv.pdf')`))).toMatch(
      /permission denied/
    );
  });
});

describe('applying', () => {
  it("lands in the posting's company and first stage, with its history and a notification for HR", async () => {
    const [res] = await apply(A, jobs['Public open']);
    expect(res.duplicate).toBe(false);
    const [app] = await rows<Record<string, unknown>>(
      `select a.*, s.name as stage_name from job_applications a join recruitment_stages s on s.id = a.current_stage_id where a.id = '${res.application_id}'`
    );
    expect(app).toMatchObject({
      tenant_id: A, job_posting_id: jobs['Public open'], stage_name: 'Applied', status: 'pending', first_name: 'Jane', last_name: 'Doe',
      email: 'jane@mail.com', position: 'Public open', source: 'careers_page', resume_file_url: CV(A), resume_file_name: 'jane-cv.pdf',
      cover_letter: 'I would love to', additional_info: 'Notice period?\nOne month',
    });
    expect(await rows(`select to_stage_name, from_stage_id from application_stage_history where application_id = '${res.application_id}'`)).toEqual([
      { to_stage_name: 'Applied', from_stage_id: null },
    ]);
    const [n] = await rows(`select * from hr_notifications where notification_type = 'application_received'`);
    expect(n).toMatchObject({ tenant_id: A, title: 'New application', message: 'Jane Doe applied for Public open on your careers page.', email_sent: true });
    // HR sees it in their pipeline; the other company doesn't
    expect(await asUser(db, REC, () => rows(`select id from job_applications where id = '${res.application_id}'`))).toHaveLength(1);
    expect(await asUser(db, B_ADMIN, () => rows(`select id from job_applications where id = '${res.application_id}'`))).toHaveLength(0);
  });

  it('the same email applying again for the same job adds nothing', async () => {
    const [again] = await apply(A, jobs['Public open'], 'JANE@mail.com');
    expect(again.duplicate).toBe(true);
    expect(await rows(`select 1 from job_applications where job_posting_id = '${jobs['Public open']}'`)).toHaveLength(1);
  });

  it("refuses a job that isn't listed, another company's job, and a CV from another company's folder", async () => {
    await expect(apply(A, jobs['Private open'], 'a@b.co')).rejects.toThrow(/not open/);
    await expect(apply(A, jobs['Public closed'], 'a@b.co')).rejects.toThrow(/not open/);
    await expect(apply(A, jobs['Other company'], 'a@b.co')).rejects.toThrow(/not open/);
    await expect(apply(A, jobs['Public open'], 'b@b.co', CV(B))).rejects.toThrow(/CV/);
    await expect(apply(A, jobs['Public open'], 'not-an-email')).rejects.toThrow(/email/);
    expect(await rows(`select 1 from job_applications where tenant_id = '${B}'`)).toHaveLength(0);
  });
});
