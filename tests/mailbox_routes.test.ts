// @vitest-environment node
//
// Each person's own mailbox (mailbox_routes.js, FIG-1205): the real router against an in-memory fake of the Supabase
// client, a fake IMAP server (imapflow) and a fake mail parser. Checks who may use it, that every request uses the
// caller's own mailbox only, the shapes the screen relies on, the network limits, the plain-English errors, and that
// nothing about a message or a password is logged.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';

type Row = Record<string, any>;
type FakeMessage = { seq: number; uid: number; flags: Set<string>; envelope: Row; bodyStructure: Row; size: number; source: string; headers?: string };

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, any>[]>,
  authUsers: [] as { id: string; email: string }[],
  dns: {} as Record<string, { address: string; family: number }[]>,
  // the fake IMAP server
  imapOptions: [] as Record<string, any>[],
  connectError: null as Record<string, unknown> | null,
  folders: [] as Record<string, any>[],
  messages: [] as any[],
  opened: [] as { path: string; readOnly: boolean }[],
  fetchRanges: [] as string[],
  fetchQueries: [] as Record<string, unknown>[],
  flagged: [] as { uid: string; flags: string[] }[],
  logouts: 0,
  parsed: {} as Record<string, unknown>,
  downloads: [] as { uid: string; part: string; options: Record<string, unknown> }[],
  // the shared rate limit (take_rate_limit): units used per bucket
  budget: {} as Record<string, number>,
  // the fake outgoing server (nodemailer) and the Sent copies (IMAP APPEND)
  smtpOptions: [] as Record<string, any>[],
  sent: [] as Record<string, any>[],
  smtpError: null as Record<string, unknown> | null,
  verifyError: null as Record<string, unknown> | null,
  smtpRejected: [] as string[],
  appended: [] as { path: string; raw: string; flags: string[] }[],
  appendError: null as Record<string, unknown> | null,
}));

