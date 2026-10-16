import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SigningContract } from '../../lib/contractSigning';

const mocks = vi.hoisted(() => ({ list: vi.fn(), review: vi.fn(), cancel: vi.fn(), open: vi.fn() }));

vi.mock('../../lib/contractSigning', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/contractSigning')>();
  return { ...actual, listContracts: mocks.list, reviewContract: mocks.review, cancelContract: mocks.cancel, openContractFile: mocks.open };
});
vi.mock('../../hooks/useEmployeeDirectory', () => ({ useEmployeeDirectory: () => ({ employees: [], loading: false, error: null }) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import ContractsModule from './ContractsModule';

const contract = (id: string, status: SigningContract['status'], name: string): SigningContract => ({
  id,
  tenant_id: 't1',
  employee_number: id.toUpperCase(),
  employee_name: name,
  title: 'Employment contract 2027',
  message: null,
  sign_by: null,
  file_path: `t1/${id}/original-x.pdf`,
  file_name: 'contract.pdf',
  signed_path: status === 'signed' ? `t1/${id}/signed-a.pdf` : null,
  signed_file_name: null,
  status,
  send_back_reason: null,
  cancel_reason: null,
  sent_at: '2027-01-05T10:00:00Z',
  viewed_at: null,
  signed_at: null,
  reviewed_at: null,
  cancelled_at: null,
});

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue([contract('e1', 'signed', 'Esther One'), contract('e2', 'viewed', 'Eric Two')]);
  mocks.review.mockReset().mockResolvedValue(undefined);
  mocks.cancel.mockReset().mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe('ContractsModule', () => {
  it('opens on the signed copies to review, with counts on each filter', async () => {
    render(<ContractsModule />);
    await screen.findByText('Esther One');
    expect(screen.queryByText('Eric Two')).toBeNull();
    expect(screen.getByText('To review (1)')).toBeTruthy();
    fireEvent.click(screen.getByText('With the employee (1)'));
    await screen.findByText('Eric Two');
  });

  it('accepts a signed copy', async () => {
    render(<ContractsModule />);
    fireEvent.click(await screen.findByText('Esther One'));
    fireEvent.click(await screen.findByRole('button', { name: 'Accept signed copy' }));
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith('e1', true));
  });

  it('sending back needs a reason', async () => {
    render(<ContractsModule />);
    fireEvent.click(await screen.findByText('Esther One'));
    fireEvent.click(await screen.findByRole('button', { name: 'Send back' }));
    const send = screen.getAllByRole('button', { name: 'Send back' }).at(-1) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('What needs fixing?'), { target: { value: 'Signature missing on page 3' } });
    fireEvent.click(send);
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith('e1', false, 'Signature missing on page 3'));
  });
});
