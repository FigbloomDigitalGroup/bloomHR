import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// a database that has nothing: every query resolves empty
vi.mock('../../lib/supabase', () => {
  const empty = { data: null, error: null };
  const query: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_t, prop) => (prop === 'then' ? (resolve: (v: unknown) => void) => resolve(empty) : () => query),
    },
  );
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
      from: () => query,
      rpc: () => Promise.resolve({ data: [], error: null }),
      channel: () => channel,
      removeChannel: () => undefined,
    },
  };
});
vi.mock('../chat/lib/presence', () => ({ useOnlinePeople: () => undefined }));
vi.mock('../../hooks/useHRNotifications', () => ({ fetchStaffHRNotifications: () => Promise.resolve([]), markStaffNotificationRead: () => undefined }));
vi.mock('../../lib/companyProfile', () => ({ loadCompanyIdentity: () => Promise.resolve(null) }));
vi.mock('../../lib/myTeamApi', () => ({ loadMyTeam: () => Promise.resolve([]) }));
vi.mock('../PieceRate/staff/useMyWorkProfile', () => ({ useMyWorkProfile: () => null }));

// the sections themselves are tested on their own
vi.mock('./MyResignation', () => ({ default: () => <div>MyResignation page</div> }));
vi.mock('./Profile', () => ({ default: () => <div>Profile page</div> }));
vi.mock('./StaffHome', () => ({ default: () => <div>Home page</div> }));
vi.mock('../chat/ChatLayout', () => ({ ChatLayout: () => null }));
vi.mock('./UserProfile', () => ({ default: () => null }));
vi.mock('./StaffMobileHeader', () => ({ default: () => null }));
vi.mock('./EmailNotificationsToggle', () => ({ default: () => null }));
vi.mock('./PasswordRestModal', () => ({ default: () => null }));
vi.mock('../Email/Mailbox/MyMailbox', () => ({ default: () => <div>Mailbox page</div> }));

// the role's modules, and the mailbox's new-mail count
const perms = vi.hoisted(() => ({ list: [] as string[], unread: 0 }));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ loading: false, hasAnyPermission: (ps: string[]) => ps.some((p) => perms.list.includes(p)) }),
}));
vi.mock('../../hooks/useMailboxUnread', () => ({ useMailboxUnread: (enabled: boolean) => (enabled ? perms.unread : 0) }));

import StaffPortal from './StaffPortal';

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <StaffPortal />
    </MemoryRouter>,
  );

// framer-motion measures the page; jsdom has no scrolling
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

afterEach(() => {
  cleanup();
  perms.list = [];
  perms.unread = 0;
});

describe('StaffPortal and resignation', () => {
  it('no longer lists Resignation in the menu; Profile is there', async () => {
    renderAt('/staff');
    expect(await screen.findByText('Home page')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Profile/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Resignation/i })).toBeNull();
  });

  it('still opens the Resignation section from the address (?tab=resignation)', async () => {
    renderAt('/staff?tab=resignation');
    expect(await screen.findByText('MyResignation page')).toBeTruthy();
  });

  it('searching the menu for "resign" finds Profile', async () => {
    renderAt('/staff');
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'resign' } });
    const buttons = screen.getAllByRole('button').map((b) => b.textContent?.trim());
    expect(buttons).toContain('Profile');
    expect(buttons).not.toContain('Payslips');
  });
});

describe('Mail in the staff portal', () => {
  it('is under Communication, with its new-mail count, for a role with My mailbox', async () => {
    perms.list = ['mailbox'];
    perms.unread = 3;
    renderAt('/staff');
    await screen.findByText('Home page');
    // Communication's badge counts the new mail
    fireEvent.click(screen.getByRole('button', { name: /Communication\s*3/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Mail/ }));
    expect(await screen.findByText('Mailbox page')).toBeTruthy();
    expect(screen.getByLabelText('3 unread')).toBeTruthy();
  });

  it('is not there without My mailbox, not even from the address', async () => {
    renderAt('/staff?tab=mail');
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'mail' } });
    expect(screen.queryByRole('button', { name: /^Mail/ })).toBeNull();
    expect(screen.queryByText('Mailbox page')).toBeNull();
  });

  it('the menu search finds it by "email" or "inbox"', async () => {
    perms.list = ['mailbox'];
    renderAt('/staff');
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'inbox' } });
    expect(screen.getAllByRole('button').map((b) => b.textContent?.trim())).toContain('Communication');
  });
});
