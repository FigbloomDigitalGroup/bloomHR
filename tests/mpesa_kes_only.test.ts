// @vitest-environment node
//
// M-Pesa Kenya pays Kenyan shillings only. Payslips carry a currency (KES, TZS, UGX or USD): the server's M-Pesa B2C
// route refuses a payslip in any other currency than KES before anything is saved or sent, whatever the page does.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// no real database, no real Safaricom: a refused payment must never reach either
process.env.ENV_FILE = 'does-not-exist.env';
process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
const axiosPost = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({ default: { post: axiosPost, get: vi.fn() } }));

let base = '';
let server: Server;
beforeAll(async () => {
  const { buildApp } = await import('../app.js');
  const { default: mpesaRouter } = await import('../mpesa.js');
  server = createServer(buildApp({ mpesaRouter }) as never);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());

const pay = (body: Record<string, unknown>) =>
  fetch(`${base}/api/mpesa/b2c`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const payslip = { phoneNumber: '254712345678', amount: 1000, employeeNumber: 'E1', fullName: 'Juma' };

describe('M-Pesa B2C route', () => {
  it.each(['TZS', 'UGX', 'USD', 'usd'])('refuses a payslip in %s', async (currency) => {
    const res = await pay({ ...payslip, currency });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe(
      `This payslip is in ${currency.toUpperCase()}: M-Pesa Kenya pays KES payslips only. Use the bank or mobile money file for its currency.`
    );
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it('lets a KES payslip, or one with no currency, through to the usual checks', async () => {
    // a bad phone number shows the currency check passed and the route carried on as before
    for (const currency of ['KES', undefined, null, '']) {
      const res = await pay({ ...payslip, phoneNumber: '12345', currency });
      expect(res.status).toBe(400);
      expect((await res.json()).message).toMatch(/Invalid phone number format/);
    }
    expect(axiosPost).not.toHaveBeenCalled();
  });
});

describe('isKesCurrency', () => {
  it('is true for KES and no currency, false for any other', async () => {
    const { isKesCurrency } = await import('../payroll_payments.js');
    expect([undefined, null, '', 'KES', ' kes '].map(isKesCurrency)).toEqual([true, true, true, true, true]);
    expect(['TZS', 'UGX', 'USD'].map(isKesCurrency)).toEqual([false, false, false]);
  });
});
