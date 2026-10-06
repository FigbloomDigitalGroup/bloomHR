import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'tok' } } }) } },
}));

import { BACKEND_UNAVAILABLE, adminApi } from './adminApi';

const respond = (body: BodyInit | null, init: ResponseInit = { status: 200 }) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, init));

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('adminApi', () => {
  it('lists users from a working backend, sending the person’s own token', async () => {
    const spy = respond(JSON.stringify({ users: [{ id: 'u1', email: 'a@b.co' }] }));
    expect(await adminApi.listUsers()).toEqual([{ id: 'u1', email: 'a@b.co' }]);
    expect((spy.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('where no backend is deployed the website answers with its home page: say so instead of crashing on undefined', async () => {
    // Vercel returns index.html with status 200 for /api/... because of its single-page-app rewrite
    respond('<!doctype html><html><body><div id="root"></div></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    await expect(adminApi.listUsers()).rejects.toThrow(BACKEND_UNAVAILABLE);
  });

  it('never hands a screen an undefined list (the cause of "reading filter")', async () => {
    respond(JSON.stringify({ somethingElse: true }));
    await expect(adminApi.listUsers()).rejects.toThrow(BACKEND_UNAVAILABLE);
    respond(JSON.stringify({}));
    await expect(adminApi.listAuthUsers()).rejects.toThrow(BACKEND_UNAVAILABLE);
  });

  it('shows the server’s own message when it refuses', async () => {
    respond(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    await expect(adminApi.listUsers()).rejects.toThrow('Forbidden');
  });

  it('says the backend cannot be reached when the network request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(adminApi.listUsers()).rejects.toThrow(/Could not reach the server/);
  });
});

describe('apiRequest for people without an account yet', () => {
  it('can call without a login: no Authorization header, and no session is needed', async () => {
    const { apiRequest } = await import('./adminApi');
    const spy = respond(JSON.stringify({ ok: true }));
    await apiRequest('POST', '/invites/accept', { token: 't' }, { auth: false });
    expect((spy.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('carries the server’s status and machine-readable code on the error', async () => {
    const { apiRequest, ApiError } = await import('./adminApi');
    respond(JSON.stringify({ error: 'You already have an account', code: 'account_exists' }), { status: 409 });
    const err = await apiRequest('POST', '/invites/accept', {}, { auth: false }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ message: 'You already have an account', status: 409, code: 'account_exists' });
  });
});
