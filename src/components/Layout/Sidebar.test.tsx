import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const perms = vi.hoisted(() => ({ granted: null as string[] | null }));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (p: string) => !perms.granted || perms.granted.includes(p),
    hasAnyPermission: (ps: string[]) => !perms.granted || ps.some((p) => perms.granted!.includes(p)),
    loading: false,
  }),
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
