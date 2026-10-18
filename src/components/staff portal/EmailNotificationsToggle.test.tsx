import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const db = vi.hoisted(() => ({ saveDigest: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/notificationPreferences', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/notificationPreferences')>()),
  loadUpdatesLevel: () => Promise.resolve('all'),
  loadEmailPreferences: () => Promise.resolve({ hrAlerts: 'all', chat: 'all' }),
  loadDigestPreferences: () => Promise.resolve({ events: true, birthdays: true }),
  saveDigestPreferences: db.saveDigest,
}));

import EmailNotificationsToggle from './EmailNotificationsToggle';

beforeEach(() => db.saveDigest.mockReset().mockResolvedValue(undefined));
afterEach(cleanup);

describe('the daily company email in my email settings', () => {
  it('events and birthdays are on; birthdays can be turned off on their own', async () => {
    render(<EmailNotificationsToggle />);
    const birthdays = (await screen.findByRole('checkbox', { name: /birthdays/ })) as HTMLInputElement;
    const events = screen.getByRole('checkbox', { name: 'Company events' }) as HTMLInputElement;
    expect(birthdays.checked).toBe(true);
    expect(events.checked).toBe(true);
    fireEvent.click(birthdays);
    await waitFor(() => expect(db.saveDigest).toHaveBeenCalledWith({ events: true, birthdays: false }));
    await waitFor(() => expect(birthdays.checked).toBe(false));
    expect(events.checked).toBe(true);
  });
});
