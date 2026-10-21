import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  loadMyOnboarding: vi.fn(),
  saveMyOnboarding: vi.fn(),
  submitMyOnboarding: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/avatarStorage', () => ({ uploadEmployeeAvatar: vi.fn() }));
vi.mock('../../lib/onboarding', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/onboarding')>();
  return { ...real, ...api };
});

import OnboardingForm from './OnboardingForm';
import { emptyContact, type FollowUp, type OnboardingRecord } from '../../lib/onboarding';

const record = (employee: Record<string, unknown>, missing: string[] = []): OnboardingRecord => ({
  employee: { id: 'id-1', 'Employee Number': 'E1', 'First Name': 'Amina', onboarding_status: 'invited', ...employee },
  emergency: emptyContact(),
  nextOfKin: emptyContact(),
  missing: { employee: missing, employer: [], documentsOutstanding: [] as string[], essentialsEmployee: missing, essentialsEmployer: [], followUps: [] },
  history: [],
});

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.saveMyOnboarding.mockResolvedValue(undefined);
  api.submitMyOnboarding.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe('OnboardingForm', () => {
  it('says what is still needed and lets the employee submit', async () => {
    api.loadMyOnboarding.mockResolvedValue(record({}, ['KRA PIN', 'Next of kin']));
    render(<OnboardingForm />);
    expect(await screen.findByText('KRA PIN, Next of kin')).toBeTruthy();
    expect(screen.getByText('Invited')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Submit to HR/ })).toBeTruthy();
  });

  it('shows HR’s comment when the details were sent back', async () => {
    api.loadMyOnboarding.mockResolvedValue(record({ onboarding_status: 'changes_requested', onboarding_review_comment: 'Upload a clearer ID' }));
    render(<OnboardingForm />);
    expect(await screen.findByText('Upload a clearer ID')).toBeTruthy();
    expect(screen.getByText('Changes requested')).toBeTruthy();
  });

  it('flags a malformed KRA PIN and won’t save until it is fixed', async () => {
    api.loadMyOnboarding.mockResolvedValue(record({}));
    render(<OnboardingForm />);
    const pin = await screen.findByPlaceholderText('A123456789B');
    fireEvent.change(pin, { target: { value: 'A123' } });
    expect(screen.getByRole('alert').textContent).toMatch(/should look like A123456789B/);
    expect((screen.getByRole('button', { name: /Submit to HR/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(pin, { target: { value: 'a012345678b' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: /Submit to HR/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('saves, then submits, then shows the new status', async () => {
    api.loadMyOnboarding
      .mockResolvedValueOnce(record({}))
      .mockResolvedValue(record({ onboarding_status: 'submitted' }));
    render(<OnboardingForm />);
    fireEvent.click(await screen.findByRole('button', { name: /Submit to HR/ }));
    await waitFor(() => expect(api.submitMyOnboarding).toHaveBeenCalled());
    expect(api.saveMyOnboarding).toHaveBeenCalledWith('E1', expect.objectContaining({ 'First Name': 'Amina' }), expect.anything(), expect.anything());
    expect(await screen.findByText('Waiting for review')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Submit to HR/ })).toBeNull();
  });

  it('shows why the database refused to submit', async () => {
    api.loadMyOnboarding.mockResolvedValue(record({}));
    api.submitMyOnboarding.mockRejectedValue(new Error('Still missing: NSSF number, Next of kin'));
    render(<OnboardingForm />);
    fireEvent.click(await screen.findByRole('button', { name: /Submit to HR/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('Still missing: NSSF number, Next of kin');
  });

  it('asks for the exemption certificate number only from a person with a disability', async () => {
    api.loadMyOnboarding.mockResolvedValue(record({}));
    render(<OnboardingForm />);
    await screen.findByText(/person with a disability/);
    expect(screen.queryByText('Exemption certificate number')).toBeNull();
    fireEvent.click(screen.getAllByLabelText('Yes')[0]);
    expect(screen.getByText('Exemption certificate number')).toBeTruthy();
  });

  it('explains when the login is not linked to an employee record', async () => {
    api.loadMyOnboarding.mockResolvedValue(null);
    render(<OnboardingForm />);
    expect(await screen.findByText(/not linked to an employee record/)).toBeTruthy();
  });

  const followUp = (item: string, extra: Partial<FollowUp> = {}): FollowUp => ({ item_key: 'documents', item, note: null, due_date: null, overdue: false, ...extra });

  it('says what is needed now and what can follow later', async () => {
    api.loadMyOnboarding.mockResolvedValue({ ...record({}), missing: { employee: ['NSSF number', 'Referee'], employer: [], documentsOutstanding: ['Updated CV'],
      essentialsEmployee: ['NSSF number'], essentialsEmployer: [], followUps: [followUp('Referee', { item_key: 'referee' }), followUp('Document: Updated CV')] } });
    render(<OnboardingForm />);
    expect((await screen.findByText('Needed now, before you can submit')).nextElementSibling?.textContent).toBe('NSSF number');
    expect(screen.getByText('Can follow later')).toBeTruthy();
    expect(screen.getByText('Document: Updated CV')).toBeTruthy();
    expect(screen.getByText(/You can submit without these/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Submit to HR/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('once approved, shows what is still to provide with HR’s due dates', async () => {
    api.loadMyOnboarding.mockResolvedValue({ ...record({ onboarding_status: 'approved' }), missing: { employee: ['Referee'], employer: [], documentsOutstanding: ['Updated CV'],
      essentialsEmployee: [], essentialsEmployer: [], followUps: [
        followUp('Referee', { item_key: 'referee' }),
        followUp('Document: Updated CV', { note: 'rejected, upload again', due_date: '2026-10-30', overdue: true }),
      ] } });
    render(<OnboardingForm />);
    expect(await screen.findByText('Still to provide')).toBeTruthy();
    expect(screen.getByText(/does not send your details back to HR/)).toBeTruthy();
    expect(screen.getByText('Document: Updated CV (rejected, upload again, due 30 Oct 2026, overdue)')).toBeTruthy();
    expect(screen.queryByText('Needed now, before you can submit')).toBeNull();
    expect(screen.queryByRole('button', { name: /Submit to HR/ })).toBeNull();
  });
});

describe('saving as they type', () => {
  beforeEach(() => sessionStorage.clear());
  const slow = { timeout: 4000 };

  it('saves a moment after they stop typing', async () => {
    api.loadMyOnboarding.mockResolvedValue(record({}));
    render(<OnboardingForm />);
    fireEvent.change(await screen.findByLabelText(/^Preferred name/), { target: { value: 'Ami' } });
    expect(api.saveMyOnboarding).not.toHaveBeenCalled();
    await waitFor(() => expect(api.saveMyOnboarding).toHaveBeenCalled(), slow);
    expect(api.saveMyOnboarding).toHaveBeenLastCalledWith('E1', expect.objectContaining({ preferred_name: 'Ami' }), expect.anything(), expect.anything());
    expect(await screen.findByText(/Saved at/)).toBeTruthy();
  });

  it('a number not complete yet is not sent; the rest is', async () => {
    api.loadMyOnboarding.mockResolvedValue(record({ 'Tax PIN': null }));
    render(<OnboardingForm />);
    fireEvent.change(await screen.findByPlaceholderText('A123456789B'), { target: { value: 'A12' } });
    fireEvent.change(screen.getByLabelText(/^Preferred name/), { target: { value: 'Ami' } });
    await waitFor(() => expect(api.saveMyOnboarding).toHaveBeenCalled(), slow);
    const sent = api.saveMyOnboarding.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(sent.preferred_name).toBe('Ami');
    expect(sent['Tax PIN']).toBeNull();
    expect(await screen.findByText(/a number that isn’t complete yet saves when it is/)).toBeTruthy();
  });

  it('once HR approved, nothing saves by itself (a change goes back to HR)', async () => {
    api.loadMyOnboarding.mockResolvedValue(record({ onboarding_status: 'approved' }));
    render(<OnboardingForm />);
    fireEvent.change(await screen.findByLabelText(/^Preferred name/), { target: { value: 'Ami' } });
    await new Promise((r) => setTimeout(r, 2000));
    expect(api.saveMyOnboarding).not.toHaveBeenCalled();
    expect(screen.queryByText(/save as you type/)).toBeNull();
  });

  it('says when a save was refused and keeps what was typed', async () => {
    api.loadMyOnboarding.mockResolvedValue(record({}));
    api.saveMyOnboarding.mockRejectedValue(new Error('That NSSF number is already someone else’s.'));
    render(<OnboardingForm />);
    fireEvent.change(await screen.findByLabelText(/^Preferred name/), { target: { value: 'Ami' } });
    expect(await screen.findByText(/Not saved: That NSSF number is already someone else’s/, {}, slow)).toBeTruthy();
    expect((screen.getByLabelText(/^Preferred name/) as HTMLInputElement).value).toBe('Ami');
  });

  it('after a refresh, what was typed comes back, and can be discarded', async () => {
    api.loadMyOnboarding.mockResolvedValue(record({ onboarding_status: 'approved', preferred_name: 'Amina' }));
    render(<OnboardingForm />);
    fireEvent.change(await screen.findByLabelText(/^Preferred name/), { target: { value: 'Ami' } });
    cleanup(); // the page reloads
    render(<OnboardingForm />);
    expect(await screen.findByText(/We kept what you typed before the page reloaded/)).toBeTruthy();
    expect((screen.getByLabelText(/^Preferred name/) as HTMLInputElement).value).toBe('Ami');
    fireEvent.click(screen.getByRole('button', { name: 'Discard it' }));
    expect((screen.getByLabelText(/^Preferred name/) as HTMLInputElement).value).toBe('Amina');
    cleanup();
    render(<OnboardingForm />);
    expect((await screen.findByLabelText(/^Preferred name/) as HTMLInputElement).value).toBe('Amina');
    expect(screen.queryByText(/We kept what you typed/)).toBeNull();
  });
});
