import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  loadOnboardingSettings: vi.fn(),
  saveOnboardingSettings: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/onboarding', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/onboarding')>();
  return { ...real, ...api };
});

import toast from 'react-hot-toast';
import OnboardingEssentialsModal from './OnboardingEssentialsModal';
import type { EssentialItem } from '../../lib/onboarding';

const item = (item_key: string, label: string, essential: boolean, payroll_note: string | null = null, section = 'Identity and statutory numbers'): EssentialItem =>
  ({ item_key, label, section, essential, default_essential: essential, payroll_note });

const ITEMS = [
  item('full_name', 'Full name (surname and first name)', true, null, 'Personal details'),
  item('tax_number', 'Tax number (KRA PIN in Kenya, TIN in Tanzania and Uganda)', true, 'PAYE returns need each employee’s tax number.'),
  item('nssf_number', 'NSSF number', true, 'NSSF returns need each member’s number.'),
  item('referee', 'Referee', false, null, 'Documents, referees and policies'),
  item('documents', 'Required documents', false, null, 'Documents, referees and policies'),
];

const show = () => render(<OnboardingEssentialsModal onClose={onClose} />);
const onClose = vi.fn();
const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  onClose.mockReset();
  api.loadOnboardingSettings.mockResolvedValue({ reminder_every_days: 7, customised: false, items: ITEMS });
  api.saveOnboardingSettings.mockImplementation((_keys: string[], days: number) => Promise.resolve({ reminder_every_days: days, customised: true, items: ITEMS }));
});
afterEach(() => cleanup());

describe('OnboardingEssentialsModal', () => {
  it('shows each item ticked when it is essential, by section', async () => {
    show();
    expect((await screen.findByLabelText('NSSF number') as HTMLInputElement).checked).toBe(true);
    expect(box('Referee').checked).toBe(false);
    expect(screen.getByText('Personal details')).toBeTruthy();
    expect(screen.getByText('Documents, referees and policies')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('warns when an item payroll returns need is made optional, but lets HR save it', async () => {
    show();
    fireEvent.click(await screen.findByLabelText('NSSF number'));
    expect(screen.getByRole('alert').textContent).toMatch(/Payroll needs these.*NSSF number: NSSF returns need each member’s number/);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveOnboardingSettings).toHaveBeenCalledWith(['full_name', 'tax_number'], 7));
    expect(toast.success).toHaveBeenCalledWith('Onboarding settings saved');
    expect(onClose).toHaveBeenCalled();
  });

  it('ticks everything for all or nothing, and goes back to the default', async () => {
    show();
    fireEvent.click(await screen.findByText('Tick everything (all or nothing)'));
    expect(box('Referee').checked && box('Required documents').checked).toBe(true);
    expect(screen.getByText(/Everything is ticked/)).toBeTruthy();
    fireEvent.click(screen.getByText('Back to the default'));
    expect(box('Referee').checked).toBe(false);
    expect(box('NSSF number').checked).toBe(true);
  });

  it('saves the reminder interval, within 1 to 90 days', async () => {
    show();
    const days = await screen.findByLabelText('Reminder interval in days');
    fireEvent.change(days, { target: { value: '0' } });
    expect(screen.getByText('Choose 1 to 90 days.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(days, { target: { value: '14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveOnboardingSettings).toHaveBeenCalledWith(['full_name', 'tax_number', 'nssf_number'], 14));
  });

  it('says why it was not saved', async () => {
    api.saveOnboardingSettings.mockRejectedValue(new Error('Only HR can change the onboarding settings'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Only HR can change the onboarding settings'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
