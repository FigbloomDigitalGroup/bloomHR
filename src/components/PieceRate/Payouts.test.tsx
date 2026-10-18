import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { WorkPerson, WorkSettings } from '../../lib/pieceRate';
import { DEFAULT_WORK_SETTINGS } from '../../lib/pieceRate';
import type { PayoutBatch, PayoutLine } from '../../lib/piecePayouts';
import { today } from '../../lib/casualPay';

const api = vi.hoisted(() => ({
  batches: [] as unknown[],
  lines: [] as unknown[],
  loadPayoutBatches: vi.fn(),
  loadPayoutLines: vi.fn(),
  createPayoutBatch: vi.fn(),
  removePayoutLine: vi.fn(),
  refreshPayoutDetails: vi.fn(),
  approvePayoutBatch: vi.fn(),
  cancelPayoutBatch: vi.fn(),
  markPayoutExported: vi.fn(),
  loadEquityDebitAccount: vi.fn(),
  myUserId: vi.fn(),
  confirm: vi.fn(),
  saveAs: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('file-saver', () => ({ saveAs: api.saveAs }));
vi.mock('../../lib/confirmDialog', () => ({ confirmDialog: api.confirm }));
vi.mock('../../lib/pieceRateApi', () => ({ myUserId: api.myUserId }));
vi.mock('../../lib/piecePayoutsApi', () => ({
  loadPayoutBatches: api.loadPayoutBatches,
  loadPayoutLines: api.loadPayoutLines,
  createPayoutBatch: api.createPayoutBatch,
  removePayoutLine: api.removePayoutLine,
  refreshPayoutDetails: api.refreshPayoutDetails,
  approvePayoutBatch: api.approvePayoutBatch,
  cancelPayoutBatch: api.cancelPayoutBatch,
  markPayoutExported: api.markPayoutExported,
  loadEquityDebitAccount: api.loadEquityDebitAccount,
}));

import Payouts from './Payouts';

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const DAY = today();
const SETTINGS: WorkSettings = DEFAULT_WORK_SETTINGS;
const PEOPLE: WorkPerson[] = [
  { employee_number: 'W1', first_name: 'Wanjiru', last_name: 'One', job_title: null, department: null, worker_kind: 'employee', pay_basis: 'work',
    pay_frequency: 'daily', wht_category: null, supervisor: null, status: 'Active', is_team: false },
  { employee_number: 'M1', first_name: 'Mary', last_name: 'Salaried', job_title: null, department: null, worker_kind: 'employee', pay_basis: 'salary',
    pay_frequency: 'monthly', wht_category: null, supervisor: null, status: 'Active', is_team: false },
];
const batch = (over: Partial<PayoutBatch> = {}): PayoutBatch => ({
  id: 'b1', kind: 'daily', period_from: '2026-10-14', period_to: '2026-10-14', pay_period: '2026-10', status: 'draft', notes: null,
  worker_count: 2, flagged_count: 0, gross_total: 2000, ahl_total: 15, reserve_total: 100, wht_total: 30, net_total: 1855,
  created_by: 'someone-else', created_at: '2026-10-15T08:00:00Z', approved_by: null, approved_at: null, exported_at: null,
  cancelled_at: null, cancel_reason: null, ...over,
});
const line = (over: Partial<PayoutLine>): PayoutLine => ({
  id: 'l1', batch_id: 'b1', employee_number: 'W1', worker_name: 'Wanjiru One', worker_kind: 'employee', wht_category: null,
  work_from: '2026-10-14', work_to: '2026-10-14', work_amount: 1000, jobs_amount: 0, gross: 1000, ahl_rate: 0.015, reserve_rate: 0.1,
  wht_rate: 0, ahl: 15, reserve: 100, wht: 0, rounding: 0, net: 885, payment_method: 'M-Pesa', payment_kind: 'mobile',
  phone: '254712345678', bank: null, bank_branch: null, bank_code: null, branch_code: null, account_name: null, account_number: null,
  payroll_number: null, id_number: null, problem: null, ...over,
});
const LINES = [
  line({}),
  line({ id: 'l2', employee_number: 'C1', worker_name: 'Chege Contract', worker_kind: 'contractor', ahl: 0, reserve: 0, wht: 30, net: 970,
    payment_method: 'Bank Transfer', payment_kind: 'bank', phone: null, bank: 'KCB', bank_code: '01', branch_code: '094', account_number: '1100223344' }),
];

beforeEach(() => {
  for (const f of Object.values(api)) if (typeof f === 'function' && 'mockReset' in f) (f as ReturnType<typeof vi.fn>).mockReset();
  api.batches = [batch()];
  api.lines = LINES;
  api.loadPayoutBatches.mockImplementation(() => Promise.resolve(api.batches));
  api.loadPayoutLines.mockImplementation(() => Promise.resolve(api.lines));
  api.createPayoutBatch.mockResolvedValue('b1');
  api.removePayoutLine.mockResolvedValue(undefined);
  api.approvePayoutBatch.mockResolvedValue(undefined);
  api.markPayoutExported.mockResolvedValue(undefined);
  api.cancelPayoutBatch.mockResolvedValue(undefined);
  api.loadEquityDebitAccount.mockResolvedValue('1234567890');
  api.myUserId.mockResolvedValue('me');
  api.confirm.mockResolvedValue(true);
});
afterEach(() => cleanup());

const openFirst = async () => {
  render(<Payouts people={PEOPLE} settings={SETTINGS} />);
  await settle();
  fireEvent.click(screen.getByRole('button', { name: /^Open Daily payout/ }));
  await settle();
};

describe('the payouts list and making one', () => {
  it('lists batches and makes a daily payout for today by default', async () => {
    api.batches = [];
    render(<Payouts people={PEOPLE} settings={SETTINGS} />);
    await settle();
    expect(screen.getByText('No payouts yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New payout' }));
    expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe(DAY);
    api.batches = [batch()];
    fireEvent.click(screen.getByRole('button', { name: 'Make payout' }));
    await waitFor(() => expect(api.createPayoutBatch).toHaveBeenCalledWith('daily', DAY, DAY, null));
    await settle();
    // opens the new batch
    expect(await screen.findByLabelText('Wanjiru One to pay')).toBeTruthy();
  });

  it('ad hoc: pick who to pay from the workers paid by work', async () => {
    render(<Payouts people={PEOPLE} settings={SETTINGS} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'New payout' }));
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'ad_hoc' } });
    expect(screen.queryByText('Mary Salaried')).toBeNull();
    expect((screen.getByRole('button', { name: 'Make payout' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Make payout' }));
    await waitFor(() => expect(api.createPayoutBatch).toHaveBeenCalledWith('ad_hoc', `${DAY.slice(0, 7)}-01`, DAY, ['W1']));
  });

  it('shows why the database refused', async () => {
    api.createPayoutBatch.mockRejectedValue(new Error('Payroll for Oct 2026 is approved; that month is locked'));
    render(<Payouts people={PEOPLE} settings={SETTINGS} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'New payout' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make payout' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/locked/);
  });
});

describe('reviewing a draft', () => {
  it('each holdback and the net per worker, with totals; remove a line', async () => {
    await openFirst();
    expect(screen.getByLabelText('Wanjiru One to pay').textContent).toBe('KSh 885');
    expect(screen.getByLabelText('Chege Contract to pay').textContent).toBe('KSh 970');
    expect(screen.getByLabelText('Total to pay').textContent).toBe('KSh 1,855');
    expect(screen.getByText(/KSh 145 held to the month end/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Chege Contract' }));
    await waitFor(() => expect(api.removePayoutLine).toHaveBeenCalledWith('l2'));
  });

  it('approve, by someone other than who made it', async () => {
    await openFirst();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.approvePayoutBatch).toHaveBeenCalledWith('b1'));
  });

  it("whoever made it can't approve it while the setting is on", async () => {
    api.batches = [batch({ created_by: 'me' })];
    await openFirst();
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/someone else in payroll must approve it/)).toBeTruthy();
  });

  it('missing payment details block approval until fixed or removed', async () => {
    api.lines = [line({ problem: 'No valid M-Pesa number', phone: null })];
    await openFirst();
    expect(screen.getByText('No valid M-Pesa number')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh payment details' }));
    await waitFor(() => expect(api.refreshPayoutDetails).toHaveBeenCalledWith('b1'));
  });
});

describe('an approved payout', () => {
  it('downloads the bank, Equity and M-Pesa files, lists problems, and is marked exported', async () => {
    api.batches = [batch({ status: 'approved' })];
    api.lines = [...LINES, line({ id: 'l3', employee_number: 'W9', worker_name: 'Bad Phone', phone: '123', net: 50 })];
    await openFirst();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    const mpesaProblems = screen.getByLabelText('M-Pesa bulk (B2C) problems');
    expect(within(mpesaProblems).getByText(/Bad Phone/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'M-Pesa bulk (B2C) CSV' }));
    expect(api.saveAs).toHaveBeenCalledTimes(1);
    const [blob, name] = api.saveAs.mock.calls[0] as [Blob, string];
    expect(name).toBe('payout-daily-2026-10-14-mpesa-b2c.csv');
    const csv = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(csv.split('\r\n')[1]).toBe('254712345678,885,Wanjiru One,Daily pay 2026-10-14');

    fireEvent.click(screen.getByRole('button', { name: 'Bank bulk payment Excel' }));
    expect(api.saveAs.mock.calls[1][1]).toBe('payout-daily-2026-10-14-bank.xlsx');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Equity Bank (Eazzy Biz) CSV' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Equity Bank (Eazzy Biz) CSV' }));
    expect(api.saveAs.mock.calls[2][1]).toBe('payout-daily-2026-10-14-equity-eazzy-biz.csv');

    fireEvent.click(screen.getByRole('button', { name: 'Mark exported' }));
    await waitFor(() => expect(api.markPayoutExported).toHaveBeenCalledWith('b1'));
  });

  it("Equity waits for the company's Equity account; cancelling releases the work", async () => {
    api.batches = [batch({ status: 'approved' })];
    api.loadEquityDebitAccount.mockResolvedValue('');
    await openFirst();
    expect((screen.getByRole('button', { name: 'Equity Bank (Eazzy Biz) CSV' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Set the company's Equity account/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel payout' }));
    await waitFor(() => expect(api.cancelPayoutBatch).toHaveBeenCalledWith('b1', null));
  });
});
