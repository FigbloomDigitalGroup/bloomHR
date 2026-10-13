import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ loadBanks: vi.fn(), loadBranches: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/banks', async (importOriginal) => ({ ...(await importOriginal<object>()), ...api }));

import BankBranchFields from './BankBranchFields';

beforeEach(() => {
  api.loadBanks.mockResolvedValue([{ code: '68', name: 'Equity Bank Limited' }, { code: '01', name: 'Kenya Commercial Bank Limited' }]);
  api.loadBranches.mockImplementation((code: string) =>
    Promise.resolve(code === '68' ? [{ code: '175', name: 'Garden City' }, { code: '178', name: 'Wangige Sub Branch' }] : []));
});
afterEach(cleanup);

describe('BankBranchFields', () => {
  it('choosing a bank fills in its name and code and clears the branch', async () => {
    const onChange = vi.fn();
    render(<BankBranchFields values={{ 'Bank Branch': 'Old', branch_code: '999' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Choose the bank/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Equity Bank Limited' }));
    expect(onChange).toHaveBeenCalledWith({ Bank: 'Equity Bank Limited', bank_code: '68', 'Bank Branch': null, branch_code: null });
  });

  it('choosing a branch of that bank fills in its name and code, shown next to the label', async () => {
    const onChange = vi.fn();
    render(<BankBranchFields values={{ Bank: 'Equity Bank Limited', bank_code: '68' }} onChange={onChange} />);
    expect(screen.getByText('code 68')).toBeTruthy();
    await waitFor(() => expect(api.loadBranches).toHaveBeenCalledWith('68'));
    fireEvent.click(screen.getByRole('button', { name: /Choose the branch/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Garden City' }));
    expect(onChange).toHaveBeenCalledWith({ 'Bank Branch': 'Garden City', branch_code: '175' });
  });

  it('asks for the bank before the branch, and still shows a bank name typed before the list existed', () => {
    render(<BankBranchFields values={{ Bank: 'Stima Sacco' }} onChange={vi.fn()} />);
    expect(screen.getByText('Stima Sacco')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Choose the bank first/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
