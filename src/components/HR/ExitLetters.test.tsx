import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ExitRecord } from '../../lib/exits';

const mocks = vi.hoisted(() => ({ send: vi.fn(), archive: vi.fn(), open: vi.fn(), docs: [] as unknown[] }));
const PDF = vi.hoisted(() => new Blob(['%PDF'], { type: 'application/pdf' }));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../Signature/MySignature', () => ({
  default: ({ onChange }: { onChange?: (s: string | null) => void }) => (
    <button type="button" onClick={() => onChange?.('data:image/png;base64,SIG')}>use my signature</button>
  ),
}));
vi.mock('../../lib/generatedDocuments', () => ({
  loadDocumentsFor: () => Promise.resolve(mocks.docs),
  openGeneratedDocument: (...a: unknown[]) => mocks.open(...a),
}));
vi.mock('../../lib/offers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/offers')>()),
  loadBranding: () => Promise.resolve({ name: 'Acme Ltd' }),
  letterPdfBlob: () => Promise.resolve(PDF),
}));
vi.mock('../../lib/exitLetters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/exitLetters')>()),
  loadExitLetterTemplates: () =>
    Promise.resolve([
      { id: 't1', title: 'RE: TERMINATION OF EMPLOYMENT', body: 'Dear {{first_name}},\n\nEffective {{last_working_day}}.\n\n{{signature}}\n{{sender_name}}', is_default: true, active: true },
      { id: 't2', title: 'RE: NON-CONFIRMATION OF EMPLOYMENT', body: 'Dear {{employee_name}}, not confirmed.', is_default: false, active: true },
      { id: 't3', title: 'Old one', body: 'x', is_default: false, active: false },
    ]),
  loadLetterRecipient: () =>
    Promise.resolve({ firstName: 'Jane', lastName: 'Wanjiku', jobTitle: 'Sales', startDate: null, workEmail: 'jane@acme.co', personalEmail: 'jane@gmail.com' }),
  loadLetterSender: () => Promise.resolve({ name: 'Mary Hr', title: 'HR Officer' }),
  sendExitLetter: (...a: unknown[]) => mocks.send(...a),
  archiveDownloadedExitLetter: (...a: unknown[]) => mocks.archive(...a),
}));

import ExitLetters from './ExitLetters';

const EXIT: ExitRecord = {
  id: 'x1', employee_number: 'E7', kind: 'termination', reason_category: 'poor_performance', reason: null, notice_given_on: '2026-10-26',
  notice_days: 7, last_working_day: '2026-11-03', notice_pay: false, letter_path: null, status: 'approved', decision_note: null,
  requested_by: null, decided_by: null, decided_at: null, access_ended_at: null, completed_at: null, created_at: '2026-10-26T08:00:00Z',
  employee_name: 'Jane Wanjiku',
};

const openComposer = async () => {
  render(<ExitLetters exit={EXIT} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Write a letter' }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByText('Dear Jane,');
  return within(dialog);
};

beforeEach(() => {
  mocks.send.mockReset().mockResolvedValue({ status: 'sent', to: ['jane@acme.co', 'jane@gmail.com'], document: { id: 'd1' } });
  mocks.archive.mockReset().mockResolvedValue({ id: 'd2' });
  mocks.open.mockReset().mockResolvedValue(undefined);
  mocks.docs = [];
});
afterEach(() => cleanup());

describe('exit letters', () => {
  it('lists the letters sent so far, each to open', async () => {
    mocks.docs = [{ id: 'd1', title: 'RE: TERMINATION OF EMPLOYMENT', emailed_to: ['jane@acme.co'], created_at: '2026-10-26T09:00:00Z', file_path: 'a/exit_letter/d1.pdf' }];
    render(<ExitLetters exit={EXIT} />);
    expect(await screen.findByText('RE: TERMINATION OF EMPLOYMENT')).toBeTruthy();
    expect(screen.getByText(/Emailed to jane@acme.co/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }));
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }));
  });

  it('starts from the default template, filled in for this exit, with only active templates to pick', async () => {
    const d = await openComposer();
    expect(d.getByText('Effective 3 November 2026.')).toBeTruthy();
    expect(d.getByText('Mary Hr')).toBeTruthy();
    const options = within(d.getByLabelText('Template') as HTMLElement).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['RE: TERMINATION OF EMPLOYMENT', 'RE: NON-CONFIRMATION OF EMPLOYMENT']);

    fireEvent.change(d.getByLabelText('Template'), { target: { value: 't2' } });
    expect(d.getByText('Dear Jane Wanjiku, not confirmed.')).toBeTruthy();
    expect(d.getByRole('heading', { name: 'RE: NON-CONFIRMATION OF EMPLOYMENT' })).toBeTruthy();
  });

  it('signs with the drawn signature and sends the PDF to the addresses ticked', async () => {
    const d = await openComposer();
    fireEvent.click(d.getByRole('button', { name: 'use my signature' }));
    expect((d.getByTestId('letter-signature') as HTMLImageElement).src).toBe('data:image/png;base64,SIG');

    fireEvent.click(d.getByLabelText(/jane@gmail.com/));
    fireEvent.change(d.getByLabelText('Another address'), { target: { value: 'Lawyer@Firm.co' } });
    fireEvent.click(d.getByRole('button', { name: 'Send by email' }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalled());
    expect(mocks.send.mock.calls[0][0]).toMatchObject({
      exit: { id: 'x1' }, title: 'RE: TERMINATION OF EMPLOYMENT', pdf: PDF, to: ['jane@acme.co', 'lawyer@firm.co'], branding: { name: 'Acme Ltd' },
    });
  });

  it('a downloaded letter is kept in the archive too', async () => {
    const d = await openComposer();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    fireEvent.click(d.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(mocks.archive).toHaveBeenCalledWith({ exit: EXIT, title: 'RE: TERMINATION OF EMPLOYMENT', pdf: PDF }));
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });
});
