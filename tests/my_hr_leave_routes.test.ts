// @vitest-environment node
//
// Leave through "My HR" (my_hr_routes.js, ERP/SCHOOLS_HR_LEAVE_CONTRACT.md section 2): the form, applying (bodies
// checked, documents stored and removed again if HR refuses, each HR refusal surfaced with its words), cancelling,
// approvers found only through external_logins (not linked: 409), deciding as that login only, document links, the
// history import (no person; dry run), and that no token, document or reason reaches a log. The token is checked for
// real; the database is a fake store (the functions run on a real schema in supabase/tests/my_hr_leave.test.ts).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose';

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';

const ISSUER = 'https://cognito-idp.af-south-1.amazonaws.com/af-south-1_TESTPOOL';
const SCHOOLS_CLIENT = 'schools-client-id';
const PT = '7a1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c10';
const PT_OTHER = '8b2c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c11';
const HR_CO = '1b1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c20';
const HR_OTHER = '2b1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c21';
const SCHOOL = '3c1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c30';
const SCHOOL_OTHER = '4c1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c31';
const MARY = 'a0000000-0000-4000-8000-000000000001'; // employee E1
const NEW = 'a0000000-0000-4000-8000-000000000002'; // draft employee E3
const PRINCIPAL = 'a0000000-0000-4000-8000-000000000005'; // linked HR login
const HEAD_NOT_LINKED = 'a0000000-0000-4000-8000-000000000006';
const SUSPENDED = 'a0000000-0000-4000-8000-000000000007';
const OTHER_HEAD = 'a0000000-0000-4000-8000-000000000008'; // linked in the other company only
const LOGIN_PRINCIPAL = 'c0000000-0000-4000-8000-0000000000a1';
const LOGIN_OTHER = 'c0000000-0000-4000-8000-0000000000a2';
const TYPE = 'd0000000-0000-4000-8000-000000000001';
const APP = 'e0000000-0000-4000-8000-000000000001';
const SOMEONE_ELSES = 'e0000000-0000-4000-8000-000000000002';
const SECRET_REASON = 'My very private medical reason';

type Row = Record<string, unknown>;
let mod: typeof import('../my_hr_routes.js');
let PlatformError: new (status: number, code: string, message: string) => Error;
let sign: (claims: Row, opts?: { key?: 'platform' | 'attacker' }) => Promise<string>;
let keys: ReturnType<typeof createLocalJWKSet>;

const dbError = (code: string, message: string) => Object.assign(new Error(`fn: ${message}`), { code, hrMessage: message });

