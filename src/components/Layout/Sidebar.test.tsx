import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const perms = vi.hoisted(() => ({ granted: null as string[] | null }));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (p: string) => !perms.granted || perms.granted.includes(p),
    hasAnyPermission: (ps: string[]) => !perms.granted || ps.some((p) => perms.granted!.includes(p)),
    loading: false,
  }),
}));
// the new-mail count (its asking is tested in useMailboxUnread.test.tsx): what the sidebar was given, and the count
const mail = vi.hoisted(() => ({ unread: 0, calls: [] as [boolean, string | undefined][] }));
vi.mock('../../hooks/useMailboxUnread', () => ({
  useMailboxUnread: (enabled: boolean, who: string | undefined) => {
    mail.calls.push([enabled, who]);
    return enabled ? mail.unread : 0;
  },
}));
// money waiting on the person (its counting is tested in useMoneyBadges.test.ts)
const money = vi.hoisted(() => ({ badges: {} as Record<string, number>, calls: [] as [string | undefined, boolean][] }));
vi.mock('../../hooks/useMoneyBadges', () => ({
  useMoneyBadges: (who: string | undefined, paysOut: boolean) => {
    money.calls.push([who, paysOut]);
    return money.badges;
  },
}));
const work = vi.hoisted(() => ({ badges: {} as Record<string, number>, calls: [] as Record<string, boolean>[] }));
vi.mock('../../hooks/useWorkBadges', () => ({
  useWorkBadges: (_who: string | undefined, access: Record<string, boolean>) => {
    work.calls.push(access);
    return work.badges;
  },
}));
vi.mock('../../hooks/useMyPreferences', () => ({
  useMyPreferences: () => ({ data: null }),
}));
vi.mock('../../lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'ilike', 'is', 'in']) chain[m] = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: [], count: 0, error: null });
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { from: () => chain, channel: () => channel, removeChannel: () => {} } };
});

import Sidebar from './Sidebar';
import { useMobileNav } from './useMobileNav';

const setWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.matchMedia = ((query: string) => ({
    matches: width < 768,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
};

// what App does: the header's menu button opens the drawer, the sidebar closes it
function Shell() {
  const nav = useMobileNav();
  const { pathname } = useLocation();
  return (
    <>
      <button type="button" aria-label="Open menu" aria-expanded={nav.open} onClick={nav.openNav} />
      <span data-testid="path">{pathname}</span>
      <Sidebar
        user={{ email: 'admin@co.com', role: 'ADMIN' }}
        isCollapsed={false}
        onToggle={() => {}}
        isMobile={nav.isMobile}
        mobileOpen={nav.open}
        onMobileClose={nav.closeNav}
      />
    </>
  );
}

const renderShell = () =>
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Shell />
    </MemoryRouter>,
  );

const drawer = () => document.getElementById('app-sidebar') as HTMLElement;
const isOpen = () => !drawer().className.includes('max-md:-translate-x-full');

beforeEach(() => setWidth(375));
afterEach(() => cleanup());

describe('admin sidebar on a phone', () => {
  it('starts closed and opens from the menu button', () => {
    renderShell();
    expect(isOpen()).toBe(false);
    expect(screen.queryByTestId('sidebar-backdrop')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(isOpen()).toBe(true);
    expect(screen.getByTestId('sidebar-backdrop')).toBeTruthy();
    expect(drawer().getAttribute('aria-modal')).toBe('true');
    // the close button takes focus so keyboard users land inside the drawer
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close menu');
  });

  it('closes on a backdrop tap', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByTestId('sidebar-backdrop'));
    expect(isOpen()).toBe(false);
  });

  it('closes on Escape', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(isOpen()).toBe(false);
  });

  it('closes from its own close button', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(isOpen()).toBe(false);
  });

  it('closes after navigating to a page', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByText('Employees'));
    expect(screen.getByTestId('path').textContent).toBe('/employees');
    expect(isOpen()).toBe(false);
  });

  it('shows the full menu with labels even when the desktop sidebar is collapsed', () => {
    render(
      <MemoryRouter>
        <Sidebar user={{ email: 'a@co.com', role: 'ADMIN' }} isCollapsed onToggle={() => {}} isMobile mobileOpen onMobileClose={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Payroll')).toBeTruthy();
  });
});

