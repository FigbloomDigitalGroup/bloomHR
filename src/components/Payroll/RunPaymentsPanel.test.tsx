import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  loadRunPayments: vi.fn(),
  queueRunPayments: vi.fn(),
  retryFailedPayments: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/payrollPayments', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/payrollPayments')>();
  return { ...real, ...api };
});

import toast from 'react-hot-toast';
import RunPaymentsPanel from './RunPaymentsPanel';
import { summarisePayments, type PayrollPayment } from '../../lib/payrollPayments';

const run = { id: 'r1', pay_period: '2026-10', status: 'approved' } as never;
const payment = (id: string, channel: 'mpesa' | 'bank', status: PayrollPayment['status'], amount = 1000, extra: Partial<PayrollPayment> = {}): PayrollPayment => ({
  id,
  employee_number: id,
  employee_name: `Name ${id}`,
  channel,
  phone: channel === 'mpesa' ? '254712345678' : null,
  bank_name: channel === 'bank' ? 'KCB' : null,
  account_number: channel === 'bank' ? '1100223344' : null,
  amount,
  status,
  attempts: 1,
  receipt: null,
  result_desc: null,
  updated_at: '',
  ...extra,
});

beforeEach(() => {
  api.loadRunPayments.mockReset();
  api.queueRunPayments.mockReset();
  api.retryFailedPayments.mockReset();
  vi.mocked(toast.success).mockClear();
});
afterEach(() => cleanup());

/** a progress line such as "1 of 2 paid (KSh 1,000)", whose count is in bold */
const progress = (pattern: RegExp) => (_: string, el: Element | null) => el?.tagName === 'SPAN' && pattern.test(el.textContent ?? '');

describe('summarisePayments', () => {
  it('counts and adds up each channel by status', () => {
    const s = summarisePayments([payment('a', 'mpesa', 'paid', 1000), payment('b', 'mpesa', 'paid', 500), payment('c', 'bank', 'failed', 2000)]);
    expect(s.mpesa.count.paid).toBe(2);
    expect(s.mpesa.amount.paid).toBe(1500);
    expect(s.bank.count.failed).toBe(1);
    expect(s.bank.total).toBe(1);
  });
});

describe('RunPaymentsPanel', () => {
  it('offers to pay staff, queues them, and lists who is not paid from here', async () => {
    api.loadRunPayments.mockResolvedValueOnce([]).mockResolvedValue([payment('E1', 'mpesa', 'queued'), payment('E2', 'bank', 'queued')]);
    api.queueRunPayments.mockResolvedValue({ queued: 2, alreadyQueued: 0, skipped: [{ employee_number: 'E3', employee_name: 'Cy', reason: 'paid by Cash, which is paid outside the app' }] });
    render(<RunPaymentsPanel run={run} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pay staff' }));
    await waitFor(() => expect(api.queueRunPayments).toHaveBeenCalledWith('r1'));
    expect(await screen.findAllByText(progress(/^0 of 1 paid/), {}, { timeout: 2000 })).toHaveLength(2); // M-Pesa and bank
    expect(screen.getAllByText('1 queued')).toHaveLength(2); // one M-Pesa, one bank
    expect(screen.getByText(/Not paid from here \(1\)/)).toBeTruthy();
    expect(screen.getByText(/Cy: paid by Cash/)).toBeTruthy();
    expect(screen.getByText(/Queued payments go out once the payment server is running/)).toBeTruthy();
  });

  it('shows progress, retries failures, and never offers to resend payments that may have gone out', async () => {
    api.loadRunPayments.mockResolvedValue([
      payment('E1', 'mpesa', 'paid', 1000),
      payment('E2', 'mpesa', 'failed', 2000, { result_desc: 'Invalid account' }),
      payment('E3', 'bank', 'unknown', 3000, { result_desc: 'The request broke off. Check before paying again.' }),
    ]);
    api.retryFailedPayments.mockResolvedValue({ requeued: 1 });
    render(<RunPaymentsPanel run={run} />);
    expect(await screen.findByText(progress(/^1 of 2 paid \(KSh 1,000\)/))).toBeTruthy();
    expect(screen.getByText(/Name E2 \(KSh 2,000\): Invalid account/)).toBeTruthy();
    expect(screen.getByText(/To check \(1\)/)).toBeTruthy();
    expect(screen.getByText(/Name E3 \(KSh 3,000, KCB 1100223344\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Retry 1 failed/ }));
    await waitFor(() => expect(api.retryFailedPayments).toHaveBeenCalledWith('r1'));
    expect(screen.queryByRole('button', { name: /Retry 2/ })).toBeNull(); // the unknown one is not retried
  });
});
