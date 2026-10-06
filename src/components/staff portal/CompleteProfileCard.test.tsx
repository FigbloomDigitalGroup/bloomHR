import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const db = vi.hoisted(() => ({
  user: { email: 'jane@co.com' } as { email: string } | null,
  employee: null as Record<string, unknown> | null,
  emergencyCount: 0,
  emergencyError: null as unknown,
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: db.user } }) },
    from: (table: string) => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => (table === 'employees' ? b : Promise.resolve({ count: db.emergencyCount, error: db.emergencyError })),
        maybeSingle: () => Promise.resolve({ data: db.employee, error: null }),
      };
      return b;
    },
  },
}));

import CompleteProfileCard from './CompleteProfileCard';

const full = {
  'Employee Number': 'E1',
  'Profile Image': 'x',
  'Mobile Number': '0712345678',
  'Personal Email': 'a@b.co',
  'Date of Birth': '1990-01-01',
  'ID Number': 123456,
  'Tax PIN': 'A1',
  payment_method: 'Mpesa',
};

beforeEach(() => {
  db.user = { email: 'jane@co.com' };
  db.employee = { 'Employee Number': 'E1', 'First Name': 'Jane' };
  db.emergencyCount = 0;
  db.emergencyError = null;
});
afterEach(() => cleanup());

describe('CompleteProfileCard', () => {
  it('lists what a new employee still has to add, with progress', async () => {
    render(<CompleteProfileCard onOpen={() => {}} />);
    expect(await screen.findByText('Complete your profile')).toBeTruthy();
    expect(screen.getByText('Profile picture')).toBeTruthy();
    expect(screen.getByText('Mobile number')).toBeTruthy();
    expect(screen.getByText('Emergency contact')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });

  it('opens Bio Data from the button', async () => {
    const onOpen = vi.fn();
    render(<CompleteProfileCard onOpen={onOpen} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Bio Data' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('shows only what is missing, and updates the count', async () => {
    db.employee = { ...full, 'Mobile Number': '', 'Profile Image': null };
    db.emergencyCount = 1;
    render(<CompleteProfileCard onOpen={() => {}} />);
    expect(await screen.findByText('Profile picture')).toBeTruthy();
    expect(screen.getByText('Mobile number')).toBeTruthy();
    expect(screen.queryByText('Personal email')).toBeNull();
    expect(screen.queryByText('Emergency contact')).toBeNull();
    expect(screen.getByText(/6 of 8 done/)).toBeTruthy();
  });

  it('disappears when everything is filled in', async () => {
    db.employee = full;
    db.emergencyCount = 1;
    render(<CompleteProfileCard onOpen={() => {}} />);
    await waitFor(() => expect(screen.queryByText('Complete your profile')).toBeNull());
  });

  it('is not shown for a login with no employee record (the portal explains that itself)', async () => {
    db.employee = null;
    render(<CompleteProfileCard onOpen={() => {}} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText('Complete your profile')).toBeNull();
  });

  it('does not call the emergency contact missing when it could not be checked', async () => {
    db.emergencyError = { message: 'denied' };
    render(<CompleteProfileCard onOpen={() => {}} />);
    await screen.findByText('Complete your profile');
    expect(screen.queryByText('Emergency contact')).toBeNull();
  });
});