vi.mock('@supabase/supabase-js', () => {
  const rows = (name: string) => (state.tables[name] ||= []);
  const table = (name: string) => {
    const filters: [string, unknown][] = [];
    let op: 'select' | 'update' | 'delete' = 'select';
    let patch: Row = {};
    const hit = (r: Row) => filters.every(([k, v]) => r[k] === v);
    const exec = () => {
      if (op === 'update') rows(name).filter(hit).forEach((r) => Object.assign(r, patch));
      if (op === 'delete') state.tables[name] = rows(name).filter((r) => !hit(r));
      return { data: null, error: null };
    };
    const b: Record<string, any> = {
      select: () => b,
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return b;
      },
      maybeSingle: async () => ({ data: rows(name).filter(hit)[0] ?? null, error: null }),
      update: (p: Row) => {
        op = 'update';
        patch = p;
        return b;
      },
      delete: () => {
        op = 'delete';
        return b;
      },
      upsert: async (row: Row) => {
        const i = rows(name).findIndex((r) => r.user_id === row.user_id && r.tenant_id === row.tenant_id);
        if (i >= 0) rows(name)[i] = { ...row };
        else rows(name).push({ ...row });
        return { error: null };
      },
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(exec()).then(resolve, reject),
    };
    return b;
  };
  const client = {
    rpc: async (fn: string, args: Record<string, any>) => {
      if (fn === 'take_rate_limit') {
        const used = (state.budget[args.p_bucket] || 0) + args.p_cost;
        if (used > args.p_limit) return { data: false, error: null };
        state.budget[args.p_bucket] = used;
        return { data: true, error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    // the bearer token is the caller's user id in these tests
    auth: { getUser: async (token: string) => ({ data: { user: state.authUsers.find((u) => u.id === token) ?? null }, error: null }) },
    from: (name: string) => table(name),
  };
  return { createClient: () => client };
});

vi.mock('node:dns', () => ({
  default: {
    promises: {
      lookup: async (host: string) => {
        const found = state.dns[host];
        if (!found) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
        return found;
      },
    },
  },
}));

vi.mock('imapflow', () => ({
  ImapFlow: class {
    opts: Record<string, any>;
    constructor(opts: Record<string, any>) {
      this.opts = opts;
      state.imapOptions.push(opts);
    }
    on() {
      return this;
    }
    async connect() {
      if (state.connectError) throw Object.assign(new Error(`server said NO for ${this.opts.auth.user} / ${this.opts.auth.pass}`), state.connectError);
    }
    async list() {
      return state.folders;
    }
    async mailboxOpen(path: string, opts: { readOnly?: boolean } = {}) {
      state.opened.push({ path, readOnly: Boolean(opts.readOnly) });
      if (path !== 'INBOX' && !state.folders.some((f) => f.path === path)) throw Object.assign(new Error('NO Mailbox does not exist'), { responseStatus: 'NO' });
      return { path, exists: state.messages.length };
    }
    async *fetch(range: string, query: Record<string, unknown>) {
      state.fetchRanges.push(range);
      state.fetchQueries.push(query);
      const [from, to] = range.split(':').map(Number);
      for (const m of state.messages) if (m.seq >= from && m.seq <= to) yield { ...m, source: undefined };
    }
    async fetchOne(uid: string, query: Record<string, unknown>) {
      state.fetchQueries.push(query);
      const m = state.messages.find((x) => String(x.uid) === uid);
      if (!m) return false;
      if (query.headers) return { uid: m.uid, headers: Buffer.from(m.headers || '') };
      return query.source ? { uid: m.uid, source: Buffer.from(m.source) } : { ...m, source: undefined };
    }
    async messageFlagsAdd(uid: string, flags: string[]) {
      state.flagged.push({ uid, flags });
      return true;
    }
    async download(uid: string, part: string, options: Record<string, unknown>) {
      state.downloads.push({ uid, part, options });
      return { meta: { filename: 'pay"slip/../Oct\r\n.pdf', contentType: 'text/html' }, content: Readable.from([Buffer.from('%PDF-1.4 file')]) };
    }
    async append(path: string, raw: Buffer, flags: string[]) {
      if (state.appendError) throw Object.assign(new Error('NO append failed'), state.appendError);
      state.appended.push({ path, raw: raw.toString(), flags });
      return { destination: path, uid: 1 };
    }
    async logout() {
      state.logouts += 1;
    }
    close() {}
  },
}));

vi.mock('mailparser', () => ({ simpleParser: async () => state.parsed }));

// the outgoing server; the Sent copy is still built by the real MailComposer (nodemailer/lib/mail-composer)
vi.mock('nodemailer', () => ({
  default: {
    createTransport: (opts: Record<string, any>) => {
      state.smtpOptions.push(opts);
      return {
        verify: async () => {
          if (state.verifyError) throw Object.assign(new Error(`535 auth failed for ${opts.auth.user} ${opts.auth.pass}`), state.verifyError);
          return true;
        },
        sendMail: async (mail: Record<string, any>) => {
          if (state.smtpError) throw Object.assign(new Error(`550 refused ${JSON.stringify(mail.to)} ${opts.auth.pass}`), state.smtpError);
          state.sent.push(mail);
          return { messageId: mail.messageId, accepted: [], rejected: state.smtpRejected };
        },
        close() {},
      };
    },
  },
}));

process.env.SUPABASE_URL = 'http://fake';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
const KEY = Buffer.alloc(32, 9).toString('base64');

let server: Server;
let base: string;
const logged: string[] = [];

beforeAll(async () => {
  const express = (await import('express')).default;
  const router = (await import('../mailbox_routes.js')).default;
  const app = express();
  app.use(express.json({ limit: '50mb' })); // as app.js
  app.use('/api/mailbox', router);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mailbox`;
});
afterAll(() => {
  server.close();
});

const PDF_PART = { part: '2', type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'payslip.pdf' }, size: 4000, encoding: 'base64' };
const structure = (withFile: boolean) => ({
  type: 'multipart/mixed',
  childNodes: [
    { part: '1', type: 'text/html', size: 300 },
    ...(withFile ? [PDF_PART] : []),
    // an image shown inside the email: not an attachment
    ...(withFile ? [{ part: '3', type: 'image/png', disposition: 'inline', id: '<logo>', parameters: { name: 'logo.png' }, size: 100 }] : []),
  ],
});
const msg = (seq: number, extra: Partial<FakeMessage> = {}): FakeMessage => ({
  seq,
  uid: 100 + seq,
  flags: new Set<string>(),
  envelope: {
    from: [{ name: `Sender ${seq}`, address: `sender${seq}@client.co.ke` }],
    to: [{ name: 'Mary', address: 'mary@a.co' }],
    subject: `Subject ${seq}`,
    date: new Date(Date.UTC(2026, 9, seq)),
  },
  bodyStructure: structure(seq % 2 === 0),
  size: 2000,
  source: `SECRET-BODY-${seq}`,
  ...extra,
});

beforeEach(() => {
  const users = [
    ['admin', 'ADMIN', TENANT],
    ['hr', 'HR', TENANT],
    ['staff', 'STAFF', TENANT],
    ['b', 'ADMIN', OTHER_TENANT],
  ];
  state.authUsers = users.map(([n]) => ({ id: `${n}-id`, email: `${n}@a.co` }));
  state.tables = {
    user_profiles: users.map(([n, role, tenant]) => ({ user_id: `${n}-id`, role, account_status: 'ACTIVE', tenant_id: tenant, full_name: `${n.toUpperCase()} Person` })),
    role_permissions: [
      { tenant_id: TENANT, role_name: 'HR', permissions: ['email-portal', 'mailbox'] },
      { tenant_id: TENANT, role_name: 'STAFF', permissions: ['email-portal'] },
      { tenant_id: OTHER_TENANT, role_name: 'STAFF', permissions: ['mailbox'] }, // never applies to tenant-a staff
    ],
    user_mailboxes: [],
    company_mail_servers: [],
  };
  state.dns = { 'mail.a.co': [{ address: '203.0.113.10', family: 4 }], 'mail.b.co': [{ address: '203.0.113.20', family: 4 }] };
  state.imapOptions = [];
  state.connectError = null;
  state.folders = [
    { path: 'INBOX', name: 'INBOX', specialUse: '\\Inbox', flags: new Set(), delimiter: '/', status: { messages: 3, unseen: 2 } },
    { path: 'Trash', name: 'Trash', specialUse: '\\Trash', flags: new Set(), delimiter: '/', status: { messages: 1, unseen: 0 } },
    { path: 'Projects', name: 'Projects', flags: new Set(), delimiter: '/', status: { messages: 0, unseen: 0 } },
    { path: 'Sent', name: 'Sent', specialUse: '\\Sent', flags: new Set(), delimiter: '/', status: { messages: 5, unseen: 0 } },
    { path: '[Gmail]', name: '[Gmail]', flags: new Set(['\\Noselect']), delimiter: '/' },
  ];
  state.messages = [msg(1), msg(2), msg(3, { flags: new Set(['\\Seen', '\\Flagged']) })];
  state.opened = [];
  state.fetchRanges = [];
  state.fetchQueries = [];
  state.flagged = [];
  state.logouts = 0;
  state.downloads = [];
  state.budget = {};
  state.smtpOptions = [];
  state.sent = [];
  state.smtpError = null;
  state.verifyError = null;
  state.smtpRejected = [];
  state.appended = [];
  state.appendError = null;
  state.parsed = {
    subject: 'Your payslip',
    from: { value: [{ name: 'Payroll', address: 'payroll@client.co.ke' }] },
    to: { value: [{ name: 'Mary', address: 'mary@a.co' }] },
    cc: { value: [{ name: '', address: 'boss@a.co' }] },
    date: new Date('2026-10-20T08:00:00Z'),
    messageId: '<m1@client>',
    html: '<p>SECRET-BODY html</p><img src="data:image/png;base64,AAAA">',
    text: 'SECRET-BODY text',
  };
  process.env.MAIL_SERVER_ENCRYPTION_KEY = KEY;
  logged.length = 0;
  for (const level of ['error', 'log', 'warn', 'info', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  }
});

const call = (method: string, path: string, token: string | null, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const connect = (token: string, extra: Row = {}) =>
  call('PUT', '/account', token, { email: `${token.replace('-id', '')}@a.co`, imap_host: 'mail.a.co', password: 'hunter2', ...extra });

describe('who may use it', () => {
  it('needs a real session', async () => {
    expect((await call('GET', '/account', null)).status).toBe(401);
    expect((await call('GET', '/folders', 'nobody')).status).toBe(401);
    expect((await call('PUT', '/account', null, { email: 'x@a.co' })).status).toBe(401);
    expect(state.imapOptions).toHaveLength(0);
  });

  it('needs the My mailbox module (administrators always have it), ignoring another company\'s grant', async () => {
    expect((await call('GET', '/account', 'staff-id')).status).toBe(403);
    expect((await connect('staff-id')).status).toBe(403);
    expect((await call('GET', '/account', 'hr-id')).status).toBe(200);
    expect((await call('GET', '/account', 'admin-id')).status).toBe(200);
    expect(state.imapOptions).toHaveLength(0);
  });

  it('says to connect first when there is no mailbox', async () => {
    const res = await call('GET', '/folders', 'hr-id');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Connect your mailbox first');
  });
});

describe('connecting', () => {
  it('suggests the company mail server (cPanel-style) or mail.<domain>, and the login email', async () => {
    let body = await (await call('GET', '/account', 'hr-id')).json();
    expect(body).toEqual({
      account: null,
      defaults: { email: 'hr@a.co', imap_host: 'mail.a.co', imap_port: 993, smtp_host: 'mail.a.co', smtp_port: 465, from_company_server: false },
    });
    state.tables.company_mail_servers.push({ tenant_id: TENANT, host: 'server12.hostafrica.co.ke', port: 587, username: 'hr@a.co', from_address: 'hr@a.co' });
    body = await (await call('GET', '/account', 'hr-id')).json();
    expect(body.defaults).toMatchObject({ imap_host: 'server12.hostafrica.co.ke', smtp_host: 'server12.hostafrica.co.ke', smtp_port: 587, from_company_server: true });
    // a sending-only service is no guess for reading
    state.tables.company_mail_servers[0].host = 'smtp.sendgrid.net';
    body = await (await call('GET', '/account', 'hr-id')).json();
    expect(body.defaults).toMatchObject({ imap_host: 'mail.a.co', from_company_server: false });
  });

  it('logs in before saving, over TLS to the checked address, then stores the password encrypted and never returns it', async () => {
    const res = await connect('hr-id');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account).toMatchObject({ email: 'hr@a.co', imap_host: 'mail.a.co', imap_port: 993, secure: true, username: 'hr@a.co', smtp_host: 'mail.a.co', smtp_port: 465, password_set: true });
    expect(JSON.stringify(body)).not.toMatch(/hunter2|password_encrypted|v1:/);
    expect(state.imapOptions[0]).toMatchObject({
      host: '203.0.113.10',
      servername: 'mail.a.co',
      port: 993,
      secure: true,
      auth: { user: 'hr@a.co', pass: 'hunter2' },
      logger: false,
      connectionTimeout: 10_000,
    });
    expect(state.logouts).toBe(1);
    const [row] = state.tables.user_mailboxes;
    expect(row).toMatchObject({ user_id: 'hr-id', tenant_id: TENANT, last_error: null });
    expect(row.password_encrypted).toMatch(/^v1:/);
    expect(row.password_encrypted).not.toContain('hunter2');
    expect(JSON.stringify(await (await call('GET', '/account', 'hr-id')).json())).not.toMatch(/hunter2|v1:/);
  });

  it('uses STARTTLS (required) on port 143', async () => {
    expect((await connect('hr-id', { imap_port: 143 })).status).toBe(200);
    expect(state.imapOptions[0]).toMatchObject({ port: 143, secure: false, doSTARTTLS: true });
    expect(state.tables.user_mailboxes[0]).toMatchObject({ imap_port: 143, secure: false });
  });

  it('wrong password: a plain answer on Test, and nothing saved', async () => {
    state.connectError = { authenticationFailed: true };
    const test = await call('POST', '/test', 'hr-id', { email: 'hr@a.co', imap_host: 'mail.a.co', password: 'nope' });
    expect(test.status).toBe(200);
    expect(await test.json()).toEqual({ ok: false, message: 'Wrong email or password. Check them (the username is usually your full email address).' });
    const save = await connect('hr-id', { password: 'nope' });
    expect(save.status).toBe(400);
    expect((await save.json()).error).toMatch(/^Wrong email or password/);
    expect(state.tables.user_mailboxes).toHaveLength(0);
  });

  it('a server it cannot reach, or cannot find, is named in the answer', async () => {
    state.connectError = { code: 'ECONNREFUSED' };
    let body = await (await call('POST', '/test', 'hr-id', { email: 'hr@a.co', imap_host: 'mail.a.co', password: 'x' })).json();
    expect(body).toEqual({ ok: false, message: "Can't reach mail.a.co on port 993. Check the server name and port." });
    state.connectError = null;
    body = await (await call('POST', '/test', 'hr-id', { email: 'hr@a.co', imap_host: 'mail.nowhere.co', password: 'x' })).json();
    expect(body).toEqual({ ok: false, message: "Can't find a mail server called mail.nowhere.co. Check the name." });
    body = await (await call('POST', '/test', 'hr-id', { email: 'hr@a.co', imap_host: 'mail.a.co', password: 'x' })).json();
    expect(body).toEqual({ ok: true, message: 'Connected to mail.a.co. Your mailbox is ready.' });
  });

  it('refuses private and loopback hosts (by address or by what the name resolves to) and other ports', async () => {
    state.dns['mail.internal.co'] = [{ address: '10.1.2.3', family: 4 }];
    state.dns['sneaky.co'] = [{ address: '203.0.113.5', family: 4 }, { address: '::1', family: 6 }];
    state.dns['v6.co'] = [{ address: 'fd00::1', family: 6 }];
    for (const imap_host of ['127.0.0.1', '192.168.1.10', '169.254.169.254', 'localhost', '[::1]', '::1']) {
      const res = await connect('hr-id', { imap_host });
      expect([imap_host, res.status]).toEqual([imap_host, 400]);
    }
    for (const imap_host of ['mail.internal.co', 'sneaky.co', 'v6.co']) {
      const res = await connect('hr-id', { imap_host });
      expect([imap_host, res.status, (await res.json()).error]).toEqual([imap_host, 400, `${imap_host} is not a public mail server`]);
    }
    for (const imap_port of [25, 110, 995, 22, 8080]) {
      const res = await connect('hr-id', { imap_port });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/993 \(SSL\/TLS\) or 143/);
    }
    expect((await connect('hr-id', { smtp_port: 3306 })).status).toBe(400);
    expect(state.imapOptions).toHaveLength(0);
    expect(state.tables.user_mailboxes).toHaveLength(0);
  });

  it('disconnecting deletes the row, password and all, for the caller only', async () => {
    await connect('hr-id');
    await connect('admin-id');
    expect((await call('DELETE', '/account', 'hr-id')).status).toBe(200);
    expect(state.tables.user_mailboxes.map((r) => r.user_id)).toEqual(['admin-id']);
  });
});

describe('only your own mailbox', () => {
  it('logs in as the caller, whatever the request says', async () => {
    await connect('hr-id', { password: 'hr-pass' });
    await connect('admin-id', { password: 'admin-pass' });
    state.imapOptions = [];
    expect((await call('GET', '/folders?user_id=admin-id', 'hr-id')).status).toBe(200);
    expect(state.imapOptions.map((o) => o.auth)).toEqual([{ user: 'hr@a.co', pass: 'hr-pass' }]);
  });

  it("a password copied from another person's row does not open", async () => {
    await connect('hr-id');
    await connect('admin-id', { password: 'admin-pass' });
    const admins = state.tables.user_mailboxes.find((r) => r.user_id === 'admin-id')!;
    state.tables.user_mailboxes.find((r) => r.user_id === 'hr-id')!.password_encrypted = admins.password_encrypted;
    state.imapOptions = [];
    const res = await call('GET', '/folders', 'hr-id');
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/can't be read/);
    expect(state.imapOptions).toHaveLength(0);
  });

  it("another company's person with the same row shape sees only their own", async () => {
    await connect('hr-id');
    state.tables.user_profiles.find((p) => p.user_id === 'b-id')!.tenant_id = OTHER_TENANT;
    const res = await call('GET', '/folders', 'b-id');
    expect(res.status).toBe(404);
  });
});

describe('reading', () => {
  beforeEach(async () => {
    await connect('hr-id');
    state.imapOptions = [];
    state.logouts = 0;
  });

  it('lists the folders with their special use and unread counts, Inbox first, skipping ones that hold no mail', async () => {
    const res = await call('GET', '/folders', 'hr-id');
    expect(await res.json()).toEqual({
      folders: [
        { path: 'INBOX', name: 'Inbox', special: 'inbox', unread: 2, total: 3, delimiter: '/' },
        { path: 'Sent', name: 'Sent', special: 'sent', unread: 0, total: 5, delimiter: '/' },
        { path: 'Trash', name: 'Trash', special: 'trash', unread: 0, total: 1, delimiter: '/' },
        { path: 'Projects', name: 'Projects', special: null, unread: 0, total: 0, delimiter: '/' },
      ],
    });
    expect(state.logouts).toBe(1);
  });

  it('lists messages newest first from the envelope and structure only, read-only', async () => {
    const body = await (await call('GET', '/messages?folder=INBOX', 'hr-id')).json();
    expect(body).toMatchObject({ folder: 'INBOX', page: 1, page_size: 50, total: 3, has_more: false });
    expect(body.messages.map((m: Row) => m.uid)).toEqual([103, 102, 101]);
    expect(body.messages[0]).toEqual({
      uid: 103,
      from: { name: 'Sender 3', address: 'sender3@client.co.ke' },
      to: [{ name: 'Mary', address: 'mary@a.co' }],
      subject: 'Subject 3',
      date: '2026-10-03T00:00:00.000Z',
      seen: true,
      flagged: true,
      answered: false,
      has_attachments: false,
      size: 2000,
    });
    expect(body.messages[1]).toMatchObject({ uid: 102, seen: false, has_attachments: true });
    expect(state.opened).toEqual([{ path: 'INBOX', readOnly: true }]);
    expect(state.fetchQueries.some((q) => q.source)).toBe(false);
    expect(state.fetchRanges).toEqual(['1:3']);
  });

  it('pages by 50 from the newest', async () => {
    state.messages = Array.from({ length: 120 }, (_, i) => msg(i + 1));
    expect((await (await call('GET', '/messages?page=1', 'hr-id')).json()).has_more).toBe(true);
    const page3 = await (await call('GET', '/messages?page=3', 'hr-id')).json();
    expect(state.fetchRanges).toEqual(['71:120', '1:20']);
    expect(page3.messages).toHaveLength(20);
    expect(page3.has_more).toBe(false);
    expect((await call('GET', '/messages?page=-1', 'hr-id')).status).toBe(400);
  });

  it('a folder that is not there is a 404, not a crash', async () => {
    const res = await call('GET', '/messages?folder=Gone', 'hr-id');
    expect(res.status).toBe(404);
    expect(state.logouts).toBe(1);
  });

  it('opens one email: headers, text, html and attachments (not the images inside it), and marks it read', async () => {
    const res = await call('GET', '/message?folder=INBOX&uid=102', 'hr-id');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { message } = await res.json();
    expect(message).toEqual({
      uid: 102,
      folder: 'INBOX',
      subject: 'Your payslip',
      from: [{ name: 'Payroll', address: 'payroll@client.co.ke' }],
      to: [{ name: 'Mary', address: 'mary@a.co' }],
      cc: [{ name: '', address: 'boss@a.co' }],
      reply_to: [],
      date: '2026-10-20T08:00:00.000Z',
      message_id: '<m1@client>',
      seen: true,
      flagged: false,
      html: '<p>SECRET-BODY html</p><img src="data:image/png;base64,AAAA">',
      text: 'SECRET-BODY text',
      attachments: [{ part: '2', filename: 'payslip.pdf', size: 3000, contentType: 'application/pdf' }],
    });
    expect(state.flagged).toEqual([{ uid: '102', flags: ['\\Seen'] }]);
    expect(state.opened).toEqual([{ path: 'INBOX', readOnly: false }]);
    // an already-read email is not flagged again
    await call('GET', '/message?uid=103', 'hr-id');
    expect(state.flagged).toHaveLength(1);
  });

  it('does not open an email over 25 MB, or a bad id', async () => {
    state.messages[0].size = 26 * 1024 * 1024;
    const res = await call('GET', '/message?uid=101', 'hr-id');
    expect(res.status).toBe(413);
    expect(state.fetchQueries.some((q) => q.source)).toBe(false);
    expect((await call('GET', '/message?uid=abc', 'hr-id')).status).toBe(400);
    expect((await call('GET', '/message?uid=999', 'hr-id')).status).toBe(404);
  });

  it('streams an attachment as a download with a safe file name', async () => {
    const res = await call('GET', '/attachment?folder=INBOX&uid=102&part=2', 'hr-id');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const disposition = res.headers.get('content-disposition')!;
    expect(disposition).toMatch(/^attachment; filename="pay_slip_\.\._Oct_\.pdf"; filename\*=UTF-8''/);
    expect(disposition).not.toMatch(/[\r\n/]/);
    expect(await res.text()).toBe('%PDF-1.4 file');
    expect(state.downloads).toEqual([{ uid: '102', part: '2', options: { uid: true, maxBytes: 25 * 1024 * 1024 } }]);
    expect(state.logouts).toBe(1);
  });

  it('refuses a part that is not in the email, or not a part number', async () => {
    expect((await call('GET', '/attachment?uid=102&part=9', 'hr-id')).status).toBe(404);
    expect((await call('GET', '/attachment?uid=102&part=../1', 'hr-id')).status).toBe(400);
    expect(state.downloads).toHaveLength(0);
  });

  it('records a failed login on the row (no password, no server reply) and says so', async () => {
    state.connectError = { authenticationFailed: true };
    const res = await call('GET', '/folders', 'hr-id');
    expect(res.status).toBe(400);
    expect(state.tables.user_mailboxes[0].last_error).toMatch(/^Wrong email or password/);
  });
});

describe('logging', () => {
  it('never logs message contents, addresses, subjects or passwords', async () => {
    await connect('hr-id');
    await call('GET', '/messages', 'hr-id');
    await call('GET', '/message?uid=102', 'hr-id');
    await call('GET', '/attachment?uid=102&part=2', 'hr-id');
    state.connectError = { authenticationFailed: true };
    await call('GET', '/folders', 'hr-id');
    await connect('hr-id', { password: 'other-secret' });
    state.connectError = { code: 'ETIMEDOUT' };
    await call('GET', '/message?uid=102', 'hr-id');
    state.connectError = null;
    delete process.env.MAIL_SERVER_ENCRYPTION_KEY;
    await call('GET', '/folders', 'hr-id');
    const all = logged.join('\n');
    for (const secret of ['SECRET-BODY', 'hunter2', 'other-secret', 'hr@a.co', 'mary@a.co', 'payroll@client.co.ke', 'Subject', 'payslip', 'Your payslip']) {
      expect([secret, all.includes(secret)]).toEqual([secret, false]);
    }
    expect(state.imapOptions.every((o) => o.logger === false)).toBe(true);
  });
});

describe('encryption', () => {
  it('round-trips with the person and company bound in; anyone else\'s binding fails', async () => {
    const { encryptSecret, decryptSecret, decryptPassword } = await import('../company_mail_server.js');
    const { mailboxBinding } = await import('../mailbox_routes.js');
    const stored = encryptSecret('hunter2', mailboxBinding('u1', 't1'));
    expect(decryptSecret(stored, mailboxBinding('u1', 't1'), 'no')).toBe('hunter2');
    expect(() => decryptSecret(stored, mailboxBinding('u2', 't1'), 'no')).toThrow('no');
    expect(() => decryptSecret(stored, mailboxBinding('u1', 't2'), 'no')).toThrow('no');
    // nor as a company's mail server password
    expect(() => decryptPassword(stored, 't1')).toThrow(/can't be read/);
    // two encryptions of the same password differ
    expect(encryptSecret('hunter2', mailboxBinding('u1', 't1'))).not.toBe(stored);
  });
});

describe('checking sending when connecting', () => {
  it('Test also logs in to the outgoing server (same login, checked address, name kept for TLS)', async () => {
    let body = await (await call('POST', '/test', 'hr-id', { email: 'hr@a.co', imap_host: 'mail.a.co', password: 'hunter2', smtp_port: 587 })).json();
    expect(body).toEqual({ ok: true, message: 'Connected to mail.a.co. Your mailbox is ready.' });
    expect(state.smtpOptions[0]).toMatchObject({
      host: '203.0.113.10',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'hr@a.co', pass: 'hunter2' },
      tls: { servername: 'mail.a.co' },
      logger: false,
    });
    state.verifyError = { code: 'EAUTH', responseCode: 535 };
    body = await (await call('POST', '/test', 'hr-id', { email: 'hr@a.co', imap_host: 'mail.a.co', password: 'hunter2' })).json();
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/^Reading works, but sending doesn't: Your mail server refused your password for sending/);
  });

  it('connecting saves when reading works and says whether sending does', async () => {
    state.verifyError = { code: 'ECONNECTION' };
    const res = await connect('hr-id');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account.email).toBe('hr@a.co');
    expect(body.smtp).toEqual({ ok: false, message: "Can't reach mail.a.co on port 465 to send. Check the outgoing server and port under Change server settings." });
    expect(state.tables.user_mailboxes).toHaveLength(1);
  });

  it('changing only the outgoing server keeps the saved password', async () => {
    await connect('hr-id');
    const res = await call('PUT', '/account', 'hr-id', { email: 'hr@a.co', imap_host: 'mail.a.co', smtp_host: 'mail.a.co', smtp_port: 587 });
    expect(res.status).toBe(200);
    expect(state.tables.user_mailboxes[0].smtp_port).toBe(587);
    expect(state.smtpOptions.at(-1)!.auth).toEqual({ user: 'hr@a.co', pass: 'hunter2' });
  });
});

describe('sending', () => {
  const send = (body: Row, token = 'hr-id') => call('POST', '/send', token, body);
  const raw = () => state.appended[0]?.raw || '';

  beforeEach(async () => {
    await connect('hr-id');
    state.imapOptions = [];
    state.smtpOptions = [];
    state.logouts = 0;
    state.messages[1].headers = 'Message-ID: <m1@client>\r\nReferences: <r0@client>\r\n <r1@client>\r\nSubject: SECRET subject\r\n';
  });

  it('needs a session, the module and a connected mailbox', async () => {
    expect((await send({ to: ['x@b.co'] }, 'nobody')).status).toBe(401);
    expect((await send({ to: ['x@b.co'] }, 'staff-id')).status).toBe(403);
    const res = await send({ to: ['x@b.co'] }, 'admin-id');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Connect your mailbox first');
    expect(state.sent).toHaveLength(0);
  });

  it('sends from your own mailbox only: your address, your name, your login, whatever the request says', async () => {
    await connect('admin-id', { password: 'admin-pass' });
    state.imapOptions = [];
    state.smtpOptions = [];
    state.logouts = 0;
    const res = await send({ to: [{ name: 'Joe', address: 'joe@client.co.ke' }], subject: 'Hello', text: 'SECRET-BODY hi', from: 'admin@a.co', user_id: 'admin-id', headers: { Bcc: 'x@evil.co' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, saved_to_sent: true, sent_folder: 'Sent', rejected: [], message: 'Sent.' });
    expect(state.smtpOptions).toHaveLength(1);
    expect(state.smtpOptions[0]).toMatchObject({ host: '203.0.113.10', port: 465, secure: true, auth: { user: 'hr@a.co', pass: 'hunter2' }, tls: { servername: 'mail.a.co' } });
    expect(state.imapOptions.map((o) => o.auth)).toEqual([{ user: 'hr@a.co', pass: 'hunter2' }]);
    const [mail] = state.sent;
    expect(mail.from).toEqual({ name: 'HR Person', address: 'hr@a.co' });
    expect(mail.to).toEqual([{ name: 'Joe', address: 'joe@client.co.ke' }]);
    expect(mail.headers).toBeUndefined();
    expect(mail).toMatchObject({ subject: 'Hello', text: 'SECRET-BODY hi', disableFileAccess: true, disableUrlAccess: true });
    expect(mail.messageId).toMatch(/^<[0-9a-f-]{36}@a\.co>$/);
    expect(raw()).toMatch(/^From: HR Person <hr@a\.co>$/m);
    expect(raw()).not.toMatch(/admin|evil/);
    expect(state.logouts).toBe(1);
  });

  it('checks the recipients: valid addresses, at least one, at most 50 in all', async () => {
    let res = await send({ to: ['joe@client.co.ke', 'not-an-address'] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('"not-an-address" in To is not a valid email address');
    res = await send({ to: ['joe@client.co.ke'], bcc: ['a@b.co\r\nBcc: x@evil.co'] });
    expect(res.status).toBe(400);
    res = await send({ subject: 'nobody' });
    expect((await res.json()).error).toBe('Add at least one recipient');
    const many = Array.from({ length: 30 }, (_, i) => `p${i}@client.co.ke`);
    res = await send({ to: many, cc: many.slice(0, 21) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Send to at most 50 people at once');
    expect((await send({ to: many, cc: many.slice(0, 20) })).status).toBe(200);
    expect(state.sent).toHaveLength(1);
    expect(state.imapOptions).toHaveLength(1);
  });

  it('a reply is threaded from the original (In-Reply-To, References) and marks it answered', async () => {
    const res = await send({ to: ['payroll@client.co.ke'], subject: 'Re: Your payslip', text: 'Thanks', reply: { folder: 'INBOX', uid: 102 } });
    expect(res.status).toBe(200);
    const [mail] = state.sent;
    expect(mail.inReplyTo).toBe('<m1@client>');
    expect(mail.references).toEqual(['<r0@client>', '<r1@client>', '<m1@client>']);
    expect(raw()).toMatch(/^In-Reply-To: <m1@client>$/m);
    expect(raw()).toMatch(/^References: <r0@client> <r1@client> <m1@client>$/m);
    expect(state.opened).toEqual([{ path: 'INBOX', readOnly: false }]);
    expect(state.flagged).toEqual([{ uid: '102', flags: ['\\Answered'] }]);
    // an original that is gone: nothing is sent
    expect((await send({ to: ['payroll@client.co.ke'], reply: { folder: 'INBOX', uid: 999 } })).status).toBe(404);
    expect((await send({ to: ['payroll@client.co.ke'], reply: { folder: 'INBOX', uid: 'abc' } })).status).toBe(400);
    expect(state.sent).toHaveLength(1);
  });

  it('a forward takes the attachments from the original on the server, read-only', async () => {
    const res = await send({ to: ['joe@client.co.ke'], subject: 'Fwd: Your payslip', text: '---------- Forwarded message ---------', forward: { folder: 'INBOX', uid: 102, parts: ['2'] } });
    expect(res.status).toBe(200);
    expect(state.opened).toEqual([{ path: 'INBOX', readOnly: true }]);
    expect(state.downloads).toEqual([{ uid: '102', part: '2', options: { uid: true, maxBytes: 20 * 1024 * 1024 + 1 } }]);
    const [mail] = state.sent;
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0].filename).toBe('pay"slip_.._Oct.pdf');
    expect(mail.attachments[0].contentType).toBe('application/pdf');
    expect(mail.attachments[0].content.toString()).toBe('%PDF-1.4 file');
    expect(state.flagged).toHaveLength(0);
    // a part that is not in the email
    expect((await send({ to: ['joe@client.co.ke'], forward: { folder: 'INBOX', uid: 102, parts: ['9'] } })).status).toBe(404);
    expect((await send({ to: ['joe@client.co.ke'], forward: { folder: 'INBOX', uid: 102, parts: ['../1'] } })).status).toBe(400);
    expect(state.sent).toHaveLength(1);
  });

  it('attaches uploaded files (base64), with safe names', async () => {
    const res = await send({
      to: ['joe@client.co.ke'],
      attachments: [{ filename: '../../etc/passwd\r\n.txt', content_type: 'text/plain', data: Buffer.from('hello file').toString('base64') }],
    });
    expect(res.status).toBe(200);
    const [file] = state.sent[0].attachments;
    expect(file).toMatchObject({ filename: '_.._etc_passwd.txt', contentType: 'text/plain' });
    expect(file.content.toString()).toBe('hello file');
    expect((await send({ to: ['joe@client.co.ke'], attachments: [{ filename: 'x', data: 'not base64!' }] })).status).toBe(400);
  });

  it('caps the size: 3 MB of uploads, 20 MB in all with forwarded files, 256 KB of text', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64');
    let res = await send({ to: ['joe@client.co.ke'], attachments: [{ filename: 'big.bin', data: big }] });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/up to 3 MB/);
    state.messages[1].bodyStructure = { type: 'multipart/mixed', childNodes: [{ part: '1', type: 'text/html', size: 300 }, { ...PDF_PART, size: 28 * 1024 * 1024 }] };
    res = await send({ to: ['joe@client.co.ke'], forward: { folder: 'INBOX', uid: 102, parts: ['2'] } });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/over 20 MB/);
    expect(state.downloads).toHaveLength(0);
    expect((await send({ to: ['joe@client.co.ke'], text: 'x'.repeat(256 * 1024 + 1) })).status).toBe(413);
    expect(state.sent).toHaveLength(0);
  });

  it('saves the copy (Bcc kept, marked read) to the folder marked \\Sent, else INBOX.Sent', async () => {
    state.folders = state.folders.map((f) => (f.path === 'Sent' ? { ...f, path: 'Sent Items', name: 'Sent Items' } : f));
    await send({ to: ['joe@client.co.ke'], bcc: ['boss@a.co'], subject: 'Hi' });
    expect(state.appended[0]).toMatchObject({ path: 'Sent Items', flags: ['\\Seen'] });
    expect(raw()).toMatch(/^Bcc: boss@a\.co$/m);
    // the copy is the same email: the same Message-ID
    expect(raw()).toContain(`Message-ID: ${state.sent[0].messageId}`);

    // no special use (older cPanel): INBOX.Sent
    state.appended = [];
    state.folders = [
      { path: 'INBOX', name: 'INBOX', flags: new Set(), delimiter: '.' },
      { path: 'INBOX.Drafts', name: 'Drafts', flags: new Set(), delimiter: '.' },
      { path: 'INBOX.Sent', name: 'Sent', flags: new Set(), delimiter: '.' },
    ];
    const body = await (await send({ to: ['joe@client.co.ke'] })).json();
    expect(body.sent_folder).toBe('INBOX.Sent');
    expect(state.appended[0].path).toBe('INBOX.Sent');
  });

  it('sent but not saved: no Sent folder, or the save failed, says so (and is not an error)', async () => {
    state.folders = state.folders.filter((f) => f.path !== 'Sent');
    let res = await send({ to: ['joe@client.co.ke'] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, saved_to_sent: false, sent_folder: null, message: "Sent, but couldn't save a copy to Sent." });
    state.folders.push({ path: 'Sent', name: 'Sent', specialUse: '\\Sent', flags: new Set(), delimiter: '/' });
    state.appendError = { responseStatus: 'NO', code: 'OVERQUOTA' };
    res = await send({ to: ['joe@client.co.ke'] });
    expect(res.status).toBe(200);
    expect((await res.json()).message).toBe("Sent, but couldn't save a copy to Sent.");
    expect(state.sent).toHaveLength(2);
  });

  it('plain errors from the outgoing server, and nothing saved to Sent when it was not sent', async () => {
    state.smtpError = { code: 'EAUTH', responseCode: 535 };
    let res = await send({ to: ['joe@client.co.ke'] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^Your mail server refused your password for sending/);
    state.smtpError = { code: 'EENVELOPE', responseCode: 550, rejected: ['joe@client.co.ke'] };
    res = await send({ to: ['joe@client.co.ke'] });
    expect((await res.json()).error).toBe('Your mail server refused to send to joe@client.co.ke. Check the address.');
    state.smtpError = { code: 'EMESSAGE', responseCode: 552 };
    res = await send({ to: ['joe@client.co.ke'] });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/too large for your mail server/);
    expect(state.appended).toHaveLength(0);
    // some refused, the rest sent
    state.smtpError = null;
    state.smtpRejected = ['gone@client.co.ke'];
    const body = await (await send({ to: ['joe@client.co.ke', 'gone@client.co.ke'] })).json();
    expect(body).toMatchObject({ ok: true, rejected: ['gone@client.co.ke'], message: 'Sent. Your mail server refused gone@client.co.ke.' });
  });

  it('refuses an outgoing server on a private network or a port outside the list, before connecting', async () => {
    state.dns['mail.internal.co'] = [{ address: '10.1.2.3', family: 4 }];
    state.tables.user_mailboxes[0].smtp_host = 'mail.internal.co';
    let res = await send({ to: ['joe@client.co.ke'] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('mail.internal.co is not a public mail server');
    state.tables.user_mailboxes[0].smtp_host = '127.0.0.1';
    expect((await send({ to: ['joe@client.co.ke'] })).status).toBe(400);
    state.tables.user_mailboxes[0].smtp_host = 'mail.a.co';
    state.tables.user_mailboxes[0].smtp_port = 8080;
    res = await send({ to: ['joe@client.co.ke'] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/outgoing mail port must be one of 25, 465, 587, 2525/);
    expect(state.imapOptions).toHaveLength(0);
    expect(state.smtpOptions).toHaveLength(0);
  });

  it('30 sends an hour per person', async () => {
    expect((await send({ to: ['joe@client.co.ke'] })).status).toBe(200);
    expect(state.budget['mailbox-send:default:hr-id']).toBe(1);
    state.budget['mailbox-send:default:hr-id'] = 30;
    const res = await send({ to: ['joe@client.co.ke'] });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/30 emails from here in the last hour/);
    expect(state.sent).toHaveLength(1);
  });

  it('never logs contents, addresses, subjects or passwords while sending', async () => {
    await send({ to: ['joe@client.co.ke'], bcc: ['boss@a.co'], subject: 'SECRET subject', text: 'SECRET-BODY', reply: { folder: 'INBOX', uid: 102 } });
    state.appendError = { code: 'NOSPACE' };
    await send({ to: ['joe@client.co.ke'], subject: 'SECRET subject', text: 'SECRET-BODY' });
    state.smtpError = { code: 'EENVELOPE', rejected: ['joe@client.co.ke'] };
    await send({ to: ['joe@client.co.ke'], subject: 'SECRET subject', text: 'SECRET-BODY' });
    state.smtpError = { code: 'EAUTH' };
    await send({ to: ['joe@client.co.ke'], subject: 'SECRET subject', text: 'SECRET-BODY', forward: { folder: 'INBOX', uid: 102, parts: ['2'] } });
    state.verifyError = { code: 'EAUTH' };
    await call('POST', '/test', 'hr-id', { email: 'hr@a.co', imap_host: 'mail.a.co', password: 'hunter2' });
    const all = logged.join('\n');
    expect(all).toContain('[mailbox] send failed: EAUTH');
    for (const secret of ['SECRET', 'hunter2', 'hr@a.co', 'joe@client.co.ke', 'boss@a.co', 'payslip', 'HR Person']) {
      expect([secret, all.includes(secret)]).toEqual([secret, false]);
    }
    expect(state.smtpOptions.every((o) => o.logger === false && o.debug === false)).toBe(true);
  });
});
