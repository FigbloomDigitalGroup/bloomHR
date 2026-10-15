// @vitest-environment node
//
// The public careers API (FIG-838), run through the real app (so the app-wide CORS can't get in front of it). The
// database functions are stood in for here; supabase/tests/careers_api.test.ts checks what they return. These check
// the route: unknown slugs, CORS per company, the form token and honeypot, CV checks, rate limits, and that an
// application goes to the slug's own company.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const JOB_A = '11111111-1111-4111-8111-111111111111';
const JOB_B = '22222222-2222-4222-8222-222222222222';
const PDF = Buffer.from('%PDF-1.7\n...');

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  companies: [] as Row[],
  jobs: [] as Row[],
  files: new Map<string, Buffer>(),
  removed: [] as string[],
  applied: [] as Row[],
  rate: new Map<string, number>(),
  sends: [] as Row[],
}));

vi.mock('@supabase/supabase-js', () => {
  const rpc = async (name: string, args: Row) => {
    if (name === 'careers_company') return { data: state.companies.filter((c) => c.slug === args.p_slug), error: null };
    if (name === 'careers_jobs') {
      return { data: state.jobs.filter((j) => j.tenant === args.p_tenant && (!args.p_job || j.id === args.p_job)), error: null };
    }
    if (name === 'take_rate_limit') {
      const key = `${args.p_tenant}/${args.p_bucket}`;
      const used = state.rate.get(key) ?? 0;
      if (used + (args.p_cost as number) > (args.p_limit as number)) return { data: false, error: null };
      state.rate.set(key, used + (args.p_cost as number));
      return { data: true, error: null };
    }
    if (name === 'careers_apply') {
      const duplicate = state.applied.some((a) => a.p_job === args.p_job && a.p_email === args.p_email);
      if (!duplicate) state.applied.push(args);
      return { data: [{ application_id: 'app-1', duplicate }], error: null };
    }
    return { data: null, error: { message: `unexpected rpc ${name}` } };
  };
  const query = () => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in']) b[m] = () => b;
    b.limit = async () => ({ data: [{ email: 'hr@a.co' }, { email: 'admin@a.co' }], error: null });
    b.maybeSingle = async () => ({ data: null, error: null });
    return b;
  };
  const bucket = {
    createSignedUploadUrl: async (path: string) => ({ data: { signedUrl: `https://storage.test/upload/${path}?token=t`, token: 't', path }, error: null }),
    download: async (path: string) => {
      const file = state.files.get(path);
      return file ? { data: new Blob([file]), error: null } : { data: null, error: { message: 'Object not found' } };
    },
    remove: async (paths: string[]) => {
      state.removed.push(...paths);
      return { data: null, error: null };
    },
  };
  const client = {
    rpc,
    from: () => query(),
    storage: { from: () => bucket },
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  };
  return { createClient: () => client };
});

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (msg: Row) => {
        state.sends.push(msg);
        return { error: null };
      },
    };
  },
}));

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';

let server: Server;
let base: string;

