import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../lib/supabase', () => {
  // any query resolves to an empty result; realtime channels do nothing
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'neq', 'ilike', 'is', 'in', 'order', 'limit', 'gte', 'lte']) chain[m] = () => chain;
  chain.single = () => Promise.resolve({ data: null, error: null });
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: [], count: 0, error: null });
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      from: () => chain,
      channel: () => channel,
      removeChannel: () => {},
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    },
  };
});
vi.mock('../../hooks/useHRNotifications', () => ({
  useHRNotifications: () => ({ checkAndNotify: () => {} }),
  fetchAdminHRNotifications: () => Promise.resolve([]),
  markAdminNotificationRead: () => Promise.resolve(),
}));
const noCompanies = vi.hoisted(() => ({ data: [] as { is_current: boolean; name: string }[] }));
vi.mock('../../hooks/useMyCompanies', () => ({ useMyCompanies: () => noCompanies }));
vi.mock('../chat/lib/presence', () => ({ useOnlinePeople: () => {} }));
vi.mock('../Company/CompanySwitcher', () => ({ default: ({ name }: { name: string }) => <span>{name}</span> }));
vi.mock('../Accessibility/AccessibilityModal', () => ({ AccessibilityButton: () => null }));
vi.mock('../Dashboard/GetStarted', () => ({ OPEN_COMPANY_PROFILE: 'open-profile', COMPANY_PROFILE_SAVED: 'profile-saved' }));

import Header from './Header';

// the notification counts query isn't mocked in full; its failure is caught and logged, which is noise here
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Header menu button', () => {
  it('opens the sidebar drawer and says whether it is open', () => {
    const onOpenMenu = vi.fn();
    render(
      <MemoryRouter>
        <Header onOpenMenu={onOpenMenu} menuOpen={false} />
      </MemoryRouter>,
    );
    const button = screen.getByRole('button', { name: 'Open menu' });
    // only shown below md; desktop keeps the docked sidebar
    expect(button.className).toContain('md:hidden');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe('app-sidebar');
    fireEvent.click(button);
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
  });

  it('has no menu button when there is no drawer to open', () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Open menu' })).toBeNull();
  });

  it('keeps the notifications drawer inside a phone screen', async () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    const heading = await screen.findByText('Notifications', { selector: 'h2' });
    const panel = heading.closest('.fixed') as HTMLElement;
    expect(panel.className).toContain('w-[calc(100vw-2rem)]');
    expect(panel.className).toContain('sm:w-96');
  });
});