describe('admin sidebar on a desktop', () => {
  it('keeps the collapse toggle and has no backdrop', () => {
    setWidth(1280);
    const onToggle = vi.fn();
    render(
      <MemoryRouter>
        <Sidebar user={{ email: 'a@co.com', role: 'ADMIN' }} isCollapsed={false} onToggle={onToggle} />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('sidebar-backdrop')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});

describe('Job groups in the menu', () => {
  const sidebar = () =>
    render(
      <MemoryRouter>
        <Sidebar user={{ email: 'a@co.com', role: 'HR' }} isCollapsed={false} onToggle={() => {}} />
      </MemoryRouter>,
    );
  afterEach(() => {
    perms.granted = null;
  });

  it('shows for Payroll or Employees users, who can’t open Settings', () => {
    setWidth(1280);
    perms.granted = ['payroll'];
    sidebar();
    expect(screen.getByText('Job groups')).toBeTruthy();
    expect(screen.queryByText('Settings')).toBeNull();
    cleanup();
    perms.granted = ['employees'];
    sidebar();
    expect(screen.getByText('Job groups')).toBeTruthy();
  });

  it('is hidden from anyone else', () => {
    setWidth(1280);
    perms.granted = ['dashboard', 'leaves'];
    sidebar();
    expect(screen.queryByText('Job groups')).toBeNull();
  });
});

describe('new mail on Email Portal', () => {
  const sidebar = (collapsed = false) =>
    render(
      <MemoryRouter>
        <Sidebar user={{ email: 'mary@co.com', role: 'HR' }} isCollapsed={collapsed} onToggle={() => {}} />
      </MemoryRouter>,
    );
  const portal = () => screen.getByText('Email Portal').closest('button') as HTMLElement;
  beforeEach(() => {
    setWidth(1280);
    mail.unread = 0;
    mail.calls = [];
  });
  afterEach(() => {
    perms.granted = null;
  });

  it('shows the unread count (99+ past 99) for people with the My mailbox module', () => {
    perms.granted = ['mailbox'];
    mail.unread = 7;
    sidebar();
    expect(portal().textContent).toBe('Email Portal7');
    expect(within(portal()).getByTitle('7 unread')).toBeTruthy();
    expect(mail.calls.at(-1)).toEqual([true, 'mary@co.com']);
    cleanup();
    mail.unread = 120;
    sidebar();
    expect(portal().textContent).toBe('Email Portal99+');
  });

  it('hides at 0', () => {
    perms.granted = ['mailbox'];
    sidebar();
    expect(portal().textContent).toBe('Email Portal');
  });

  it('a dot on the collapsed sidebar', () => {
    perms.granted = ['mailbox'];
    mail.unread = 2;
    sidebar(true);
    const icon = document.querySelector('[aria-label="2 unread"]');
    expect(icon).toBeTruthy();
  });

  it('is not asked for without the module (sending only)', () => {
    perms.granted = ['email-portal'];
    mail.unread = 7;
    sidebar();
    expect(portal().textContent).toBe('Email Portal');
    expect(mail.calls.every(([enabled]) => enabled === false)).toBe(true);
  });
});

describe('money waiting on the person', () => {
  const sidebar = () =>
    render(
      <MemoryRouter>
        <Sidebar user={{ email: 'ops@co.com', role: 'HR' }} isCollapsed={false} onToggle={() => {}} />
      </MemoryRouter>,
    );
  const item = (label: string) => screen.getByText(label).closest('button') as HTMLElement;
  beforeEach(() => {
    setWidth(1280);
    money.badges = {};
    money.calls = [];
  });
  afterEach(() => {
    perms.granted = null;
  });

  it('counts advances, loans and payments on their items', () => {
    perms.granted = ['salaryadmin', 'loans', 'payments'];
    money.badges = { advanced: 1, loans: 2, payments: 3 };
    sidebar();
    expect(item('Salary Advance').textContent).toBe('Salary Advance1');
    expect(within(item('Salary Advance')).getByTitle('1 pending')).toBeTruthy();
    expect(item('Loans').textContent).toBe('Loans2');
    expect(within(item('Payments to make')).getByTitle('3 to pay or approve')).toBeTruthy();
    expect(money.calls.at(-1)).toEqual(['ops@co.com', true]);
  });

  it('nothing at 0, and payments to make are counted only for finance', () => {
    perms.granted = ['salaryadmin'];
    sidebar();
    expect(item('Salary Advance').textContent).toBe('Salary Advance');
    expect(money.calls.every(([, paysOut]) => paysOut === false)).toBe(true);
  });
});

describe('HR requests waiting on the person', () => {
  const sidebar = () =>
    render(
      <MemoryRouter>
        <Sidebar user={{ email: 'hr@co.com', role: 'HR' }} isCollapsed={false} onToggle={() => {}} />
      </MemoryRouter>,
    );
  const item = (label: string) => screen.getByText(label).closest('button') as HTMLElement;
  beforeEach(() => {
    setWidth(1280);
    work.badges = {};
    work.calls = [];
  });
  afterEach(() => {
    perms.granted = null;
  });

  it('counts missed scans, exits, onboarding reviews and overtime on their items', () => {
    perms.granted = ['employees', 'hr-lifecycle', 'approve-exits', 'payroll'];
    work.badges = { attendance: 2, 'hr-lifecycle': 1, onboarding: 3, overtime: 4 };
    sidebar();
    expect(item('Attendance').textContent).toBe('Attendance2');
    expect(item('HR Lifecycle').textContent).toBe('HR Lifecycle1');
    expect(item('Onboarding').textContent).toBe('Onboarding3');
    expect(item('Overtime').textContent).toBe('Overtime4');
    expect(work.calls.at(-1)).toEqual({ attendance: true, exits: true, onboarding: true, overtime: true, signups: false });
  });

  it('asks only for what the person may decide', () => {
    perms.granted = ['team-work'];
    sidebar();
    expect(work.calls.at(-1)).toEqual({ attendance: true, exits: false, onboarding: false, overtime: true, signups: false });
  });
});