const calls: Row[] = [];
const logRows: Row[] = [];
const documents = new Map<string, { bytes: Buffer; contentType: string }>();
let applyFails: Error | null = null;
const store = {
  person: async ({ tenantId, platformTenantId, externalId }: Row) => {
    if ((tenantId === HR_CO ? PT : PT_OTHER) !== platformTenantId) return { outcome: 'unknown_company' };
    if (tenantId === HR_CO && externalId === MARY) return { outcome: 'found', employee_number: 'E1', onboarding_status: 'approved' };
    if (tenantId === HR_CO && externalId === NEW) return { outcome: 'found', employee_number: 'E3', onboarding_status: 'draft' };
    return { outcome: 'not_linked' };
  },
  approver: async ({ tenantId, externalId }: Row) => {
    calls.push({ fn: 'approver', tenantId, externalId });
    if (tenantId === HR_CO && externalId === PRINCIPAL) return { outcome: 'found', user_id: LOGIN_PRINCIPAL };
    if (tenantId === HR_CO && externalId === SUSPENDED) return { outcome: 'no_access', user_id: LOGIN_OTHER };
    if (tenantId === HR_OTHER && externalId === OTHER_HEAD) return { outcome: 'found', user_id: LOGIN_OTHER };
    return { outcome: 'not_linked', user_id: null };
  },
  leaveForm: async ({ tenantId, employee }: Row) => {
    calls.push({ fn: 'leaveForm', tenantId, employee });
    return { leave_types: [{ id: TYPE, name: 'Annual Leave', half_days: true }], balances: [], approval_chain: [{ position: 1, label: 'Leave approver' }] };
  },
  leaveApply: async (args: Row) => {
    calls.push({ fn: 'leaveApply', ...args });
    if (applyFails) throw applyFails;
    return { id: APP, status: 'pending', leave_type: 'Annual Leave', days: 2, reason: args.reason, document_name: args.documentName };
  },
  leaveCancel: async ({ tenantId, employee, id }: Row) => {
    calls.push({ fn: 'leaveCancel', tenantId, employee, id });
    if (id === SOMEONE_ELSES) throw dbError('P0002', 'No such leave application');
    if (id === APP) return { id: APP, status: 'cancelled' };
    throw dbError('55000', 'This leave has already started, so it can no longer be cancelled');
  },
  approvals: async ({ tenantId, userId }: Row) => {
    calls.push({ fn: 'approvals', tenantId, userId });
    if (userId !== LOGIN_PRINCIPAL) return [];
    return [{
      application_id: APP, employee: { employee_number: 'E1', name: 'Mary Teacher' }, leave_type: 'Sick Leave', days: 2,
      document: { name: 'report.pdf', path: `${HR_CO}/my-hr/f0000000-0000-4000-8000-000000000001.pdf` }, followup_document: null,
      approval: { steps: [] },
    }];
  },
  decide: async ({ tenantId, userId, id, decision, comment }: Row) => {
    calls.push({ fn: 'decide', tenantId, userId, id, decision, comment });
    if (id === SOMEONE_ELSES) throw dbError('42501', 'You are not the approver for this step');
    if (decision === 'rejected' && !comment) throw dbError('22023', 'Give a reason for rejecting: the employee will see it');
    if (id !== APP) throw dbError('P0002', 'No such leave application waiting for a decision');
    return { request_status: decision === 'approved' ? 'approved' : 'rejected', application: { id: APP, status: decision } };
  },
  importLeave: async ({ tenantId, platformTenantId, records, dryRun }: Row) => {
    calls.push({ fn: 'importLeave', tenantId, platformTenantId, records, dryRun });
    return { dry_run: dryRun, counts: { would_import: (records as unknown[]).length }, results: [] };
  },
  uploadDocument: async ({ tenantId, bytes, contentType, extension }: { tenantId: string; bytes: Buffer; contentType: string; extension: string }) => {
    const path = `${tenantId}/my-hr/${crypto.randomUUID()}.${extension}`;
    documents.set(path, { bytes, contentType });
    return path;
  },
  removeDocument: async (path: string) => {
    documents.delete(path);
  },
  documentUrl: async (path: string, seconds: number) => `https://storage.invalid/sign/${encodeURIComponent(path)}?expires=${seconds}&token=signed-token`,
  log: async (entry: Row) => {
    logRows.push(entry);
  },
};

const platform = {
  call: async (_method: string, path: string) => {
    const school = new URL(path, 'https://p.invalid').searchParams.get('local_id');
    if (school === SCHOOL) return { platform_tenant_id: PT, module: 'schools', local_id: SCHOOL, caller_local_id: HR_CO };
    if (school === SCHOOL_OTHER) return { platform_tenant_id: PT_OTHER, module: 'schools', local_id: SCHOOL_OTHER, caller_local_id: HR_OTHER };
    throw new PlatformError(404, 'not_found', 'Not found');
  },
  configured: () => true,
  resetToken: () => {},
};

let server: Server;
let base: string;
const logged: string[] = [];
let links: ReturnType<typeof import('../my_hr_routes.js')['createLinkResolver']>;

