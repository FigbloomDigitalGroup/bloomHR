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
    };
    return b;
  };
  const client = {
    // the bearer token is simply the caller's user id in these tests
    auth: { getUser: async (token: string) => ({ data: { user: state.authUsers.find((u) => u.id === token) ?? null }, error: null }) },
    from: (name: string) => {
      if (name === 'user_profiles') return table(() => state.profiles);
      if (name === 'role_permissions') return table(() => state.permissions);
      if (name === 'sent_emails') return table(() => state.sentEmails);
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
    createTransport: (opts: { auth?: { user?: string } }) => ({
      sendMail: async (msg: Record<string, unknown>) => {
        if (state.smtpError) throw state.smtpError;
        state.smtpSends.push(msg);
        if (opts?.auth?.user) state.cpanelLogins.push(String(opts.auth.user));
        return { messageId: 'smtp-1' };
      },
    }),
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