beforeAll(async () => {
  const { buildApp } = await import('../app.js');
  server = createServer(buildApp());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/careers`;
});
afterAll(() => server.close());

beforeEach(() => {
  state.companies = [
    { tenant_id: A, slug: 'acme', company_name: 'Acme', logo_url: 'https://cdn/logo.png', primary_color: '#0F766E', allowed_origins: ['https://www.acme.co.ke'], show_salary: false },
    { tenant_id: B, slug: 'other-co', company_name: 'Other Co', allowed_origins: ['https://other.co'], show_salary: false },
  ];
  state.jobs = [
    { tenant: A, id: JOB_A, title: 'Sales Rep', department: 'Sales', salary: null },
    { tenant: B, id: JOB_B, title: 'Driver', department: 'Logistics', salary: null },
  ];
  state.files = new Map();
  state.removed = [];
  state.applied = [];
  state.rate = new Map();
  state.sends = [];
  process.env.CAREERS_MIN_FILL_SECONDS = '0';
  process.env.RESEND_API_KEY = 're_test';
  delete process.env.TURNSTILE_SECRET;
});

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const tokenFor = async (slug = 'acme', job = JOB_A) => (await (await fetch(`${base}/${slug}/jobs/${job}`)).json()).form_token as string;
const uploadCv = async (bytes: Buffer = PDF, name = 'cv.pdf') => {
  const res = await fetch(`${base}/acme/jobs/${JOB_A}/cv-upload`, json({ file_name: name, size: bytes.length }));
  const body = await res.json();
  if (res.ok) state.files.set(body.path, bytes);
  return body as { path: string; upload_url: string; error?: string };
};
const application = async (extra: Record<string, unknown> = {}) => ({
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane@mail.com',
  phone: '+254 700 000000',
  cover_note: 'Hello',
  answers: [{ question: 'Notice?', answer: 'One month' }],
  cv_path: 'cv_path' in extra ? extra.cv_path : (await uploadCv()).path,
  cv_name: 'jane cv.pdf',
  form_token: await tokenFor(),
  website: '',
  ...extra,
});
const apply = async (body: Record<string, unknown>, headers: Record<string, string> = {}, slug = 'acme', job = JOB_A) =>
  fetch(`${base}/${slug}/jobs/${job}/apply`, json(body, headers));

describe('reading jobs', () => {
  it("lists the slug's own jobs with the company's brand, cached", async () => {
    const res = await fetch(`${base}/acme/jobs`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/public, max-age=60/);
    const body = await res.json();
    expect(body.company).toEqual({
      slug: 'acme', name: 'Acme', tagline: null, logo_url: 'https://cdn/logo.png', primary_color: '#0F766E', secondary_color: null,
      website: null, description: null,
    });
    expect(body.company.tenant_id).toBeUndefined();
    expect(body.company.allowed_origins).toBeUndefined();
    expect(body.jobs.map((j: Row) => j.title)).toEqual(['Sales Rep']);
  });

  it("404s an unknown slug, and another company's job under this slug", async () => {
    expect((await fetch(`${base}/no-such-co/jobs`)).status).toBe(404);
    expect((await fetch(`${base}/NOT A SLUG/jobs`)).status).toBe(404);
    expect((await fetch(`${base}/acme/jobs/${JOB_B}`)).status).toBe(404);
    expect((await fetch(`${base}/acme/jobs/not-a-uuid`)).status).toBe(404);
  });

  it('gives one job with a form token, cached by the browser only', async () => {
    const res = await fetch(`${base}/acme/jobs/${JOB_A}`);
    expect(res.headers.get('cache-control')).toMatch(/^private/);
    const body = await res.json();
    expect(body.job.title).toBe('Sales Rep');
    expect(body.form_token).toMatch(/^\d{13}\./);
  });

  it('rate-limits reads per visitor', async () => {
    state.rate.set(`${A}/careers:read:${[...(await import('node:crypto')).createHash('sha256').update('127.0.0.1').digest('hex')].slice(0, 32).join('')}`, 120);
    const limited = await fetch(`${base}/acme/jobs`, { headers: { 'X-Forwarded-For': '127.0.0.1' } });
    expect(limited.status).toBe(429);
    expect((await fetch(`${base}/acme/jobs`, { headers: { 'X-Forwarded-For': '10.0.0.9' } })).status).toBe(200);
  });
});

describe('CORS', () => {
  it("allows the company's own websites, with a preflight", async () => {
    const res = await fetch(`${base}/acme/jobs`, { headers: { Origin: 'https://www.acme.co.ke' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://www.acme.co.ke');
    const pre = await fetch(`${base}/acme/jobs/${JOB_A}/apply`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://www.acme.co.ke', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it("refuses other websites, including another company's", async () => {
    for (const origin of ['https://evil.example', 'https://other.co', 'null']) {
      const res = await fetch(`${base}/acme/jobs`, { headers: { Origin: origin } });
      expect(res.status).toBe(403);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
    const pre = await fetch(`${base}/acme/jobs`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
    expect(pre.status).toBe(403);
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('allows this site itself (the hosted careers page)', async () => {
    const res = await fetch(`${base}/acme/jobs`, { headers: { Origin: base.replace(/\/api\/careers$/, '') } });
    expect(res.status).toBe(200);
    process.env.SITE_URL = 'https://hr.example.com';
    expect((await fetch(`${base}/acme/jobs`, { headers: { Origin: 'https://hr.example.com' } })).status).toBe(200);
    delete process.env.SITE_URL;
  });
});

describe('applying', () => {
  it("lands in the slug's company with a neutral answer, and HR is emailed", async () => {
    const res = await apply(await application(), { Origin: 'https://www.acme.co.ke' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: expect.stringMatching(/Thank you for applying/) });
    expect(state.applied).toHaveLength(1);
    expect(state.applied[0]).toMatchObject({
      p_tenant: A, p_job: JOB_A, p_first_name: 'Jane', p_email: 'jane@mail.com', p_resume_name: 'jane cv.pdf',
      p_answers: [{ question: 'Notice?', answer: 'One month' }], p_source: 'careers_api',
    });
    expect(String(state.applied[0].p_resume_path)).toMatch(new RegExp(`^careers/${A}/[0-9a-f-]{36}\\.pdf$`));
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0]).toMatchObject({ to: ['hr@a.co', 'admin@a.co'], subject: 'New application: Jane Doe for Sales Rep' });
  });

  it('a repeat application gets the same answer without a second email', async () => {
    await apply(await application());
    const again = await apply(await application());
    expect(again.status).toBe(200);
    expect(state.sends).toHaveLength(1);
  });

  it("can't apply to another company's job through this slug", async () => {
    const res = await apply(await application(), {}, 'acme', JOB_B);
    expect(res.status).toBe(404);
    expect(state.applied).toHaveLength(0);
  });

  it('the honeypot and a too-fast form get the neutral answer and save nothing', async () => {
    const trap = await apply(await application({ website: 'http://spam.example' }));
    expect(trap.status).toBe(200);
    expect((await trap.json()).ok).toBe(true);

    const body = await application();
    process.env.CAREERS_MIN_FILL_SECONDS = '60';
    const fast = await apply(body);
    expect(fast.status).toBe(200);
    expect(state.applied).toHaveLength(0);
  });

  it('refuses a missing or forged form token, and a token for another job', async () => {
    expect((await apply(await application({ form_token: undefined }))).status).toBe(400);
    expect((await apply(await application({ form_token: `${Date.now() - 60_000}.forged` }))).status).toBe(400);
    expect((await apply(await application({ form_token: await tokenFor('other-co', JOB_B) }))).status).toBe(400);
    expect(state.applied).toHaveLength(0);
  });

  it('validates the fields', async () => {
    const bad = await apply(await application({ email: 'not-an-email' }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/email/);
    expect((await apply(await application({ first_name: '' }))).status).toBe(400);
    expect((await apply(await application({ phone: 'call me' }))).status).toBe(400);
    expect((await apply(await application({ answers: Array.from({ length: 21 }, () => ({ question: 'q', answer: 'a' })) }))).status).toBe(400);
  });

  it('rejects a CV of the wrong type or size before upload, and a file that is not what it claims after', async () => {
    const exe = await fetch(`${base}/acme/jobs/${JOB_A}/cv-upload`, json({ file_name: 'cv.exe', size: 100 }));
    expect(exe.status).toBe(400);
    const big = await fetch(`${base}/acme/jobs/${JOB_A}/cv-upload`, json({ file_name: 'cv.pdf', size: 5 * 1024 * 1024 + 1 }));
    expect(big.status).toBe(400);
    expect((await big.json()).error).toMatch(/5 MB/);

    // the upload address is for this company's folder only
    const ok = await uploadCv();
    expect(ok.path).toMatch(new RegExp(`^careers/${A}/`));
    expect(ok.upload_url).toContain(ok.path);

    // uploaded something else under a .pdf name: refused, and removed
    const fake = await uploadCv(Buffer.from('MZ\x90\x00 not a pdf'), 'cv.pdf');
    const res = await apply(await application({ cv_path: fake.path }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/PDF, DOC or DOCX/);
    expect(state.removed).toEqual([fake.path]);

    // too big once uploaded
    const huge = await uploadCv(Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]), 'cv.pdf');
    expect((await apply(await application({ cv_path: huge.path }))).status).toBe(400);

    // never uploaded, or another company's folder
    expect((await apply(await application({ cv_path: `careers/${A}/0f8fad5b-d9cb-469f-a165-70867728950e.pdf` }))).status).toBe(400);
    expect((await apply(await application({ cv_path: `careers/${B}/0f8fad5b-d9cb-469f-a165-70867728950e.pdf` }))).status).toBe(400);
    expect(state.applied).toHaveLength(0);
  });

  it('accepts DOCX and DOC files by their contents', async () => {
    const docx = await uploadCv(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]), 'cv.docx');
    expect((await apply(await application({ cv_path: docx.path }))).status).toBe(200);
    const doc = await uploadCv(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2]), 'cv.DOC');
    expect((await apply(await application({ cv_path: doc.path, email: 'other@mail.com' }))).status).toBe(200);
    expect(state.applied).toHaveLength(2);
  });

  it('rate-limits applications per visitor and per email address', async () => {
    for (let i = 0; i < 3; i++) expect((await apply(await application({ email: `p${i}@mail.com` }))).status).toBe(200);
    // a fourth from the same email (any job) is refused
    const sameEmail = await apply(await application({ email: 'p0@mail.com' }));
    expect(sameEmail.status).toBe(200); // p0 again is still allowed by the email budget (1 of 3) ...
    for (let i = 3; i < 5; i++) await apply(await application({ email: `p${i}@mail.com` }));
    // ... but the visitor has now used 5 applications this hour
    const limited = await apply(await application({ email: 'new@mail.com' }));
    expect(limited.status).toBe(429);

    state.rate = new Map();
    for (let i = 0; i < 3; i++) await apply(await application({ email: 'same@mail.com' }), { 'X-Forwarded-For': `10.0.0.${i}` });
    const fourth = await apply(await application({ email: 'same@mail.com' }), { 'X-Forwarded-For': '10.0.0.99' });
    expect(fourth.status).toBe(429);
    expect((await fourth.json()).error).toMatch(/tomorrow/);
  });

  it('checks Cloudflare Turnstile when TURNSTILE_SECRET is set', async () => {
    process.env.TURNSTILE_SECRET = 'secret';
    const realFetch = globalThis.fetch;
    const verify = vi.fn(async () => new Response(JSON.stringify({ success: false })));
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      String(url).startsWith('https://challenges.cloudflare.com') ? verify() : realFetch(url, init)
    );
    try {
      const res = await apply(await application({ turnstile_token: 'bad' }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/robot/);
      expect(verify).toHaveBeenCalled();
      expect(state.applied).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
