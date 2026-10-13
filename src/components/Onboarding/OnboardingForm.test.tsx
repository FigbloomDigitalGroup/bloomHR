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
import { emptyContact, type OnboardingRecord } from '../../lib/onboarding';

const record = (employee: Record<string, unknown>, missing: string[] = []): OnboardingRecord => ({
  employee: { id: 'id-1', 'Employee Number': 'E1', 'First Name': 'Amina', onboarding_status: 'invited', ...employee },
  emergency: emptyContact(),
  nextOfKin: emptyContact(),
  missing: { employee: missing, employer: [], documentsOutstanding: [] as string[] },
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

  it('lists documents still to upload, and says they can be submitted later', async () => {
    api.loadMyOnboarding.mockResolvedValue({ ...record({}), missing: { employee: [], employer: [], documentsOutstanding: ['Updated CV', 'HELB compliance certificate'] } });
    render(<OnboardingForm />);
    expect(await screen.findByText('Updated CV, HELB compliance certificate')).toBeTruthy();
    expect(screen.getByText(/You can submit without them/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Submit to HR/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
