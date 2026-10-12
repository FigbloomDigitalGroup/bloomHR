// @vitest-environment node
//
// FIG-744: paying an approved payroll run from the server. The logic in payroll_payments.js runs against an
// in-memory fake of the Supabase client and fake M-Pesa / bank senders: who is queued how, that nothing is queued
// twice, how a batch is sent, and how results are recorded, including the cases where a payment must never be resent.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyB2CResult,
  applyB2CTimeout,
  applyPaymentResult,
  channelFor,
  markStalledAsUnknown,
  mpesaSender,
  planRunPayments,
  processPaymentBatch,
  queueRunPayments,
  retryFailedPayments,
  toMpesaPhone,
} from '../payroll_payments.js';

type Row = Record<string, unknown>;

/** A tiny in-memory stand-in for the parts of supabase-js these functions use. */
function fakeDb(tables: Record<string, Row[]>) {
  let nextId = 1;
  const query = (name: string) => {
    const table = (tables[name] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    let range: [number, number] | null = null;
    let action: { kind: 'select' } | { kind: 'update'; values: Row } | { kind: 'upsert'; rows: Row[]; conflict: string[] } = { kind: 'select' };
    const matching = () => table.filter((r) => filters.every((f) => f(r)));
    const run = () => {
      if (action.kind === 'update') {
        const hit = matching();
        hit.forEach((r) => Object.assign(r, (action as { values: Row }).values));
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      if (action.kind === 'upsert') {
        const { rows, conflict } = action;
        const inserted: Row[] = [];
        for (const row of rows) {
          if (table.some((r) => conflict.every((k) => r[k] === row[k]))) continue; // ignoreDuplicates
          const saved = { id: `pp${nextId++}`, ...row };
          table.push(saved);
          inserted.push(saved);
        }
        return { data: inserted, error: null };
      }
      const rows = matching();
      return { data: range ? rows.slice(range[0], range[1] + 1) : rows, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k.replace(/"/g, '')] ?? r[k])), b),
      lt: (k: string, v: string) => (filters.push((r) => String(r[k]) < v), b),
      order: () => b,
      range: (from: number, to: number) => ((range = [from, to]), b),
      update: (values: Row) => ((action = { kind: 'update', values }), b),
      upsert: (rows: Row[], opts: { onConflict: string }) => ((action = { kind: 'upsert', rows, conflict: opts.onConflict.split(',') }), b),
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return b;
  };
  return {
    tables,
    from: query,
    // claim_payroll_payments: queued payments of the channel from approved runs, marked sending with a fresh request id
    rpc: async (_fn: string, { p_channel, p_limit }: { p_channel: string; p_limit: number }) => {
      const approved = new Set((tables.payroll_runs ?? []).filter((r) => ['approved', 'paid'].includes(String(r.status))).map((r) => r.id));
      const batch = (tables.payroll_payments ?? []).filter((p) => p.channel === p_channel && p.status === 'queued' && approved.has(p.run_id)).slice(0, p_limit);
      batch.forEach((p) => Object.assign(p, { status: 'sending', attempts: Number(p.attempts ?? 0) + 1, request_id: `PAYROLL-${p.id}-${p.attempts}`, provider_ref: null }));
      return { data: batch.map((p) => ({ ...p })), error: null };
    },
  };
}

const RUN = '11111111-1111-1111-1111-111111111111';
const TENANT = 'tenant-a';

describe('who is paid how', () => {
  it('reads Kenyan mobile numbers in the forms people type them', () => {
    expect(['0712345678', '712345678', '+254 712 345 678', '254112345678', '0112345678'].map(toMpesaPhone)).toEqual([
      '254712345678',
      '254712345678',
      '254712345678',
      '254112345678',
      '254112345678',
    ]);
    expect([null, '', '12345', '0812345678', '25471234567'].map(toMpesaPhone)).toEqual([null, null, null, null, null]);
  });

  it('pays M-Pesa (and no method) by M-Pesa, bank transfer by bank, and leaves the rest out', () => {
    expect([null, '', 'M-Pesa', 'MPESA', 'Mobile Money', 'Bank Transfer', 'bank', 'Cash', 'Airtel Money', 'Cheque'].map(channelFor)).toEqual([
      'mpesa',
      'mpesa',
      'mpesa',
      'mpesa',
      'mpesa',
      'bank',
      'bank',
      null,
      null,
      null,
    ]);
  });

  it('plans each payslip: where to pay from the employee record, how much from the payslip', () => {
    const employees = new Map<string, Row>([
      ['E1', { 'Mobile Number': '0712345678' }],
      ['E2', { Bank: 'KCB', 'Bank Branch': 'Moi Avenue', 'Account Number': '1100-223 344', account_number_name: 'Ben B' }],
      ['E3', { 'Mobile Number': '' }],
      ['E4', { Bank: 'KCB', 'Account Number': 'ABC' }],
      ['E6', { 'Mobile Number': '0712000006' }],
      ['E7', { 'Mobile Number': '0712000007' }],
    ]);
    const { payments, skipped } = planRunPayments(
      [
        { employee_id: 'E1', employee_name: 'Ann', net_pay: 49999.6, payment_method: 'M-Pesa' },
        { employee_id: 'E2', employee_name: 'Ben', net_pay: 80000.456, payment_method: 'Bank Transfer' },
        { employee_id: 'E3', employee_name: 'Cy', net_pay: 1000, payment_method: null },
        { employee_id: 'E4', employee_name: 'Di', net_pay: 1000, payment_method: 'Bank Transfer' },
        { employee_id: 'E5', employee_name: 'Ed', net_pay: 1000, payment_method: 'Cash' },
        { employee_id: 'E6', employee_name: 'Fe', net_pay: 200000, payment_method: 'M-Pesa' },
        { employee_id: 'E7', employee_name: 'Gu', net_pay: 5, payment_method: 'M-Pesa' },
        { employee_id: '', net_pay: 1000 },
      ],
      employees
    );
    expect(payments).toEqual([
      { employee_number: 'E1', employee_name: 'Ann', channel: 'mpesa', phone: '254712345678', amount: 50000 },
      {
        employee_number: 'E2',
        employee_name: 'Ben',
        channel: 'bank',
        bank_name: 'KCB',
        bank_branch: 'Moi Avenue',
        account_number: '1100223344',
        account_name: 'Ben B',
        amount: 80000.46,
      },
    ]);
    expect(skipped.map((s) => `${s.employee_number}: ${s.reason}`)).toEqual([
      'E3: no mobile number',
      'E4: bank account number ABC should be digits only',
      'E5: paid by Cash, which is paid outside the app',
      'E6: net pay of KSh 200,000 is above the M-Pesa limit of KSh 150,000; pay by bank',
      'E7: net pay of KSh 5 is below the M-Pesa minimum of KSh 10',
    ]);
  });
});

describe('queueing a run', () => {
  let db: ReturnType<typeof fakeDb>;
  beforeEach(() => {
    db = fakeDb({
      payroll_runs: [{ id: RUN, tenant_id: TENANT, pay_period: '2026-10', status: 'approved' }],
      salary_history: [
        { run_id: RUN, employee_id: 'E1', employee_name: 'Ann', net_pay: 1000, payment_method: 'M-Pesa' },
        { run_id: RUN, employee_id: 'E2', employee_name: 'Ben', net_pay: 2000, payment_method: 'Bank Transfer' },
        { run_id: RUN, employee_id: 'E3', employee_name: 'Cy', net_pay: 3000, payment_method: 'Cash' },
      ],
      employees: [
        { tenant_id: TENANT, 'Employee Number': 'E1', 'Mobile Number': '0712345678' },
        { tenant_id: TENANT, 'Employee Number': 'E2', Bank: 'KCB', 'Account Number': '1100223344' },
        { tenant_id: 'other', 'Employee Number': 'E3', 'Mobile Number': '0799999999' },
      ],
      payroll_payments: [],
    });
  });

  it('queues M-Pesa and bank staff, lists who was left out, and never queues anyone twice', async () => {
    const first = await queueRunPayments(db, { tenantId: TENANT, userId: 'u1', runId: RUN });
    expect(first).toEqual({ queued: 2, alreadyQueued: 0, skipped: [{ employee_number: 'E3', employee_name: 'Cy', reason: 'paid by Cash, which is paid outside the app' }] });
    expect(db.tables.payroll_payments.map((p) => `${p.employee_number}:${p.channel}:${p.status}:${p.tenant_id}`)).toEqual([
      'E1:mpesa:queued:tenant-a',
      'E2:bank:queued:tenant-a',
    ]);
    const again = await queueRunPayments(db, { tenantId: TENANT, userId: 'u1', runId: RUN });
    expect(again).toMatchObject({ queued: 0, alreadyQueued: 2 });
    expect(db.tables.payroll_payments).toHaveLength(2);
  });

  it('refuses a draft run, and a run of another company', async () => {
    db.tables.payroll_runs[0].status = 'draft';
    await expect(queueRunPayments(db, { tenantId: TENANT, userId: 'u1', runId: RUN })).rejects.toThrow(/is a draft: approve it before paying/);
    db.tables.payroll_runs[0].status = 'approved';
    await expect(queueRunPayments(db, { tenantId: 'someone-else', userId: 'u1', runId: RUN })).rejects.toThrow(/not found/);
  });

  it('retries failed payments only, never ones whose outcome is unknown', async () => {
    db.tables.payroll_payments.push(
      { id: 'a', tenant_id: TENANT, run_id: RUN, status: 'failed' },
      { id: 'b', tenant_id: TENANT, run_id: RUN, status: 'unknown' },
      { id: 'c', tenant_id: TENANT, run_id: RUN, status: 'paid' }
    );
    expect(await retryFailedPayments(db, { tenantId: TENANT, runId: RUN })).toEqual({ requeued: 1 });
    expect(db.tables.payroll_payments.map((p) => p.status)).toEqual(['queued', 'unknown', 'paid']);
  });
});

describe('sending a batch', () => {
  const queued = (id: string, channel: string) => ({ id, run_id: RUN, channel, status: 'queued', attempts: 0, phone: '254712345678', amount: 1000, employee_number: id });
  let db: ReturnType<typeof fakeDb>;
  beforeEach(() => {
    db = fakeDb({
      payroll_runs: [{ id: RUN, status: 'approved' }],
      payroll_payments: [queued('ok', 'mpesa'), queued('refused', 'mpesa'), queued('rejected', 'mpesa'), queued('lost', 'mpesa'), queued('bank1', 'bank')],
    });
  });

  it('marks each sent, failed (safe to retry) or unknown (never resent), and leaves other channels alone', async () => {
    const send = async (p: Row) => {
      if (p.id === 'refused') return { accepted: false, description: 'Invalid account' };
      if (p.id === 'rejected') throw Object.assign(new Error('Bad credential'), { definite: true });
      if (p.id === 'lost') throw Object.assign(new Error('socket hang up'), { definite: false });
      return { accepted: true, providerRef: `AG_${p.id}` };
    };
    expect(await processPaymentBatch(db, 'mpesa', send, { gapMs: 0 })).toEqual({ sent: 1, failed: 2, unknown: 1 });
    const status = Object.fromEntries(db.tables.payroll_payments.map((p) => [p.id, `${p.status}${p.provider_ref ? `:${p.provider_ref}` : ''}`]));
    expect(status).toEqual({ ok: 'sent:AG_ok', refused: 'failed', rejected: 'failed', lost: 'unknown', bank1: 'queued' });
    expect(db.tables.payroll_payments.find((p) => p.id === 'lost')?.result_desc).toMatch(/Check before paying again/);
  });

  it('turns payments stuck in sending into unknown', async () => {
    db.tables.payroll_payments.push({ id: 'stuck', channel: 'mpesa', status: 'sending', updated_at: '2026-01-01T00:00:00Z' });
    expect(await markStalledAsUnknown(db, 'mpesa')).toBe(1);
    expect(db.tables.payroll_payments.find((p) => p.id === 'stuck')?.status).toBe('unknown');
  });

  it('the M-Pesa sender passes the request id to Safaricom and reads its answer', async () => {
    const calls: Row[] = [];
    const send = mpesaSender(async (req: Row) => {
      calls.push(req);
      return req.amount === 1 ? { ResponseCode: '1', ResponseDescription: 'Insufficient funds' } : { ResponseCode: '0', ConversationID: 'AG_1' };
    });
    expect(await send({ request_id: 'PAYROLL-x', phone: '254712345678', amount: '1500.00', employee_number: 'E1', employee_name: 'Ann' })).toEqual({
      accepted: true,
      providerRef: 'AG_1',
    });
    expect(calls[0]).toMatchObject({ originatorConversationID: 'PAYROLL-x', phoneNumber: '254712345678', amount: 1500, remarks: 'Salary Ann' });
    expect(await send({ request_id: 'PAYROLL-y', phone: '254712345678', amount: 1, employee_number: 'E2' })).toEqual({
      accepted: false,
      description: 'Insufficient funds',
    });
  });
});

describe('results', () => {
  let db: ReturnType<typeof fakeDb>;
  beforeEach(() => {
    db = fakeDb({
      payroll_payments: [
        { id: 'p1', request_id: 'PAYROLL-1', status: 'sent', provider_ref: 'AG_1' },
        { id: 'p2', request_id: 'PAYROLL-2', status: 'sent', provider_ref: 'AG_2' },
        { id: 'p3', request_id: 'PAYROLL-3', status: 'paid', provider_ref: 'AG_3', receipt: 'R3' },
        { id: 'p4', request_id: 'PAYROLL-4', status: 'sent', provider_ref: 'AG_4' },
      ],
    });
  });
  const row = (id: string) => db.tables.payroll_payments.find((p) => p.id === id)!;

  it('records an M-Pesa success with its receipt, and a failure with the reason', async () => {
    const success = {
      OriginatorConversationID: 'PAYROLL-1',
      ConversationID: 'AG_1',
      ResultCode: 0,
      ResultDesc: 'The service request is processed successfully.',
      TransactionID: 'TX1',
      ResultParameters: { ResultParameter: [{ Key: 'TransactionReceipt', Value: 'RCT123' }] },
    };
    expect(await applyB2CResult(db, success)).toBe(true);
    expect(row('p1')).toMatchObject({ status: 'paid', receipt: 'RCT123', result_code: '0' });

    await applyB2CResult(db, { OriginatorConversationID: 'PAYROLL-2', ConversationID: 'AG_2', ResultCode: 2001, ResultDesc: 'The initiator information is invalid.' });
    expect(row('p2')).toMatchObject({ status: 'failed', receipt: null, result_code: '2001', result_desc: 'The initiator information is invalid.' });
  });

  it('ignores results for other payments, for a different accepted request, or for one already settled', async () => {
    expect(await applyB2CResult(db, { OriginatorConversationID: 'B2C_salary_advance', ResultCode: 0 })).toBe(false);
    await applyB2CResult(db, { OriginatorConversationID: 'PAYROLL-1', ConversationID: 'AG_forged', ResultCode: 0 });
    expect(row('p1').status).toBe('sent');
    await applyB2CResult(db, { OriginatorConversationID: 'PAYROLL-3', ConversationID: 'AG_3', ResultCode: 2001 });
    expect(row('p3')).toMatchObject({ status: 'paid', receipt: 'R3' });
  });

  it('a bank result goes through the same path', async () => {
    await applyPaymentResult(db, { requestId: 'PAYROLL-4', providerRef: 'AG_4', ok: true, receipt: 'BANKREF9', code: 'SUCCESS', description: 'Credited' });
    expect(row('p4')).toMatchObject({ status: 'paid', receipt: 'BANKREF9', result_code: 'SUCCESS' });
  });

  it('a Safaricom timeout marks the payment for checking, never for resending', async () => {
    expect(await applyB2CTimeout(db, { OriginatorConversationID: 'PAYROLL-2' })).toBe(true);
    expect(row('p2')).toMatchObject({ status: 'unknown' });
    expect(row('p2').result_desc).toMatch(/Check with Safaricom/);
  });
});