beforeAll(async () => {
  mod = await import('../my_hr_routes.js');
  PlatformError = (await import('../platform_client.js')).PlatformError as never;
  const platformKeys = await generateKeyPair('RS256');
  const attackerKeys = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(platformKeys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' } as JWK;
  keys = createLocalJWKSet({ keys: [jwk] });
  sign = async (claims, { key = 'platform' } = {}) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(ISSUER).setExpirationTime('1h')
      .sign(key === 'platform' ? platformKeys.privateKey : attackerKeys.privateKey);
  links = mod.createLinkResolver({ platform: platform as never });
  const express = (await import('express')).default;
  const app = express();
  app.use('/api/integrations/my-hr', mod.createMyHrRouter({
    store: store as never,
    links,
    verifyToken: (header: string) => mod.verifySchoolsToken(header, keys),
    rateLimit: async () => true,
  }));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const level of ['log', 'warn', 'error', 'info'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
  }
});
afterAll(() => {
  server?.close();
  vi.restoreAllMocks();
});
beforeEach(() => {
  process.env.MY_HR_API_ENABLED = 'true';
  process.env.PLATFORM_ISSUER = ISSUER;
  process.env.PLATFORM_SCHOOLS_CLIENT_ID = SCHOOLS_CLIENT;
  calls.length = 0;
  logRows.length = 0;
  documents.clear();
  applyFails = null;
  links.clear();
});

const access = () => ({ token_use: 'access', client_id: SCHOOLS_CLIENT, sub: SCHOOLS_CLIENT });
const call = async (method: string, path: string, { body, raw, token, school = SCHOOL, person = MARY }: { body?: unknown; raw?: string; token?: string; school?: string; person?: string | null } = {}) => {
  const headers: Record<string, string> = { authorization: `Bearer ${token ?? (await sign(access()))}`, 'x-figbloom-school': school };
  if (person) headers['x-figbloom-person'] = person;
  if (body !== undefined || raw !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${base}/api/integrations/my-hr/${path}`, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
};
const json = async (res: Response) => (await res.json()) as Row & { error?: { code?: string; message?: string; problems?: string[] } };
const pdf = (bytes = 1000) => ({ name: 'Doctor report.pdf', content_type: 'application/pdf', base64: Buffer.alloc(bytes, 7).toString('base64') });
const application = (extra: Row = {}) => ({ type_id: TYPE, start_date: '2026-12-01', end_date: '2026-12-02', reason: SECRET_REASON, ...extra });

describe('the form', () => {
  it('for the person in the session only', async () => {
    const res = await call('GET', 'leave/form');
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ status: 'active', leave_types: [{ id: TYPE }], approval_chain: [{ label: 'Leave approver' }] });
    expect(calls).toEqual([{ fn: 'leaveForm', tenantId: HR_CO, employee: 'E1' }]);
  });
  it('a draft employee: pending_hr', async () => {
    expect(await json(await call('GET', 'leave/form', { person: NEW }))).toEqual({ status: 'pending_hr' });
    expect(calls).toEqual([]);
  });
});

describe('applying', () => {
  it('201 with the application, as GET leave has it; the employee comes from the session, never the body', async () => {
    const res = await call('POST', 'leave/applications', { body: application({ employee_number: 'E2', half_day: false }) });
    expect(res.status).toBe(201);
    expect(await json(res)).toMatchObject({ status: 'active', application: { id: APP, status: 'pending' } });
    expect(calls[0]).toMatchObject({ fn: 'leaveApply', tenantId: HR_CO, employee: 'E1', typeId: TYPE, startDate: '2026-12-01', endDate: '2026-12-02', halfDay: false, documentPath: null });
  });

  it('with a document: stored under the company in HR\'s leave folder, its name on the application', async () => {
    const res = await call('POST', 'leave/applications', { body: application({ document: pdf() }) });
    expect(res.status).toBe(201);
    const [path, doc] = [...documents.entries()][0];
    expect(path).toMatch(new RegExp(`^${HR_CO}/my-hr/[0-9a-f-]{36}\\.pdf$`));
    expect(doc).toMatchObject({ contentType: 'application/pdf' });
    expect(doc.bytes.length).toBe(1000);
    expect(calls[0]).toMatchObject({ documentPath: path, documentName: 'Doctor report.pdf' });
  });

  it('HR\'s rules refuse: 422 leave_rules with HR\'s words, one problem each; the document is removed again', async () => {
    applyFails = dbError('P0001', "Annual Leave allows at most 10 days in one application (this is 12). Annual Leave needs 3 days' notice: the earliest start date is 08 Nov 2026");
    const res = await call('POST', 'leave/applications', { body: application({ document: pdf() }) });
    expect(res.status).toBe(422);
    const b = await json(res);
    expect(b.error?.code).toBe('leave_rules');
    expect(b.error?.message).toMatch(/at most 10 days/);
    expect(b.error?.problems).toEqual([
      'Annual Leave allows at most 10 days in one application (this is 12)',
      "Annual Leave needs 3 days' notice: the earliest start date is 08 Nov 2026",
    ]);
    expect(documents.size).toBe(0);
  });

  it.each([
    ['a document needed', 'Sick Leave needs a document with the application: Report from a registered medical practitioner'],
    ['the balance', 'Not enough Annual Leave left: 3 days free to book, and this needs 5'],
    ['once a month', 'You have already applied for Compassionate Leave this month'],
  ])('%s: surfaced as is', async (_name, message) => {
    applyFails = dbError('P0001', message);
    const b = await json(await call('POST', 'leave/applications', { body: application() }));
    expect(b.error).toMatchObject({ code: 'leave_rules', message, problems: [message] });
  });

  it('a type HR doesn\'t have: 422 invalid', async () => {
    applyFails = dbError('22023', 'Choose a leave type');
    const res = await call('POST', 'leave/applications', { body: application() });
    expect(res.status).toBe(422);
    expect((await json(res)).error).toMatchObject({ code: 'invalid', message: 'Choose a leave type' });
  });

  it.each([
    ['no type', application({ type_id: 'annual' })],
    ['bad dates', application({ start_date: '2026-02-30' })],
    ['half_day not a boolean', application({ half_day: 'yes' })],
    ['a short reason', application({ reason: 'sick' })],
    ['a file kind HR doesn\'t take', application({ document: { ...pdf(), name: 'run.exe' } })],
    ['a content type that isn\'t the file\'s', application({ document: { ...pdf(), content_type: 'text/html' } })],
    ['bad base64', application({ document: { ...pdf(), base64: '@@@@' } })],
    ['an empty file', application({ document: { ...pdf(), base64: '' } })],
  ])('%s: 400, nothing stored or applied', async (_name, body) => {
    const res = await call('POST', 'leave/applications', { body });
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe('bad_request');
    expect(calls).toEqual([]);
    expect(documents.size).toBe(0);
  });

  it('a document over 5 MB: 413', async () => {
    const res = await call('POST', 'leave/applications', { body: application({ document: pdf(5 * 1024 * 1024 + 1) }) });
    expect(res.status).toBe(413);
    expect(calls).toEqual([]);
  });

  it('a document of exactly 5 MB is taken', async () => {
    const res = await call('POST', 'leave/applications', { body: application({ document: pdf(5 * 1024 * 1024) }) });
    expect(res.status).toBe(201);
  });

  it('not JSON: 400', async () => {
    const res = await call('POST', 'leave/applications', { raw: '{"type_id":' });
    expect(res.status).toBe(400);
  });

  it('a bad token: 401 before the body is read', async () => {
    const res = await call('POST', 'leave/applications', { body: application(), token: await sign(access(), { key: 'attacker' }) });
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });
});

describe('cancelling', () => {
  it('own: 200 with the application', async () => {
    const res = await call('POST', `leave/applications/${APP}/cancel`);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ application: { id: APP, status: 'cancelled' } });
    expect(calls).toEqual([{ fn: 'leaveCancel', tenantId: HR_CO, employee: 'E1', id: APP }]);
  });
  it('someone else\'s or unknown: 404', async () => {
    expect((await call('POST', `leave/applications/${SOMEONE_ELSES}/cancel`)).status).toBe(404);
    expect((await call('POST', 'leave/applications/not-an-id/cancel')).status).toBe(404);
  });
  it('no longer cancellable: 409 with HR\'s reason', async () => {
    const res = await call('POST', 'leave/applications/e0000000-0000-4000-8000-000000000009/cancel');
    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatchObject({ code: 'not_cancellable', message: expect.stringMatching(/already started/) });
  });
});

describe('approvers', () => {
  it('not linked through external_logins: 409 approver_not_linked, nothing else read', async () => {
    const res = await call('GET', 'approvals', { person: HEAD_NOT_LINKED });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toEqual({ code: 'approver_not_linked', message: 'Open HR & Payroll once to connect your HR account.' });
    expect(calls.map((c) => c.fn)).toEqual(['approver']);
    // an employee who is not an HR login is not an approver either
    expect((await call('GET', 'approvals', { person: MARY })).status).toBe(409);
  });
  it('linked, but no longer a member: 403', async () => {
    const res = await call('GET', 'approvals', { person: SUSPENDED });
    expect(res.status).toBe(403);
    expect((await json(res)).error?.code).toBe('approver_no_access');
  });
  it('a person linked in another school\'s company is not linked through this school', async () => {
    expect((await call('GET', 'approvals', { person: OTHER_HEAD })).status).toBe(409);
  });

  it('the list: as the linked login; documents as short-lived links, never their paths', async () => {
    const res = await call('GET', 'approvals', { person: PRINCIPAL });
    expect(res.status).toBe(200);
    const b = await json(res);
    expect(calls).toContainEqual({ fn: 'approvals', tenantId: HR_CO, userId: LOGIN_PRINCIPAL });
    const item = (b.approvals as Row[])[0] as Row & { document: Row };
    expect(item.document.name).toBe('report.pdf');
    expect(String(item.document.url)).toMatch(/expires=300/);
    expect(new Date(String(item.document.expires_at)).getTime()).toBeLessThanOrEqual(Date.now() + 300_000);
    expect(item.document).not.toHaveProperty('path');
    expect(item.followup_document).toBeNull();
  });

  it('decide: as that login only; approve / decline map to HR\'s decisions', async () => {
    const res = await call('POST', `approvals/${APP}/decide`, { person: PRINCIPAL, body: { decision: 'approve', comment: ' Enjoy ' } });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ status: 'active', request_status: 'approved' });
    expect(calls).toContainEqual({ fn: 'decide', tenantId: HR_CO, userId: LOGIN_PRINCIPAL, id: APP, decision: 'approved', comment: 'Enjoy' });
    const declined = await call('POST', `approvals/${APP}/decide`, { person: PRINCIPAL, body: { decision: 'decline', comment: 'Exams week' } });
    expect(await json(declined)).toMatchObject({ request_status: 'rejected' });
  });
  it('another login\'s item: 403 in HR\'s words; unknown: 404', async () => {
    const res = await call('POST', `approvals/${SOMEONE_ELSES}/decide`, { person: PRINCIPAL, body: { decision: 'approve' } });
    expect(res.status).toBe(403);
    expect((await json(res)).error).toMatchObject({ code: 'not_your_approval', message: 'You are not the approver for this step' });
    expect((await call('POST', 'approvals/e0000000-0000-4000-8000-000000000009/decide', { person: PRINCIPAL, body: { decision: 'approve' } })).status).toBe(404);
    expect((await call('POST', 'approvals/nope/decide', { person: PRINCIPAL, body: { decision: 'approve' } })).status).toBe(404);
  });
  it('a decline without a reason: 422 (HR asks for one)', async () => {
    const res = await call('POST', `approvals/${APP}/decide`, { person: PRINCIPAL, body: { decision: 'decline' } });
    expect(res.status).toBe(422);
    expect((await json(res)).error?.message).toMatch(/Give a reason/);
  });
  it('a bad decision: 400; not linked: 409 before anything is decided', async () => {
    expect((await call('POST', `approvals/${APP}/decide`, { person: PRINCIPAL, body: { decision: 'yes' } })).status).toBe(400);
    expect((await call('POST', `approvals/${APP}/decide`, { person: HEAD_NOT_LINKED, body: { decision: 'approve' } })).status).toBe(409);
    expect(calls.filter((c) => c.fn === 'decide')).toEqual([]);
  });
});

describe('history import', () => {
  const records = [{ external_id: MARY, leave_type_name: 'Annual Leave', start_date: '2026-03-02', end_date: '2026-03-03', days: 2, status: 'approved', source_id: 'lr-1', extra: 'dropped' }];
  it('the school\'s token, no person; the company from the platform\'s link', async () => {
    const res = await call('POST', 'import/leave-history', { person: null, body: { records, dry_run: true } });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ status: 'active', dry_run: true });
    expect(calls).toEqual([{
      fn: 'importLeave', tenantId: HR_CO, platformTenantId: PT, dryRun: true,
      records: [{ external_id: MARY, leave_type_name: 'Annual Leave', start_date: '2026-03-02', end_date: '2026-03-03', days: '2', status: 'approved', source_id: 'lr-1' }],
    }]);
    await call('POST', 'import/leave-history', { person: null, body: { records } });
    expect(calls[1]).toMatchObject({ dryRun: false });
  });
  it('bad bodies: 400', async () => {
    expect((await call('POST', 'import/leave-history', { person: null, body: { records: 'all' } })).status).toBe(400);
    expect((await call('POST', 'import/leave-history', { person: null, body: { records, dry_run: 'yes' } })).status).toBe(400);
    expect((await call('POST', 'import/leave-history', { person: null, body: { records: new Array(5001).fill(records[0]) } })).status).toBe(400);
    expect(calls).toEqual([]);
  });
  it('an unlinked school: 403', async () => {
    const res = await call('POST', 'import/leave-history', { person: null, school: '5c1c2a4e-3b7d-4c1e-9a55-2d8f0e7b9c32', body: { records } });
    expect(res.status).toBe(403);
  });
});

describe('the audit and the logs', () => {
  it('approver calls are audited with the login; no token, document, reason or signed link in any log', async () => {
    logged.length = 0;
    const token = await sign(access());
    await call('POST', 'leave/applications', { token, body: application({ document: pdf(3000) }) });
    applyFails = dbError('P0001', 'Not enough Annual Leave left');
    await call('POST', 'leave/applications', { token, body: application({ document: pdf(3000) }) });
    await call('GET', 'approvals', { token, person: PRINCIPAL });
    await call('POST', `approvals/${APP}/decide`, { token, person: PRINCIPAL, body: { decision: 'decline', comment: 'Exams week secret' } });
    expect(logRows).toContainEqual({ route: 'approvals', tenantId: HR_CO, userId: LOGIN_PRINCIPAL, status: 200, outcome: 'ok' });
    expect(logRows).toContainEqual({ route: 'leave_apply', tenantId: HR_CO, employee: 'E1', status: 422, outcome: 'leave_rules' });
    const all = [...logged, ...logRows.map((r) => JSON.stringify(r))].join('\n');
    expect(all).not.toContain(token);
    expect(all).not.toContain(token.split('.')[2]);
    expect(all).not.toContain(pdf(3000).base64.slice(0, 40));
    expect(all).not.toContain(SECRET_REASON);
    expect(all).not.toContain('Exams week secret');
    expect(all).not.toContain('signed-token');
    expect(all).not.toContain('Not enough');
  });
});
