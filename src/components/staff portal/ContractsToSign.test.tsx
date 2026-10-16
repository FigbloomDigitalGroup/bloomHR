import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SigningContract } from '../../lib/contractSigning';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  open: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('../../lib/contractSigning', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/contractSigning')>();
  return { ...actual, listMyContracts: mocks.list, openContractFile: mocks.open, uploadSignedCopy: mocks.upload };
});
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import ContractsToSign from './ContractsToSign';

const base: SigningContract = {
  id: 'c1',
  tenant_id: 't1',
  employee_number: 'E1',
  title: 'Employment contract 2027',
  message: 'Please sign and return',
  sign_by: null,
  file_path: 't1/c1/original-x.pdf',
  file_name: 'contract.pdf',
  signed_path: null,
  signed_file_name: null,
  status: 'sent',
  send_back_reason: null,
  cancel_reason: null,
  sent_at: '2027-01-05T10:00:00Z',
  viewed_at: null,
  signed_at: null,
  reviewed_at: null,
  cancelled_at: null,
};

beforeEach(() => {
  mocks.list.mockReset();
  mocks.open.mockReset().mockResolvedValue(undefined);
  mocks.upload.mockReset().mockResolvedValue(base);
});
afterEach(() => cleanup());

describe('ContractsToSign', () => {
  it('shows nothing when HR has sent no contracts', async () => {
    mocks.list.mockResolvedValue([]);
    const { container } = render(<ContractsToSign />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('a new contract: download it (as the employee, so it is marked viewed) and upload the signed copy', async () => {
    mocks.list.mockResolvedValue([base]);
    render(<ContractsToSign />);
    await screen.findByText('Employment contract 2027');
    expect(screen.getByText('To sign')).toBeTruthy();
    expect(screen.getByText('Please sign and return')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Download contract/ }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledWith(base, 'contract', true));

    const file = new File(['%PDF'], 'signed.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Signed copy of Employment contract 2027'), { target: { files: [file] } });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith(base, file));
  });

  it('sent back: shows what HR wants fixed, and lets them replace their copy', async () => {
    mocks.list.mockResolvedValue([{ ...base, status: 'sent_back', signed_path: 't1/c1/signed-a.pdf', send_back_reason: 'Signature missing on page 3' }]);
    render(<ContractsToSign />);
    await screen.findByText('Needs fixing');
    expect(screen.getByRole('note').textContent).toMatch(/Signature missing on page 3/);
    expect(screen.getByRole('button', { name: /Replace signed copy/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /My signed copy/ })).toBeTruthy();
  });

  it('accepted: no more uploading', async () => {
    mocks.list.mockResolvedValue([{ ...base, status: 'accepted', signed_path: 't1/c1/signed-a.pdf', reviewed_at: '2027-01-08T10:00:00Z' }]);
    render(<ContractsToSign />);
    await screen.findByText('Accepted');
    expect(screen.queryByRole('button', { name: /(Upload|Replace) signed copy/ })).toBeNull();
    expect(screen.getByText(/HR accepted your signed copy/)).toBeTruthy();
  });

  it('says so when the contracts cannot load', async () => {
    mocks.list.mockRejectedValue(new Error('boom'));
    render(<ContractsToSign />);
    await screen.findByText(/Could not load the contracts HR sent you/);
  });
});
