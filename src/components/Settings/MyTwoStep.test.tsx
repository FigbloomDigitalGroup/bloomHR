import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MyTwoStepCard from './MyTwoStep';

const api = vi.hoisted(() => ({ loadMyTwoStep: vi.fn(), saveMyTwoStep: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/mfaApi', () => api);

beforeEach(() => {
  api.loadMyTwoStep.mockReset();
  api.saveMyTwoStep.mockReset();
});
afterEach(cleanup);

describe('My sign-in code', () => {
  it('turns it on for myself, by SMS', async () => {
    api.loadMyTwoStep.mockResolvedValue({ enabled: false, method: 'email', company_requires: false, company_method: 'email' });
    api.saveMyTwoStep.mockImplementation((enabled: boolean, method: string) =>
      Promise.resolve({ enabled, method, company_requires: false, company_method: 'email' }));
    render(<MyTwoStepCard />);
    fireEvent.click(await screen.findByLabelText('Ask for a code when I sign in'));
    fireEvent.click(screen.getByLabelText(/SMS/));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveMyTwoStep).toHaveBeenCalledWith(true, 'sms'));
  });

  it('shows it as on and locked when the company asks for a code', async () => {
    api.loadMyTwoStep.mockResolvedValue({ enabled: true, method: 'email', company_requires: true, company_method: 'email' });
    render(<MyTwoStepCard />);
    expect(await screen.findByText(/your company asks for a code/)).toBeTruthy();
    expect(screen.queryByLabelText('Ask for a code when I sign in')).toBeNull();
  });
});
