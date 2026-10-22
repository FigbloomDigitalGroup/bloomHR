import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const signOut = vi.hoisted(() => vi.fn(() => Promise.resolve({ error: null })));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: null } }), signOut },
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: () => {}, error: () => {} } }));

import StaffMobileHeader from './StaffMobileHeader';

const setup = (overrides: Partial<Parameters<typeof StaffMobileHeader>[0]> = {}) => {
  const props = {
    userName: 'jane',
    hasUnread: false,
    onOpenNotifications: vi.fn(),
    onOpenMenu: vi.fn(),
    onPasswordReset: vi.fn(),
    setActiveTab: vi.fn(),
    ...overrides,
  };
  render(
    <MemoryRouter>
      <StaffMobileHeader {...props} />
    </MemoryRouter>,
  );
  return props;
};

afterEach(() => cleanup());

describe('staff portal phone header', () => {
  it('has the notifications bell, which opens the notifications panel', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(props.onOpenNotifications).toHaveBeenCalledTimes(1);
  });

  it('marks unread notifications on the bell', () => {
    setup({ hasUnread: true });
    expect(screen.getByTestId('unread-dot')).toBeTruthy();
  });

  it('has an account menu with profile, password reset and sign out', async () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    fireEvent.click(screen.getByText('Reset Password'));
    expect(props.onPasswordReset).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    fireEvent.click(screen.getByText('My Profile'));
    expect(props.setActiveTab).toHaveBeenCalledWith('details');

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    fireEvent.click(screen.getByText('Sign out'));
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it('opens the navigation menu', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(props.onOpenMenu).toHaveBeenCalledTimes(1);
  });

  it('only shows below md', () => {
    setup();
    const header = screen.getByRole('button', { name: 'Notifications' }).closest('.sticky') as HTMLElement;
    expect(header.className).toContain('md:hidden');
  });
});
