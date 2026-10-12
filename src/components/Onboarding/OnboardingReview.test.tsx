import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  loadOnboardingOverview: vi.fn(),
  loadOnboardingForReview: vi.fn(),
  approveOnboarding: vi.fn(),
  requestOnboardingChanges: vi.fn(),
  inviteToOnboard: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/onboarding', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/onboarding')>();
  return { ...real, ...api };
});

import toast from 'react-hot-toast';
import OnboardingReview from './OnboardingReview';
import { emptyContact, type OverviewRow } from '../../lib/onboarding';

const row = (id: string, status: OverviewRow['status'], extra: Partial<OverviewRow> = {}): OverviewRow => ({
  id, employee_number: `E-${id}`, payroll_number: `PR-0000${id}`, name: `Person ${id}`, job_title: 'Clerk', work_email: `${id}@co.com`,
  status, submitted_at: null, reviewed_at: null, review_comment: null, employee_part: [], employer_part: [], ...extra,
});

const show = () => render(<MemoryRouter><OnboardingReview /></MemoryRouter>);

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.loadOnboardingOverview.mockResolvedValue([row('1', 'submitted'), row('2', 'draft'), row('3', 'approved')]);
  api.loadOnboardingForReview.mockImplementation((id: string) =>
    Promise.resolve({ employee: { id, 'First Name': `Person ${id}` }, emergency: emptyContact(), nextOfKin: emptyContact(), missing: { employee: [], employer: [] }, history: [] }));
  api.approveOnboarding.mockResolvedValue(undefined);
  api.requestOnboardingChanges.mockResolvedValue(undefined);
  api.inviteToOnboard.mockResolvedValue({ status: 'sent', email: '2@co.com' });
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});
afterEach(() => cleanup());

describe('OnboardingReview', () => {
  it('opens on the records waiting for review, with a count for every step', async () => {
    show();
    expect(await screen.findByText('Person 1')).toBeTruthy();
    expect(screen.queryByText('Person 2')).toBeNull();
    expect(screen.getByText('Waiting for review (1)')).toBeTruthy();
    fireEvent.click(screen.getByText('All (3)'));
    expect(screen.getByText('Person 2')).toBeTruthy();
    expect(screen.getByText('Person 3')).toBeTruthy();
  });

  it('invites someone who has not been invited, and refreshes', async () => {
    show();
    fireEvent.click(await screen.findByText('Not invited (1)'));
    fireEvent.click(screen.getByRole('button', { name: /^Invite$/ }));
    await waitFor(() => expect(api.inviteToOnboard).toHaveBeenCalledWith('2', '2@co.com'));
    expect(toast.success).toHaveBeenCalledWith('Invitation sent to 2@co.com');
    expect(api.loadOnboardingOverview).toHaveBeenCalledTimes(2);
  });

  it('approves a submitted record', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect((within(dialog).getByRole('button', { name: /Approve/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(dialog).getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(api.approveOnboarding).toHaveBeenCalledWith('1', ''));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('can’t approve while HR’s own part is missing, and says what it is', async () => {
    api.loadOnboardingForReview.mockResolvedValue({ employee: { id: '1' }, emergency: emptyContact(), nextOfKin: emptyContact(),
      missing: { employee: [], employer: ['Type of employee'] }, history: [] });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Type of employee')).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: /Approve/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends a record back with HR’s comment, and shows why if it can’t', async () => {
    api.requestOnboardingChanges.mockRejectedValueOnce(new Error('Say what needs changing.'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Send back/ }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Say what needs changing.');
    fireEvent.change(within(dialog).getByPlaceholderText('What should the employee change?'), { target: { value: 'Clearer ID please' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Send back/ }));
    await waitFor(() => expect(api.requestOnboardingChanges).toHaveBeenLastCalledWith('1', 'Clearer ID please'));
  });
});
