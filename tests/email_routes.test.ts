// @vitest-environment node
//
// The email routes used to need no login at all: anyone who could reach the server could send mail from the company
// address and read its sent-mail log. These tests run the real email_routes.js against an in-memory fake of the Supabase
// client and fake mail providers, and check who may send, what is rejected before anything is sent, and what the
// browser is (not) told when something goes wrong.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'tenant-a';

const state = vi.hoisted(() => ({
  profiles: [] as { user_id: string; email: string; role: string; account_status: string; tenant_id: string }[],
  permissions: [] as { tenant_id: string; role_name: string; permissions: string[] }[],
  authUsers: [] as { id: string; email: string }[],
  resendSends: [] as Record<string, unknown>[],
  resendResult: { data: { id: 're_1' }, error: null } as { data: { id: string } | null; error: unknown },
  smtpSends: [] as Record<string, unknown>[],
  cpanelLogins: [] as string[],
  smtpError: null as Error | null,
  sentEmails: [] as Record<string, unknown>[],
  logCalls: [] as string[],
  logReply: { ok: true, status: 200, json: { data: [{ id: 'e1' }] } } as { ok: boolean; status: number; json: unknown },
  // take_rate_limit(): what each budget has used (the database's sliding window is tested in supabase/tests)
  budgets: new Map<string, number>(),
  budgetCalls: [] as Record<string, unknown>[],
  rateLimitDown: false,
  // queue_bulk_email(): the company's employees' work emails, and what was asked to be queued
  employeeEmails: [] as string[],
  queued: [] as Record<string, any>[],
  // company_mail_servers rows, and every mail transport made (with its login)
  mailServers: [] as Record<string, any>[],
  transports: [] as Record<string, any>[],
  smtpErrorCode: '',
}));

vi.mock('@supabase/supabase-js', () => {
  const table = (rows: () => Record<string, unknown>[]) => {
    const filters: [string, unknown][] = [];
    const matching = () => rows().filter((r) => filters.every(([k, v]) => r[k] === v));
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return b;
      },
      order: () => b, // rows are kept newest first
      range: async (from: number, to: number) => ({ data: matching().slice(from, to + 1), error: null }),
      maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
      insert: async (row: Record<string, unknown>) => {
        rows().unshift({ id: `00000000-0000-4000-8000-${String(rows().length + 1).padStart(12, '0')}`, created_at: new Date().toISOString(), ...row });
        return { error: null };
      },
      // company_mail_servers: one row per tenant
      upsert: async (row: Record<string, unknown>) => {
        const i = rows().findIndex((r) => r.tenant_id === row.tenant_id);
        if (i >= 0) rows()[i] = { ...row };
        else rows().push({ ...row });
        return { error: null };
      },
      update: (patch: Record<string, unknown>) => ({
        eq: async (k: string, v: unknown) => {
          rows().forEach((r) => {
            if (r[k] === v) Object.assign(r, patch);
          });
          return { error: null };
        },
      }),
    };
    return b;
  };
  const client = {
    rpc: async (fn: string, args: Record<string, any>) => {
      if (fn === 'take_rate_limit') {
        if (state.rateLimitDown) return { data: null, error: { message: 'function take_rate_limit does not exist' } };
        state.budgetCalls.push(args);
        const key = `${args.p_tenant}/${args.p_bucket}`;
        const used = state.budgets.get(key) ?? 0;
        if (used + args.p_cost > args.p_limit) return { data: false, error: null };
        state.budgets.set(key, used + args.p_cost);
        return { data: true, error: null };
      }
      if (fn === 'queue_bulk_email') {
        state.queued.push(args);
        const queued = (args.p_emails as string[]).filter((e) => state.employeeEmails.includes(e)).length;
        return { data: [{ bulk_email_id: queued ? 'bulk-1' : null, queued, skipped: args.p_emails.length - queued }], error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    // the bearer token is simply the caller's user id in these tests
    auth: { getUser: async (token: string) => ({ data: { user: state.authUsers.find((u) => u.id === token) ?? null }, error: null }) },
    from: (name: string) => {
      if (name === 'user_profiles') return table(() => state.profiles);
      if (name === 'role_permissions') return table(() => state.permissions);
      if (name === 'sent_emails') return table(() => state.sentEmails);
      if (name === 'company_mail_servers') return table(() => state.mailServers);
      throw new Error(`unexpected table ${name}`);
    },
  };
  return { createClient: () => client };
});

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (msg: Record<string, unknown>) => {
        state.resendSends.push(msg);
        return state.resendResult;
      },
    };
  },
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: (opts: { auth?: { user?: string } }) => {
      state.transports.push(opts);
      return {
        sendMail: async (msg: Record<string, unknown>) => {
          if (state.smtpErrorCode) throw Object.assign(new Error('535 refused hr@client.co.ke pass hunter2'), { code: state.smtpErrorCode });
          if (state.smtpError) throw state.smtpError;
          state.smtpSends.push(msg);
          if (opts?.auth?.user) state.cpanelLogins.push(String(opts.auth.user));
          return { messageId: 'smtp-1' };
        },
      };
    },
  },
}));

