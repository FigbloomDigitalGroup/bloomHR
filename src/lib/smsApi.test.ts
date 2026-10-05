import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ token: 'tok-1' as string | null }));
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: session.token ? { access_token: session.token } : null } }) } },
}));

import { getSmsBalance, sendSingleSms, sendSms } from './smsApi';

const fetchMock = vi.fn();
beforeEach(() => {
  session.token = 'tok-1';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const ok = (json: unknown) => Promise.resolve(new Response(JSON.stringify(json), { status: 200 }));

describe('smsApi', () => {
  it('sends the session token and purpose, and returns the results', async () => {
    fetchMock.mockReturnValue(ok({ results: [{ phone: '254712345678', success: true }] }));
    const out = await sendSingleSms('0712345678', 'Hi', { purpose: 'sms-center', senderId: 'ACME' });
    expect(out).toMatchObject({ success: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/sms\/send$/);
    expect(init.headers.Authorization).toBe('Bearer tok-1');
    expect(JSON.parse(init.body)).toEqual({ purpose: 'sms-center', senderId: 'ACME', messages: [{ phone: '0712345678', message: 'Hi' }] });
  });

  it('never sends a provider key, and refuses when not signed in', async () => {
    fetchMock.mockReturnValue(ok({ results: [] }));
    await sendSms([{ phone: '0712345678', message: 'x' }], { purpose: 'birthday' });
    expect(JSON.stringify(fetchMock.mock.calls[0])).not.toMatch(/apikey|partnerID/i);

    session.token = null;
    await expect(sendSms([{ phone: '0712345678', message: 'x' }], { purpose: 'birthday' })).rejects.toThrow('not signed in');
  });

  it('splits more than 1000 messages into requests and keeps the order', async () => {
    fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
      const { messages } = JSON.parse(init.body);
      return new Response(JSON.stringify({ results: messages.map((m: { phone: string }) => ({ phone: m.phone, success: true })) }), { status: 200 });
    });
    const messages = Array.from({ length: 2300 }, (_, i) => ({ phone: String(i), message: 'x' }));
    const results = await sendSms(messages, { purpose: 'sms-center' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(2300);
    expect(results[0].phone).toBe('0');
    expect(results[2299].phone).toBe('2299');
  });

  it('turns a refusal into an error carrying the server message', async () => {
    fetchMock.mockReturnValue(Promise.resolve(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })));
    await expect(sendSingleSms('0712345678', 'x', { purpose: 'sms-center' })).rejects.toThrow('Forbidden');
  });

  it('explains a network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(getSmsBalance()).rejects.toThrow('Could not reach the server');
  });

  it('reads the balance', async () => {
    fetchMock.mockReturnValue(ok({ balance: 1234.5 }));
    expect(await getSmsBalance()).toBe(1234.5);
    fetchMock.mockReturnValue(ok({ balance: null }));
    expect(await getSmsBalance()).toBeNull();
  });
});
