import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CompanyEmailSettingsCard from './CompanyEmailSettings';

const state = vi.hoisted(() => ({ perms: ['employees'] as string[] }));
const saveCompanyEmailSettings = vi.hoisted(() => vi.fn());
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ loading: false, hasAnyPermission: (ps: string[]) => ps.some((p) => state.perms.includes(p)) }),
}));
vi.mock('../../lib/companyEmailSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/companyEmailSettings')>()),
  loadCompanyEmailSettings: () => Promise.resolve({ eventReminders: true, eventReminderDays: 1, birthdayEmails: true }),
  saveCompanyEmailSettings,
}));

beforeEach(() => {
  state.perms = ['employees'];
  saveCompanyEmailSettings.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('Daily events and birthdays email settings', () => {
  it('reminds a day before by default; HR changes the days and turns birthdays off', async () => {
    render(<CompanyEmailSettingsCard />);
    expect(await screen.findByText('Event reminders 1 day before and on the day · Birthdays on')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Days before an event'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tell colleagues about birthdays' }));
    expect(screen.getByText('Event reminders 3 days before and on the day · No birthday emails')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(saveCompanyEmailSettings).toHaveBeenCalledWith({ eventReminders: true, eventReminderDays: 3, birthdayEmails: false }));
  });

  it('turning event reminders off greys out the days', async () => {
    render(<CompanyEmailSettingsCard />);
    await screen.findByText(/Birthdays on/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remind everyone of company events' }));
    expect((screen.getByLabelText('Days before an event') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('No event reminders · Birthdays on')).toBeTruthy();
  });

  it('is read-only for everyone else', async () => {
    state.perms = ['dashboard'];
    render(<CompanyEmailSettingsCard />);
    await screen.findByText(/Birthdays on/);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect((screen.getByRole('checkbox', { name: 'Tell colleagues about birthdays' }) as HTMLInputElement).disabled).toBe(true);
  });
});