vi.mock('node-fetch', () => ({
  default: async (url: string) => {
    state.logCalls.push(url);
    return {
      ok: state.logReply.ok,
      status: state.logReply.status,
      json: async () => state.logReply.json,
      text: async () => 'provider said: secret internal detail',
    };
  },
}));

process.env.SUPABASE_URL = 'http://fake';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
process.env.RESEND_API_KEY = 're_test_key';
process.env.SMTP_FROM = 'HR <hr@example.org>';
process.env.CPANEL_USER = 'hr@example.org';
process.env.CPANEL_PASSWORD = 'cpanel-pass';
process.env.CPANEL_HOST = 'mail.example.org';
process.env.CPANEL_ALLOWED_USERS = 'payroll@example.org, support@example.org';
const KEY = Buffer.alloc(32, 7).toString('base64');

let server: Server;
let base: string;

beforeAll(async () => {
  const express = (await import('express')).default;
  const router = (await import('../email_routes.js')).default;
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api/email', router);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/email`;
});

afterAll(() => {
  server.close();
});

let uid = 0;
beforeEach(() => {
  // fresh users per test so the in-memory rate limit never carries over
  uid += 1;
  const mk = (name: string, role: string) => ({ id: `${name}-${uid}`, email: `${name}${uid}@a.co`, role });
  const users = [mk('admin', 'ADMIN'), mk('hr', 'HR'), mk('staff', 'STAFF'), mk('ops', 'OPERATIONS')];
  state.authUsers = users.map(({ id, email }) => ({ id, email }));
  state.profiles = users.map((u) => ({ user_id: u.id, email: u.email, role: u.role, account_status: 'ACTIVE', tenant_id: TENANT }));
  state.permissions = [
    { tenant_id: TENANT, role_name: 'HR', permissions: ['email-portal', 'hr-lifecycle'] },
    { tenant_id: TENANT, role_name: 'OPERATIONS', permissions: ['employees'] },
    { tenant_id: 'other-tenant', role_name: 'STAFF', permissions: ['email-portal'] }, // must never apply to tenant-a staff
  ];
  state.resendSends = [];
  state.resendResult = { data: { id: 're_1' }, error: null };
  state.smtpSends = [];
  state.cpanelLogins = [];
  state.smtpError = null;
  state.sentEmails = [];
  state.logCalls = [];
  state.logReply = { ok: true, status: 200, json: { data: [{ id: 'e1' }] } };
  state.budgets = new Map();
  state.budgetCalls = [];
  state.rateLimitDown = false;
  state.employeeEmails = [];
  state.queued = [];
  state.mailServers = [];
  state.transports = [];
  state.smtpErrorCode = '';
  process.env.MAIL_SERVER_ENCRYPTION_KEY = KEY;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

const who = (name: string) => state.authUsers.find((u) => u.id.startsWith(`${name}-`))!.id;
const call = (method: string, path: string, token: string | null, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const send = (token: string | null, body: Record<string, unknown>) => call('POST', '/send', token, body);
const mail = { purpose: 'email-portal', to: 'jane@example.org', subject: 'Hello', html: '<p>Hi</p>' };

describe('nobody can send or read logs without signing in and having the permission', () => {
  it('rejects requests with no token or a token that is not a real session', async () => {
    expect((await send(null, mail)).status).toBe(401);
    expect((await send('nobody', mail)).status).toBe(401);
    expect((await call('GET', '/logs', null)).status).toBe(401);
    expect((await call('GET', '/logs/e1', 'nobody')).status).toBe(401);
    expect(state.resendSends).toHaveLength(0);
    expect(state.logCalls).toHaveLength(0);
  });

  it('rejects a role without the module, ignoring another tenant\'s grant', async () => {
    expect((await send(who('staff'), mail)).status).toBe(403);
    expect((await call('GET', '/logs', who('staff'))).status).toBe(403);
    expect(state.resendSends).toHaveLength(0);
    expect(state.logCalls).toHaveLength(0);
  });

  it('lets ADMIN and any role granted the module through', async () => {
    expect((await send(who('admin'), mail)).status).toBe(200);
    expect((await send(who('hr'), mail)).status).toBe(200);
    expect((await call('GET', '/logs', who('hr'))).status).toBe(200);
    expect(state.resendSends).toHaveLength(2);
  });

  it('ties each purpose to its own modules', async () => {
    // OPERATIONS only has "employees": allowed to send a termination email, not to use the Email Portal or send reminders
    expect((await send(who('ops'), { ...mail, purpose: 'termination' })).status).toBe(200);
    expect((await send(who('ops'), { ...mail, purpose: 'email-portal' })).status).toBe(403);
    expect((await send(who('ops'), { ...mail, purpose: 'hr-reminder' })).status).toBe(403);
  });

  it('lets Employees (or Recruitment) send offer letters, and nobody else', async () => {
    expect((await send(who('ops'), { ...mail, purpose: 'offer' })).status).toBe(200);
    expect((await send(who('hr'), { ...mail, purpose: 'offer' })).status).toBe(403);
    expect((await send(who('staff'), { ...mail, purpose: 'offer' })).status).toBe(403);
  });

  it('maps the in-app emails (warnings, recruitment, performance, sign-up approvals) to their own modules', async () => {
    // HR has email-portal + hr-lifecycle only, so none of these four are open to it
    for (const purpose of ['warning', 'recruitment', 'performance', 'staff-signup']) {
      expect((await send(who('hr'), { ...mail, purpose })).status).toBe(403);
      expect((await send(who('admin'), { ...mail, purpose })).status).toBe(200);
    }
  });

  it('refuses an unknown or missing purpose, even for ADMIN', async () => {
    expect((await send(who('admin'), { ...mail, purpose: 'anything' })).status).toBe(400);
    const { purpose: _omit, ...noPurpose } = mail;
    expect((await send(who('admin'), noPurpose)).status).toBe(400);
  });
});

describe('request validation (checked after permission, before anything is sent)', () => {
  it('tells a caller without permission nothing about the rules', async () => {
    const res = await send(who('staff'), { purpose: 'email-portal' });
    expect(res.status).toBe(403);
  });

  it('rejects missing fields, bad recipients and header injection', async () => {
    const admin = who('admin');
    expect((await send(admin, { ...mail, subject: '' })).status).toBe(400);
    expect((await send(admin, { ...mail, html: '  ' })).status).toBe(400);
    expect((await send(admin, { ...mail, to: 'not-an-email' })).status).toBe(400);
    expect((await send(admin, { ...mail, to: 'a@b.co, c@d.co' })).status).toBe(400); // one string, two addresses
    expect((await send(admin, { ...mail, to: 'a@b.co\r\nBcc: spy@x.co' })).status).toBe(400);
    expect((await send(admin, { ...mail, subject: 'Hi\r\nBcc: spy@x.co' })).status).toBe(400);
    expect(state.resendSends).toHaveLength(0);
  });

  it('limits recipients, subject length, body size and attachments', async () => {
    const admin = who('admin');
    const many = Array.from({ length: 51 }, (_, i) => `u${i}@example.org`);
    expect((await send(admin, { ...mail, to: many })).status).toBe(400);
    expect((await send(admin, { ...mail, to: Array.from({ length: 50 }, (_, i) => `u${i}@example.org`) })).status).toBe(200);
    expect((await send(admin, { ...mail, subject: 'x'.repeat(201) })).status).toBe(400);
    expect((await send(admin, { ...mail, html: 'x'.repeat(1_000_001) })).status).toBe(400);
    const file = { filename: 'a.txt', content: 'aGk=' };
    expect((await send(admin, { ...mail, attachments: Array(6).fill(file) })).status).toBe(400);
    expect((await send(admin, { ...mail, attachments: [{ filename: '../../etc/passwd', content: 'aGk=' }] })).status).toBe(400);
    expect((await send(admin, { ...mail, attachments: [{ filename: 'big.bin', content: 'x'.repeat(10_000_001) }] })).status).toBe(400);
    expect((await send(admin, { ...mail, attachments: [file] })).status).toBe(200);
  });

  it('rejects an unknown provider', async () => {
    expect((await send(who('admin'), { ...mail, provider: 'sendgrid' })).status).toBe(400);
  });
});

describe('what is sent', () => {
  it('sends through Resend from the configured address, with the recipients as a list', async () => {
    await send(who('admin'), { ...mail, to: ['a@example.org', 'b@example.org'] });
    expect(state.resendSends[0]).toMatchObject({ from: 'HR <hr@example.org>', to: ['a@example.org', 'b@example.org'], subject: 'Hello' });
  });

  it('never returns provider details or secrets when sending fails', async () => {
    state.resendResult = { data: null, error: { message: 'API key re_test_key is invalid for domain secret.example' } };
    const res = await send(who('admin'), mail);
    expect(res.status).toBe(502);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('re_test_key');
    expect(text).not.toContain('secret.example');
  });

  it('does not leak SMTP errors either', async () => {
    state.smtpError = new Error('535 auth failed for hr@example.org password cpanel-pass');
    const res = await send(who('admin'), { ...mail, provider: 'cpanel' });
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('cpanel-pass');
    expect(text).not.toContain('535');
  });
});

describe('cPanel sender', () => {
  const cpanel = { ...mail, provider: 'cpanel' };

  it('uses the default mailbox when none is chosen', async () => {
    expect((await send(who('admin'), cpanel)).status).toBe(200);
    expect(state.cpanelLogins).toEqual(['hr@example.org']);
  });

  it('allows the mailboxes listed in CPANEL_ALLOWED_USERS', async () => {
    expect((await send(who('admin'), { ...cpanel, cpanelUser: 'payroll@example.org' })).status).toBe(200);
    expect(state.cpanelLogins).toEqual(['payroll@example.org']);
  });

  it('refuses any other mailbox, so the shared password cannot be used for arbitrary senders', async () => {
    const res = await send(who('admin'), { ...cpanel, cpanelUser: 'ceo@example.org' });
    expect(res.status).toBe(403);
    expect(state.smtpSends).toHaveLength(0);
  });
});

describe('limits', () => {
  it('stops one user sending more than 1000 recipients an hour', async () => {
    const admin = who('admin');
    const fifty = Array.from({ length: 50 }, (_, i) => `u${i}@example.org`);
    for (let i = 0; i < 20; i++) expect((await send(admin, { ...mail, to: fifty })).status).toBe(200);
    expect((await send(admin, mail)).status).toBe(429);
  });

  it("counts in the database, shared by every server, per user and per company", async () => {
    const admin = who('admin');
    await send(admin, { ...mail, to: ['a@example.org', 'b@example.org'] });
    expect(state.budgetCalls).toEqual([
      { p_tenant: TENANT, p_bucket: `email-recipients:default:${admin}`, p_cost: 2, p_limit: 1000, p_window_seconds: 3600 },
      { p_tenant: TENANT, p_bucket: 'email-recipients-company:default:company', p_cost: 2, p_limit: 50_000, p_window_seconds: 86400 },
    ]);
  });

  it("stops a company at its daily limit, whoever sends", async () => {
    state.budgets.set(`${TENANT}/email-recipients-company:default:company`, 49_999);
    expect((await send(who('admin'), mail)).status).toBe(200);
    expect((await send(who('hr'), mail)).status).toBe(429);
  });

  it("falls back to this server's own count if the database cannot be asked", async () => {
    state.rateLimitDown = true;
    const admin = who('admin');
    const fifty = Array.from({ length: 50 }, (_, i) => `u${i}@example.org`);
    for (let i = 0; i < 20; i++) expect((await send(admin, { ...mail, to: fifty })).status).toBe(200);
    expect((await send(admin, mail)).status).toBe(429);
  });
});

describe('company-wide email (queued)', () => {
  const bulk = (token: string | null, body: Record<string, unknown>) => call('POST', '/bulk', token, body);
  const everyone = Array.from({ length: 6000 }, (_, i) => `staff${i}@a.co`);

  it('needs a signed-in caller with the Email Portal', async () => {
    const body = { ...mail, to: everyone };
    expect((await bulk(null, body)).status).toBe(401);
    expect((await bulk(who('staff'), body)).status).toBe(403);
    expect((await bulk(who('ops'), body)).status).toBe(403);
    expect((await bulk(who('hr'), { ...body, purpose: 'termination' })).status).toBe(400); // only the Email Portal sends to everyone
    expect(state.queued).toHaveLength(0);
  });

  it('queues thousands at once, beyond the per-user hourly budget, and sends nothing inline', async () => {
    state.employeeEmails = everyone.slice(0, 5999);
    const res = await bulk(who('hr'), { ...mail, to: [...everyone, 'STAFF0@a.co'] });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ id: 'bulk-1', queued: 5999, skipped: 1 });
    expect(state.queued[0]).toMatchObject({
      p_tenant: TENANT, p_created_by: who('hr'), p_purpose: 'email-portal', p_from: 'HR <hr@example.org>', p_subject: 'Hello', p_html: '<p>Hi</p>',
      p_attachments: [],
    });
    expect(state.queued[0].p_emails).toHaveLength(6000); // the same address twice is one person
    expect(state.resendSends).toHaveLength(0);
    expect(state.budgetCalls).toEqual([
      { p_tenant: TENANT, p_bucket: 'email-recipients-company:default:company', p_cost: 6000, p_limit: 50_000, p_window_seconds: 86400 },
    ]);
  });

  it("refuses when nobody on the list is one of the company's employees", async () => {
    const res = await bulk(who('admin'), { ...mail, to: ['stranger@x.co'] });
    expect(res.status).toBe(400);
  });

  it('validates like a single send, and refuses over the daily company limit', async () => {
    const admin = who('admin');
    state.employeeEmails = everyone;
    expect((await bulk(admin, { ...mail, to: [] })).status).toBe(400);
    expect((await bulk(admin, { ...mail, to: 'a@a.co' })).status).toBe(400);
    expect((await bulk(admin, { ...mail, to: Array(25_001).fill('a@a.co') })).status).toBe(400);
    expect((await bulk(admin, { ...mail, to: ['a@b.co\r\nBcc: spy@x.co'] })).status).toBe(400);
    expect((await bulk(admin, { ...mail, to: everyone, subject: 'Hi\r\nBcc: spy@x.co' })).status).toBe(400);
    expect((await bulk(admin, { ...mail, to: everyone, attachments: Array(6).fill({ filename: 'a.txt', content: 'aGk=' }) })).status).toBe(400);
    expect(state.queued).toHaveLength(0);

    state.budgets.set(`${TENANT}/email-recipients-company:default:company`, 45_000);
    expect((await bulk(admin, { ...mail, to: everyone })).status).toBe(429);
    expect(state.queued).toHaveLength(0);
  });
});

describe('sent-mail log', () => {
  const OTHER_ID = '00000000-0000-4000-8000-999999999999';
  const otherCompanysLetter = () =>
    state.sentEmails.push({
      id: OTHER_ID,
      tenant_id: 'other-tenant',
      provider: 'resend',
      provider_id: 're_other',
      to_addresses: ['fired@other.co'],
      subject: 'Termination letter',
      created_at: '2026-01-01T00:00:00Z',
    });

  it("records every send with the caller's company, whichever provider sent it", async () => {
    const admin = who('admin');
    expect((await send(admin, mail)).status).toBe(200);
    expect((await send(admin, { ...mail, provider: 'cpanel' })).status).toBe(200);
    expect(state.sentEmails.map((r) => [r.tenant_id, r.provider, r.provider_id, r.purpose, r.sent_by])).toEqual([
      [TENANT, 'cpanel', 'smtp-1', 'email-portal', admin],
      [TENANT, 'resend', 're_1', 'email-portal', admin],
    ]);
    expect(state.sentEmails[1]).toMatchObject({ to_addresses: ['jane@example.org'], subject: 'Hello' });
  });

  it("lists only the caller's company's mail and never reads the provider's shared list", async () => {
    otherCompanysLetter();
    await send(who('admin'), mail);
    const res = await call('GET', '/logs', who('admin'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ to: ['jane@example.org'], subject: 'Hello' });
    expect(JSON.stringify(body)).not.toContain('Termination letter');
    expect(state.logCalls).toEqual([]);
  });

  it('pages through the log and validates the paging inputs', async () => {
    for (let i = 0; i < 3; i++) await send(who('admin'), { ...mail, subject: `Mail ${i}` });
    const first = await (await call('GET', '/logs?limit=2', who('admin'))).json();
    expect(first.data.map((e: { subject: string }) => e.subject)).toEqual(['Mail 2', 'Mail 1']);
    expect(first).toMatchObject({ has_more: true, next_cursor: '2' });
    const second = await (await call('GET', `/logs?limit=2&cursor=${first.next_cursor}`, who('admin'))).json();
    expect(second.data.map((e: { subject: string }) => e.subject)).toEqual(['Mail 0']);
    expect(second).toMatchObject({ has_more: false, next_cursor: null });

    expect((await call('GET', '/logs?limit=0', who('admin'))).status).toBe(400);
    expect((await call('GET', '/logs?limit=101', who('admin'))).status).toBe(400);
    expect((await call('GET', '/logs?limit=abc', who('admin'))).status).toBe(400);
    expect((await call('GET', '/logs?cursor=abc', who('admin'))).status).toBe(400);
    expect((await call('GET', '/logs/..%2Fdomains', who('admin'))).status).toBe(400);
  });

  it("reads one of the company's emails from the provider, but not another company's", async () => {
    otherCompanysLetter();
    await send(who('admin'), mail);
    const ours = state.sentEmails.find((r) => r.tenant_id === TENANT)!;
    state.logReply = { ok: true, status: 200, json: { id: 're_1', subject: 'Hello', html: '<p>Hi</p>', last_event: 'delivered' } };

    const res = await call('GET', `/logs/${ours.id}`, who('admin'));
    expect(await res.json()).toMatchObject({ id: ours.id, html: '<p>Hi</p>', last_event: 'delivered' });
    expect(state.logCalls).toEqual(['https://api.resend.com/emails/re_1']);

    expect((await call('GET', `/logs/${OTHER_ID}`, who('admin'))).status).toBe(404);
    expect(state.logCalls).toHaveLength(1); // the provider was never asked about the other company's email
  });

  it("still shows the log entry, without the provider's error text, when the provider fails", async () => {
    await send(who('admin'), mail);
    state.logReply = { ok: false, status: 401, json: {} };
    const res = await call('GET', `/logs/${state.sentEmails[0].id}`, who('admin'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ subject: 'Hello', last_event: 'sent' });
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
  });
});

describe("a company's own mail server", () => {
  const settings = {
    host: 'mail.client.co.ke',
    port: 465,
    secure: true,
    username: 'hr@client.co.ke',
    password: 'hunter2',
    from_name: 'Client HR',
    from_address: 'hr@client.co.ke',
    enabled: true,
  };
  const { password: _omit, ...noPassword } = settings;
  const save = (token: string | null, body: Record<string, unknown>) => call('PUT', '/mail-server', token, body);

  it('only the Settings permission (ADMIN) may see, save or test it', async () => {
    for (const name of ['hr', 'staff', 'ops']) {
      expect((await call('GET', '/mail-server', who(name))).status).toBe(403);
      expect((await save(who(name), settings)).status).toBe(403);
      expect((await call('POST', '/mail-server/test', who(name))).status).toBe(403);
    }
    expect((await save(null, settings)).status).toBe(401);
    expect(state.mailServers).toHaveLength(0);
    expect((await save(who('admin'), settings)).status).toBe(200);
  });

  it('stores the password encrypted, and never hands it back, only whether one is set', async () => {
    const res = await save(who('admin'), settings);
    const body = await res.json();
    expect(body.settings).toMatchObject({
      host: 'mail.client.co.ke', port: 465, secure: true, from_address: 'hr@client.co.ke', enabled: true, password_set: true,
    });
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(JSON.stringify(body)).not.toContain('password_encrypted');

    const stored = state.mailServers[0];
    expect(stored.tenant_id).toBe(TENANT);
    expect(stored.password_encrypted).toMatch(/^v1:/);
    expect(stored.password_encrypted).not.toContain('hunter2');
    expect(Buffer.from(stored.password_encrypted.split(':')[3], 'base64').toString()).not.toContain('hunter2');

    const read = await (await call('GET', '/mail-server', who('admin'))).json();
    expect(read.settings.password_set).toBe(true);
    expect(JSON.stringify(read)).not.toContain('hunter2');
    expect(JSON.stringify(read)).not.toContain(stored.password_encrypted);
  });

  it('keeps the saved password when an update leaves it out', async () => {
    await save(who('admin'), settings);
    const before = state.mailServers[0].password_encrypted;
    expect((await save(who('admin'), { ...noPassword, from_name: 'People Team' })).status).toBe(200);
    expect(state.mailServers[0]).toMatchObject({ password_encrypted: before, from_name: 'People Team' });
    await send(who('admin'), mail);
    expect(state.transports.at(-1)).toMatchObject({ auth: { user: 'hr@client.co.ke', pass: 'hunter2' } });
  });

  it('refuses bad settings: unknown ports, private or local hosts, header injection, turning on with no password', async () => {
    const admin = who('admin');
    expect((await save(admin, { ...settings, port: 3306 })).status).toBe(400);
    for (const host of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.169.254', 'not a host', '']) {
      expect((await save(admin, { ...settings, host })).status).toBe(400);
    }
    expect((await save(admin, { ...settings, from_address: 'hr@client.co.ke\r\nBcc: spy@x.co' })).status).toBe(400);
    expect((await save(admin, { ...settings, from_name: 'HR" <ceo@x.co>' })).status).toBe(400);
    expect((await save(admin, noPassword)).status).toBe(400);
    expect(state.mailServers).toHaveLength(0);
  });

  it('says clearly when the encryption key is missing on the server', async () => {
    delete process.env.MAIL_SERVER_ENCRYPTION_KEY;
    const res = await save(who('admin'), settings);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain('MAIL_SERVER_ENCRYPTION_KEY');
    expect(state.mailServers).toHaveLength(0);
  });

  it("sends the company's email through its own server, from its own address, whatever provider is asked for", async () => {
    await save(who('admin'), settings);
    for (const provider of [undefined, 'resend', 'cpanel']) {
      expect((await send(who('hr'), provider ? { ...mail, provider } : mail)).status).toBe(200);
    }
    expect(state.resendSends).toHaveLength(0);
    expect(state.smtpSends).toHaveLength(3);
    expect(state.smtpSends[0]).toMatchObject({ from: '"Client HR" <hr@client.co.ke>', to: ['jane@example.org'], subject: 'Hello' });
    expect(state.transports.at(-1)).toMatchObject({
      host: 'mail.client.co.ke', port: 465, secure: true, auth: { user: 'hr@client.co.ke', pass: 'hunter2' },
    });
    expect(state.sentEmails.map((r) => [r.tenant_id, r.provider, r.from_address])).toEqual(
      Array(3).fill([TENANT, 'own_server', 'hr@client.co.ke']),
    );
  });

  it('uses STARTTLS (never a plain login) on port 587', async () => {
    await save(who('admin'), { ...settings, port: 587, secure: false });
    await send(who('admin'), mail);
    expect(state.transports.at(-1)).toMatchObject({ port: 587, secure: false, requireTLS: true });
  });

  it("falls back to Figbloom HR mail (and the server's cPanel account) when the company's server is off", async () => {
    await save(who('admin'), { ...settings, enabled: false });
    expect((await send(who('admin'), mail)).status).toBe(200);
    expect(state.resendSends).toHaveLength(1);
    expect((await send(who('admin'), { ...mail, provider: 'cpanel' })).status).toBe(200);
    expect(state.cpanelLogins).toEqual(['hr@example.org']);
    expect(state.sentEmails.map((r) => r.provider)).toEqual(['cpanel', 'resend']);
  });

  it("is only ever the caller's own company's server", async () => {
    state.mailServers.push({
      tenant_id: 'other-tenant', host: 'mail.other.co', port: 465, secure: true, username: 'x@other.co', from_address: 'x@other.co',
      password_encrypted: 'v1:a:b:c', enabled: true,
    });
    expect((await send(who('admin'), mail)).status).toBe(200);
    expect(state.resendSends).toHaveLength(1);
    expect(state.transports.some((t) => t.host === 'mail.other.co')).toBe(false);
    expect((await (await call('GET', '/mail-server', who('admin'))).json()).settings).toBeNull();
  });

  it("reports a failure of the company's server without its reply or the password, and does not send another way", async () => {
    await save(who('admin'), settings);
    state.smtpErrorCode = 'EAUTH';
    const res = await send(who('admin'), mail);
    expect(res.status).toBe(502);
    const text = JSON.stringify(await res.json());
    expect(text).toContain('refused the username or password');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('535');
    expect(state.resendSends).toHaveLength(0);
    expect(state.sentEmails).toHaveLength(0);
  });

  it('tells everyone signed in who the email comes from', async () => {
    expect(await (await call('GET', '/sender', who('staff'))).json()).toEqual({ own_server: false, from_address: null, from_name: '' });
    await save(who('admin'), settings);
    expect(await (await call('GET', '/sender', who('staff'))).json()).toEqual({
      own_server: true, from_address: 'hr@client.co.ke', from_name: 'Client HR',
    });
    expect((await call('GET', '/sender', null)).status).toBe(401);
  });

  it('sends a test email to the caller and records how it went', async () => {
    expect((await call('POST', '/mail-server/test', who('admin'))).status).toBe(400); // nothing saved yet
    await save(who('admin'), { ...settings, enabled: false }); // a test works before it is turned on
    const res = await call('POST', '/mail-server/test', who('admin'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    const me = state.authUsers.find((u) => u.id === who('admin'))!.email;
    expect(state.smtpSends[0]).toMatchObject({ to: me, from: '"Client HR" <hr@client.co.ke>' });
    expect(state.mailServers[0]).toMatchObject({ last_test_ok: true });

    state.smtpErrorCode = 'ECONNECTION';
    const failed = await call('POST', '/mail-server/test', who('admin'));
    expect(failed.status).toBe(200); // the request worked; the answer says the mail server did not
    const body = await failed.json();
    expect(body).toMatchObject({ ok: false });
    expect(body.message).toContain('Could not connect to mail.client.co.ke on port 465');
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(state.mailServers[0]).toMatchObject({ last_test_ok: false });
    expect((await (await call('GET', '/mail-server', who('admin'))).json()).settings.last_test_message).toContain('Could not connect');
  });
});
