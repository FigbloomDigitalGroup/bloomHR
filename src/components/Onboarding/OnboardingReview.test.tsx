import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  loadOnboardingOverview: vi.fn(),
  loadOnboardingForReview: vi.fn(),
  approveOnboarding: vi.fn(),
  approveOnBehalf: vi.fn(),
  requestOnboardingChanges: vi.fn(),
  inviteToOnboard: vi.fn(),
  setFollowUpDueDate: vi.fn(),
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
  status, submitted_at: null, reviewed_at: null, review_comment: null, employee_part: [], employer_part: [], documents_outstanding: [],
  essentials_missing: [], followups: [], followups_overdue: 0, ...extra,
});

const show = () => render(<MemoryRouter><OnboardingReview /></MemoryRouter>);

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.loadOnboardingOverview.mockResolvedValue([row('1', 'submitted'), row('2', 'draft'), row('3', 'approved')]);
  api.loadOnboardingForReview.mockImplementation((id: string) =>
    Promise.resolve({ employee: { id, 'First Name': `Person ${id}` }, emergency: emptyContact(), nextOfKin: emptyContact(), missing: { employee: [], employer: [], documentsOutstanding: [], essentialsEmployee: [], essentialsEmployer: [], followUps: [] }, history: [] }));
  api.approveOnboarding.mockResolvedValue(undefined);
  api.approveOnBehalf.mockResolvedValue(undefined);
  api.requestOnboardingChanges.mockResolvedValue(undefined);
  api.inviteToOnboard.mockResolvedValue({ status: 'sent', email: '2@co.com' });
  api.setFollowUpDueDate.mockResolvedValue(undefined);
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

  it('approves for someone who was invited but never sent their form', async () => {
    api.loadOnboardingOverview.mockResolvedValue([row('4', 'invited')]);
    show();
    fireEvent.click(await screen.findByText('All (1)'));
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/haven’t sent their form/)).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /^Approve$/ })).toBeNull();
    const button = within(dialog).getByRole('button', { name: /Approve for them/ }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(api.approveOnBehalf).toHaveBeenCalledWith('4'));
    expect(toast.success).toHaveBeenCalledWith('Person 4 is approved');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('can’t approve for them while an essential is missing', async () => {
    api.loadOnboardingOverview.mockResolvedValue([row('4', 'invited')]);
    api.loadOnboardingForReview.mockResolvedValue({ employee: { id: '4' }, emergency: emptyContact(), nextOfKin: emptyContact(),
      missing: { employee: ['Next of kin'], employer: [], documentsOutstanding: [], essentialsEmployee: ['Next of kin'], essentialsEmployer: [], followUps: [] },
      history: [] });
    show();
    fireEvent.click(await screen.findByText('All (1)'));
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    const dialog = await screen.findByRole('dialog');
    const essentials = await within(dialog).findByRole('region', { name: 'Essentials' });
    expect(within(essentials).getByText('Next of kin')).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: /Approve for them/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('can’t approve while HR’s own part is missing, and says what it is', async () => {
    api.loadOnboardingForReview.mockResolvedValue({ employee: { id: '1' }, emergency: emptyContact(), nextOfKin: emptyContact(),
      missing: { employee: [], employer: ['Type of employee'], documentsOutstanding: [], essentialsEmployee: [], essentialsEmployer: ['Type of employee'], followUps: [] },
      history: [] });
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

  it('filters to employees with something still to provide, and shows how many and what', async () => {
    api.loadOnboardingOverview.mockResolvedValue([
      row('1', 'approved', { followups: ['Referee', 'Document: Updated CV'], followups_overdue: 1 }),
      row('2', 'approved'),
    ]);
    show();
    fireEvent.click(await screen.findByText('Still to provide (1)'));
    expect(screen.getByText('Person 1')).toBeTruthy();
    expect(screen.queryByText('Person 2')).toBeNull();
    const line = screen.getByText(/^Still to provide: 2/);
    expect(line.textContent).toBe('Still to provide: 2 (1 overdue) · Referee, Document: Updated CV');
  });

  it('shows essentials and what can follow later apart, and approves with follow-ups outstanding', async () => {
    api.loadOnboardingForReview.mockResolvedValue({ employee: { id: '1' }, emergency: emptyContact(), nextOfKin: emptyContact(),
      missing: { employee: ['Referee', 'Sex'], employer: [], documentsOutstanding: ['Updated CV'], essentialsEmployee: [], essentialsEmployer: [],
        followUps: [
          { item_key: 'referee', item: 'Referee', note: null, due_date: null, overdue: false },
          { item_key: 'documents', item: 'Document: Updated CV', note: 'waiting for HR', due_date: '2026-10-30', overdue: false },
        ] },
      history: [] });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    const dialog = await screen.findByRole('dialog');
    const essentials = await within(dialog).findByRole('region', { name: 'Essentials' });
    expect(within(essentials).getByText(/All in\. You can approve\./)).toBeTruthy();
    const later = within(dialog).getByRole('region', { name: 'Can follow later' });
    expect(within(later).getByText('Referee')).toBeTruthy();
    expect(within(later).getByText('Document: Updated CV (waiting for HR)')).toBeTruthy();
    expect((within(later).getByLabelText('Due date for Document: Updated CV') as HTMLInputElement).value).toBe('2026-10-30');
    expect((within(dialog).getByRole('button', { name: /Approve/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('can’t approve while an essential is missing', async () => {
    api.loadOnboardingForReview.mockResolvedValue({ employee: { id: '1' }, emergency: emptyContact(), nextOfKin: emptyContact(),
      missing: { employee: ['NSSF number', 'Referee'], employer: [], documentsOutstanding: [], essentialsEmployee: ['NSSF number'], essentialsEmployer: [],
        followUps: [{ item_key: 'referee', item: 'Referee', note: null, due_date: null, overdue: false }] },
      history: [] });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    const dialog = await screen.findByRole('dialog');
    const essentials = await within(dialog).findByRole('region', { name: 'Essentials' });
    expect(within(essentials).getByText('NSSF number')).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: /Approve/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('HR sets a due date for an item still to provide', async () => {
    api.loadOnboardingOverview.mockResolvedValue([row('3', 'approved', { followups: ['Referee'] })]);
    api.loadOnboardingForReview.mockResolvedValue({ employee: { id: '3' }, emergency: emptyContact(), nextOfKin: emptyContact(),
      missing: { employee: ['Referee'], employer: [], documentsOutstanding: [], essentialsEmployee: [], essentialsEmployer: [],
        followUps: [{ item_key: 'referee', item: 'Referee', note: null, due_date: null, overdue: false }] },
      history: [] });
    show();
    fireEvent.click(await screen.findByText('All (1)'));
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Still to provide')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Due date for Referee'), { target: { value: '2026-11-01' } });
    await waitFor(() => expect(api.setFollowUpDueDate).toHaveBeenCalledWith('3', 'Referee', '2026-11-01'));
  });
});
