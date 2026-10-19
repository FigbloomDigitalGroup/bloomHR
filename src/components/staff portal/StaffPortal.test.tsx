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

import StaffPortal from './StaffPortal';

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <StaffPortal />
    </MemoryRouter>,
  );

// framer-motion measures the page; jsdom has no scrolling
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

afterEach(() => cleanup());

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
