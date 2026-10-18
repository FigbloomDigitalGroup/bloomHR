import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PayslipEmailRow, PayslipEmailSettings } from '../../lib/payslipEmails';

const db = vi.hoisted(() => ({
  rows: [] as PayslipEmailRow[],
  settings: { auto: false, password: true, keepDays: 0 } as PayslipEmailSettings,
  queue: vi.fn(),
  upload: vi.fn(),
  markUploaded: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/confirmDialog', () => ({ confirmDialog: db.confirm }));
vi.mock('./payslipPdf', () => ({ renderPayslipPdf: vi.fn() }));
vi.mock('../../lib/payslipEmails', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/payslipEmails')>()),
  listPayslipEmails: () => Promise.resolve(db.rows.map((r) => ({ ...r }))),
  loadPayslipEmailSettings: () => Promise.resolve(db.settings),
  queuePayslipEmails: db.queue,
  uploadPayslipPdf: db.upload,
  markPayslipPdfsUploaded: db.markUploaded,
}));

import EmailPayslipsPanel from './EmailPayslipsPanel';

const row = (employee_number: string, status: PayslipEmailRow['status'], extra: Partial<PayslipEmailRow> = {}): PayslipEmailRow => ({
  id: Number(employee_number.replace(/\D/g, '')), employee_number, employee_name: `Name ${employee_number}`, to_email: `${employee_number}@a.co`,
  status, error: null, attempts: 0, pdf_path: `t/2026-10/${employee_number}.pdf`, password_protected: true, ...extra,
});
const approved = { id: 'run1', pay_period: '2026-10', status: 'approved' } as never;
const draft = { id: 'run1', pay_period: '2026-10', status: 'draft' } as never;
const records = [{ employee_id: 'E1', employee_name: 'Name E1' }, { employee_id: 'E2', employee_name: 'Name E2' }];
const ids: Record<string, string | null> = { E1: '1234 5678', E2: '87654321' };

const panel = (props: Partial<React.ComponentProps<typeof EmailPayslipsPanel>> = {}) => {
  const makePdf = vi.fn((record: { employee_id: string }) => Promise.resolve(new Blob([`pdf ${record.employee_id}`])));
  const utils = render(
    <EmailPayslipsPanel run={approved} periodLabel="October 2026" records={records} companyInfo={{ company_name: 'Acme' }}
      idNumberFor={(n) => ids[n]} canEmail makePdf={makePdf} {...props} />,
  );
  return { ...utils, makePdf };
};

beforeEach(() => {
  db.rows = [];
  db.settings = { auto: false, password: true, keepDays: 0 };
  db.queue.mockReset().mockImplementation(() => {
    db.rows = [row('E1', 'waiting_pdf'), row('E2', 'waiting_pdf'), row('E3', 'skipped', { error: 'Not emailed: no work email', to_email: null })];
    return Promise.resolve();
  });
  db.upload.mockReset().mockResolvedValue(undefined);
  db.markUploaded.mockReset().mockImplementation((done: number[]) => {
    db.rows = db.rows.map((r) => (done.includes(r.id) ? { ...r, status: 'pending' } : r));
    return Promise.resolve();
  });
  db.confirm.mockReset().mockResolvedValue(true);
});
afterEach(cleanup);

describe('Email payslips', () => {
  it('is not there for a draft month, or without payroll access', async () => {
    const { unmount } = panel({ run: draft });
    expect(screen.queryByTestId('email-payslips')).toBeNull();
    unmount();
    panel({ canEmail: false });
    expect(screen.queryByTestId('email-payslips')).toBeNull();
  });

  it('asks first, then makes each PDF protected with the ID number, uploads it and hands it over', async () => {
    const { makePdf } = panel();
    fireEvent.click(await screen.findByRole('button', { name: /Email payslips/ }));
    await waitFor(() => expect(db.markUploaded).toHaveBeenCalled());
    expect(db.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Email October 2026 payslips?' }));
    expect(db.queue).toHaveBeenCalledWith('run1');
    expect(makePdf).toHaveBeenCalledTimes(2);
    expect(makePdf).toHaveBeenCalledWith(records[0], { company_name: 'Acme' }, '12345678');
    expect(makePdf).toHaveBeenCalledWith(records[1], { company_name: 'Acme' }, '87654321');
    expect(db.upload).toHaveBeenCalledWith('t/2026-10/E1.pdf', expect.any(Blob));
    expect(db.markUploaded).toHaveBeenCalledWith([1, 2]);
    expect(await screen.findByText(/Sent 0 of 2/)).toBeTruthy();
  });

  it('lists who was skipped and why', async () => {
    panel();
    fireEvent.click(await screen.findByRole('button', { name: /Email payslips/ }));
    const list = await screen.findByRole('list', { name: 'Skipped payslips' });
    expect(list.textContent).toContain('Name E3 (E3): no work email');
    expect(screen.getByText('1 skipped (no email address or ID number)')).toBeTruthy();
  });

  it('does nothing when the question is cancelled', async () => {
    db.confirm.mockResolvedValue(false);
    panel();
    fireEvent.click(await screen.findByRole('button', { name: /Email payslips/ }));
    await waitFor(() => expect(db.confirm).toHaveBeenCalled());
    expect(db.queue).not.toHaveBeenCalled();
  });

  it('without a password, the PDFs are made without one', async () => {
    db.queue.mockImplementation(() => {
      db.rows = [row('E1', 'waiting_pdf', { password_protected: false })];
      return Promise.resolve();
    });
    const { makePdf } = panel();
    fireEvent.click(await screen.findByRole('button', { name: /Email payslips/ }));
    await waitFor(() => expect(makePdf).toHaveBeenCalledWith(records[0], expect.anything(), null));
  });

  it('shows the progress and what failed, and retries the failed and skipped ones', async () => {
    db.rows = [row('E1', 'sent'), row('E2', 'failed', { error: 'Resend 500' }), row('E3', 'skipped', { error: 'Not emailed: no work email' })];
    panel();
    expect(await screen.findByText(/Sent 1 of 2/)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Name E2: Resend 500');
    db.queue.mockImplementation(() => {
      db.rows = [row('E1', 'sent'), row('E2', 'waiting_pdf'), row('E3', 'skipped', { error: 'Not emailed: no work email' })];
      return Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: /Retry failed and skipped/ }));
    await waitFor(() => expect(db.markUploaded).toHaveBeenCalledWith([2]));
    expect(db.confirm).not.toHaveBeenCalled();
  });

  it('PDFs left to make (the page was closed) can be continued', async () => {
    db.rows = [row('E1', 'waiting_pdf'), row('E2', 'pending')];
    const { makePdf } = panel();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(db.markUploaded).toHaveBeenCalledWith([1]));
    expect(makePdf).toHaveBeenCalledTimes(1);
    expect(db.queue).not.toHaveBeenCalled();
  });

  it('a payslip with no ID number for its password is not uploaded unprotected', async () => {
    db.queue.mockImplementation(() => {
      db.rows = [row('E9', 'waiting_pdf')];
      return Promise.resolve();
    });
    const { makePdf } = panel({ records: [...records, { employee_id: 'E9' }] });
    fireEvent.click(await screen.findByRole('button', { name: /Email payslips/ }));
    await waitFor(() => expect(db.queue).toHaveBeenCalled());
    await waitFor(() => expect(db.markUploaded).toHaveBeenCalledWith([]));
    expect(makePdf).not.toHaveBeenCalled();
    expect(db.upload).not.toHaveBeenCalled();
  });

  it('starts by itself right after approving when the company emails payslips automatically', async () => {
    db.settings = { auto: true, password: true, keepDays: 0 };
    const { rerender, makePdf } = panel();
    await screen.findByRole('button', { name: /Email payslips/ });
    expect(db.queue).not.toHaveBeenCalled(); // not just for opening the page
    await act(async () => {
      rerender(
        <EmailPayslipsPanel run={approved} periodLabel="October 2026" records={records} companyInfo={{ company_name: 'Acme' }}
          idNumberFor={(n) => ids[n]} canEmail makePdf={makePdf} autoStart={1} />,
      );
    });
    await waitFor(() => expect(db.markUploaded).toHaveBeenCalledWith([1, 2]));
    expect(db.confirm).not.toHaveBeenCalled();
  });

  it('does not start by itself when the company emails them by hand', async () => {
    const { rerender, makePdf } = panel();
    await screen.findByRole('button', { name: /Email payslips/ });
    await act(async () => {
      rerender(
        <EmailPayslipsPanel run={approved} periodLabel="October 2026" records={records} companyInfo={{}}
          idNumberFor={(n) => ids[n]} canEmail makePdf={makePdf} autoStart={1} />,
      );
    });
    expect(db.queue).not.toHaveBeenCalled();
  });
});
