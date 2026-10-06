import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ token: 'tok-1' as string | null }));
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: session.token ? { access_token: session.token } : null } }) } },
}));

import { getEmailLog, listEmailLogs, sendEmailViaServer } from './emailApi';

const fetchMock = vi.fn();
beforeEach(() => {
  session.token = 'tok-1';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const ok = (json: unknown) => Promise.resolve(new Response(JSON.stringify(json), { status: 200 }));

describe('emailApi', () => {
  it('sends the session token and the purpose with the message', async () => {
    fetchMock.mockReturnValue(ok({ message: 'Email sent successfully', id: 'e1' }));
    const out = await sendEmailViaServer({ to: 'a@b.co', subject: 'Hi', html: '<p>x</p>', provider: 'resend' }, { purpose: 'email-portal' });
    expect(out.id).toBe('e1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/email\/send$/);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok-1');
    expect(JSON.parse(init.body)).toEqual({ to: 'a@b.co', subject: 'Hi', html: '<p>x</p>', provider: 'resend', purpose: 'email-portal' });
  });

  it('refuses when nobody is signed in, without calling the server', async () => {
    session.token = null;
    await expect(sendEmailViaServer({ to: 'a@b.co', subject: 's', html: 'h' }, { purpose: 'hr-reminder' })).rejects.toThrow('not signed in');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns a refusal into an error carrying the server message', async () => {
    fetchMock.mockReturnValue(Promise.resolve(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })));
    await expect(sendEmailViaServer({ to: 'a@b.co', subject: 's', html: 'h' }, { purpose: 'termination' })).rejects.toThrow('Forbidden');
  });

  it('explains a network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(listEmailLogs(20)).rejects.toThrow('Could not reach the server');
  });

  it('reads the log list and a single email, encoding what it puts in the address', async () => {
    fetchMock.mockReturnValue(ok({ data: [{ id: 'e1' }], has_more: false }));
    expect((await listEmailLogs(20)).data).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/email\/logs\?limit=20$/);

    fetchMock.mockReturnValue(ok({ id: 'x' }));
    await listEmailLogs(20, 'a b&c');
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/cursor=a%20b%26c$/);

    await getEmailLog('../domains');
    expect(String(fetchMock.mock.calls[2][0])).toMatch(/\/email\/logs\/\.\.%2Fdomains$/);
  });
});
