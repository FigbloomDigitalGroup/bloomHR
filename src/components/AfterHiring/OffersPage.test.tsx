import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Offer } from '../../lib/offers';

const PDF = vi.hoisted(() => new Blob(['%PDF'], { type: 'application/pdf' }));
const mocks = vi.hoisted(() => ({ offers: [] as unknown[], docs: [] as unknown[], send: vi.fn(), archive: vi.fn(), render: vi.fn() }));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../Signature/MySignature', () => ({ default: () => null }));
vi.mock('./letterPdf', () => ({ renderLetterPdf: (...a: unknown[]) => mocks.render(...a) }));
vi.mock('../../lib/signatures', () => ({ loadMySignature: () => Promise.resolve('data:image/png;base64,MINE') }));
vi.mock('../../lib/exitLetters', () => ({ loadLetterSender: () => Promise.resolve({ name: 'Mary Hr', title: 'HR Officer' }) }));
vi.mock('../../lib/generatedDocuments', () => ({
  archiveDocument: (...a: unknown[]) => mocks.archive(...a),
  loadDocumentsFor: () => Promise.resolve(mocks.docs),
}));
vi.mock('../../lib/offers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/offers')>()),
  loadOffers: () => Promise.resolve(mocks.offers),
  loadOfferTemplates: () => Promise.resolve([]),
  loadOfferJobGroups: () => Promise.resolve([]),
  loadBranding: () => Promise.resolve({ name: 'Acme Ltd' }),
  sendOffer: (...a: unknown[]) => mocks.send(...a),
  letterPdfBlob: () => Promise.resolve(PDF),
}));

import OffersPage from './OffersPage';

const OFFER: Offer = {
  id: 'o1', application_id: null, template_id: null, candidate_first_name: 'Jane', candidate_last_name: 'Wanjiku',
  candidate_email: 'jane@gmail.com', job_title: 'Accountant', job_group_id: null, basic_salary: 50000, house_allowance: 0,
  travel_allowance: 0, other_allowances: 0, start_date: '2027-01-04', expiry_date: '2099-12-01', title: 'Offer of employment',
  body: 'Dear {{candidate_name}},\n\nYours sincerely,\n\n{{signature}}\n{{company_name}}', status: 'draft', sent_at: null,
  viewed_at: null, responded_at: null, decline_reason: null, employee_id: null, created_at: '2026-10-26T08:00:00Z',
};

const openOffer = async (offer: Offer) => {
  mocks.offers = [offer];
  render(<MemoryRouter><OffersPage /></MemoryRouter>);
  await screen.findByText(/Jane Wanjiku/);
  fireEvent.click(screen.getByRole('button', { name: /^(Open|Add as employee)$/ }));
  return screen.findByRole('dialog');
};

beforeEach(() => {
  mocks.docs = [];
  mocks.send.mockReset().mockResolvedValue({ status: 'sent', email: 'jane@gmail.com' });
  mocks.archive.mockReset().mockResolvedValue({ id: 'd1' });
  mocks.render.mockReset().mockResolvedValue(PDF);
});
afterEach(() => cleanup());

describe('signed offers', () => {
  it('a draft previews with your signature; sending signs it with your name and keeps the letter that went out', async () => {
    await openOffer(OFFER);
    await waitFor(() => expect((screen.getByTestId('letter-signature') as HTMLImageElement).src).toBe('data:image/png;base64,MINE'));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mocks.archive).toHaveBeenCalled());
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ id: 'o1' }), { name: 'Acme Ltd' }, { signature: 'data:image/png;base64,MINE', name: 'Mary Hr' });
    expect(mocks.render.mock.calls[0][0]).toMatchObject({ signature: 'data:image/png;base64,MINE', title: 'Offer of employment' });
    expect(mocks.archive).toHaveBeenCalledWith({
      kind: 'offer_letter', title: 'Offer: Jane Wanjiku, Accountant', referenceId: 'o1', pdf: PDF, emailedTo: ['jane@gmail.com'],
    });
  });

  it('a sent offer shows the signature it was sent with, not yours', async () => {
    await openOffer({ ...OFFER, status: 'sent', sent_at: '2026-10-20T08:00:00Z', signature: 'data:image/png;base64,SENT' });
    await waitFor(() => expect((screen.getByTestId('letter-signature') as HTMLImageElement).src).toBe('data:image/png;base64,SENT'));
  });

  it('an accepted offer shows the candidate’s signature, and the signed letter is kept once', async () => {
    const accepted = { ...OFFER, status: 'accepted' as const, sent_at: '2026-10-20T08:00:00Z', responded_at: '2026-10-22T08:00:00Z', candidate_signature: 'data:image/png;base64,JANE' };
    await openOffer(accepted);
    expect(screen.getByText('Accepted by Jane Wanjiku')).toBeTruthy();
    await waitFor(() => expect(mocks.archive).toHaveBeenCalledWith(expect.objectContaining({ kind: 'offer_acceptance', referenceId: 'o1', pdf: PDF })));
    cleanup();
    mocks.archive.mockClear();
    mocks.docs = [{ id: 'd1', kind: 'offer_acceptance' }];
    await openOffer(accepted);
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.archive).not.toHaveBeenCalled();
  });
});
