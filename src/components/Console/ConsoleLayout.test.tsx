import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import { Building2, Briefcase } from 'lucide-react';
import ConsoleLayout, { COLLAPSED_KEY, SECTIONS_KEY, type ConsoleNavGroup } from './ConsoleLayout';

// jsdom has no matchMedia: the sidebar asks it (useMobileNav) whether this is a phone
const setWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.matchMedia = ((query: string) => ({
    matches: width < 768,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
};

afterEach(cleanup);
beforeEach(() => {
  window.localStorage.clear();
  setWidth(1280);
});

const Where = () => <p data-testid="path">{useLocation().pathname}</p>;
const signOut = vi.fn();

const renderLayout = (path = '/platform/schools', nav?: ConsoleNavGroup[]) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ConsoleLayout email="ops@figbloom.org" role="owner" onSignOut={signOut} nav={nav}>
        <p>page</p>
      </ConsoleLayout>
      <Where />
    </MemoryRouter>
  );

const sidebar = () => screen.getByRole('complementary', { name: 'Console menu' });

describe('the console menu', () => {
  it('groups pages by product and, with two products, names each one', () => {
    renderLayout();
    const products = screen.getByRole('navigation', { name: 'Console' });
    const hr = within(products).getByRole('group', { name: 'Figbloom HR' });
    const schools = within(products).getByRole('group', { name: 'Figbloom Schools' });
    expect(within(products).getByText('Figbloom HR')).toBeTruthy();
    expect(within(products).getByText('Figbloom Schools')).toBeTruthy();
    expect(within(hr).getByRole('link', { name: 'Organisations' }).getAttribute('href')).toBe('/platform/organisations');
    expect(within(hr).getByRole('link', { name: 'Statutory rates' }).getAttribute('href')).toBe('/platform/rates');
    expect(within(schools).getAllByRole('link').map((a) => a.textContent)).toEqual(['Schools']);
    expect(within(schools).getByRole('link', { name: 'Schools' }).getAttribute('href')).toBe('/platform/schools');
    // Staff is Figbloom's own, apart from the products
    expect(within(products).queryByRole('link', { name: 'Staff' })).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Figbloom' })).getByRole('link', { name: 'Staff' })).toBeTruthy();
  });

  it('is a left sidebar with the console\'s name at the top, and the page beside it', () => {
    renderLayout();
    const aside = sidebar();
    expect(aside.getAttribute('data-state')).toBe('docked');
    expect(aside.getAttribute('role')).toBeNull();
    // as Figbloom Schools' console: the mark, "Figbloom" and PLATFORM CONSOLE
    const logo = within(aside).getByRole('img', { name: 'Figbloom' });
    // the company app's mark (white on transparent), coloured by the theme's shell-logo rule, with no tile behind it
    expect(logo.getAttribute('src')).toContain('bloom-mark');
    expect(logo.className).toContain('shell-logo');
    expect((logo.parentElement as HTMLElement).className).not.toMatch(/bg-white/);
    expect(within(aside).getByText('Figbloom')).toBeTruthy();
    expect(within(aside).getByText('PLATFORM CONSOLE')).toBeTruthy();
    expect(within(screen.getByRole('main')).getByText('page')).toBeTruthy();
    expect(aside.contains(screen.getByRole('main'))).toBe(false);
  });

  it('marks the page you are on', () => {
    renderLayout('/platform/rates');
    expect(screen.getByRole('link', { name: 'Statutory rates' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Organisations' }).getAttribute('aria-current')).toBeNull();
    cleanup();
    renderLayout('/platform/staff');
    expect(screen.getByRole('link', { name: 'Staff' }).getAttribute('aria-current')).toBe('page');
  });

  it('keeps Staff, then who is signed in and Sign out, at the bottom', () => {
    renderLayout();
    const aside = sidebar();
    const staff = within(aside).getByRole('navigation', { name: 'Figbloom' });
    const account = within(aside).getByRole('group', { name: 'Signed in' });
    const products = within(aside).getByRole('navigation', { name: 'Console' });
    // document order: products, then Staff, then the account block
    expect(products.compareDocumentPosition(staff) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(staff.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(account).getByText('ops@figbloom.org')).toBeTruthy();
    expect(within(account).getByTitle('Your console role').textContent).toBe('Owner');
    fireEvent.click(within(account).getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalled();
  });

  it('hides the product label when there is only one product', () => {
    renderLayout('/platform/organisations', [
      { product: 'Figbloom HR', icon: Briefcase, items: [{ label: 'Organisations', path: '/platform/organisations', icon: Building2 }] },
    ]);
    const products = screen.getByRole('navigation', { name: 'Console' });
    expect(within(products).queryByText('Figbloom HR')).toBeNull();
    expect(within(products).getByRole('link', { name: 'Organisations' })).toBeTruthy();
    // nothing to fold either
    expect(within(products).queryByRole('button')).toBeNull();
  });

  it('starts with the Overview, above the products', () => {
    renderLayout('/platform/overview');
    const links = within(screen.getByRole('navigation', { name: 'Console' })).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(['Overview', 'Organisations', 'Statutory rates', 'Schools']);
    expect(links[0].getAttribute('href')).toBe('/platform/overview');
    expect(links[0].getAttribute('aria-current')).toBe('page');
  });

  it('uses no orange and no coloured tiles: theme tokens only', () => {
    render(
      <MemoryRouter initialEntries={['/platform/overview']}>
        <ConsoleLayout email="ops@figbloom.org" role="owner" onSignOut={signOut} badges={{ '/platform/schools': { count: 2, label: '2 need attention' } }}>
          <p>page</p>
        </ConsoleLayout>
      </MemoryRouter>
    );
    expect(sidebar().innerHTML).not.toMatch(/orange/);
    for (const product of ['Figbloom HR', 'Figbloom Schools']) {
      const icon = screen.getByRole('button', { name: product }).querySelector('svg') as SVGElement;
      expect(icon.getAttribute('class')).toContain('text-shell-fg');
      expect(icon.parentElement?.tagName).toBe('BUTTON');
    }
  });

  it('gives every page an icon, and every product a mark', () => {
    renderLayout();
    for (const link of within(sidebar()).getAllByRole('link')) expect(link.querySelector('svg')).not.toBeNull();
    for (const product of ['Figbloom HR', 'Figbloom Schools']) {
      expect(screen.getByRole('button', { name: product }).querySelector('svg')).not.toBeNull();
    }
  });

  it('folds a product section, and remembers it in this browser', () => {
    renderLayout();
    const hr = screen.getByRole('button', { name: 'Figbloom HR' });
    expect(hr.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(hr);
    expect(hr.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'Organisations' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Schools' })).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(SECTIONS_KEY) ?? '{}')).toEqual({ 'Figbloom HR': true });
    cleanup();
    renderLayout();
    expect(screen.getByRole('button', { name: 'Figbloom HR' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'Organisations' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Figbloom HR' }));
    expect(screen.getByRole('link', { name: 'Organisations' })).toBeTruthy();
  });

  it('folds down to icons with names as tooltips, and remembers it', () => {
    renderLayout('/platform/rates');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(sidebar().getAttribute('data-state')).toBe('collapsed');
    expect(window.localStorage.getItem(COLLAPSED_KEY)).toBe('true');
    const rates = screen.getByRole('link', { name: 'Statutory rates' });
    expect(rates.getAttribute('title')).toBe('Statutory rates');
    // the name stays for screen readers, visually hidden
    expect(within(rates).getByText('Statutory rates').className).toContain('sr-only');
    expect(rates.getAttribute('aria-current')).toBe('page');
    // the account folds to its avatar and a Sign out icon, still named
    expect(screen.getByRole('button', { name: 'Sign out' }).getAttribute('title')).toBe('Sign out');
    cleanup();
    renderLayout();
    expect(sidebar().getAttribute('data-state')).toBe('collapsed');
    const expand = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(expand.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(expand);
    expect(sidebar().getAttribute('data-state')).toBe('docked');
    expect(window.localStorage.getItem(COLLAPSED_KEY)).toBe('false');
  });

  it('still works when the browser blocks storage', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      renderLayout();
      fireEvent.click(screen.getByRole('button', { name: 'Figbloom HR' }));
      fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
      expect(sidebar().getAttribute('data-state')).toBe('collapsed');
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it('shows count badges, with what they count for screen readers', () => {
    render(
      <MemoryRouter initialEntries={['/platform/overview']}>
        <ConsoleLayout email="ops@figbloom.org" role="owner" onSignOut={signOut}
          badges={{ '/platform/organisations': { count: 3, label: '3 waiting for approval' }, '/platform/schools': undefined }}>
          <p>page</p>
        </ConsoleLayout>
      </MemoryRouter>
    );
    const orgs = screen.getByRole('link', { name: 'Organisations (3 waiting for approval)' });
    const count = within(orgs).getByText('3');
    expect(count.getAttribute('aria-hidden')).toBe('true');
    expect(count.className).toContain('bg-shell-fg/15');
    expect(screen.getByRole('link', { name: 'Schools' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('link', { name: 'Organisations (3 waiting for approval)' }).getAttribute('title')).toBe('Organisations (3 waiting for approval)');
  });

  it('shows the account as a card: initials, email, role and Sign out', () => {
    renderLayout();
    const account = screen.getByRole('group', { name: 'Signed in' });
    expect(within(account).getByText('OP')).toBeTruthy();
    expect(within(account).getByText('ops@figbloom.org')).toBeTruthy();
    expect(within(account).getByText('Owner')).toBeTruthy();
    expect(within(account).getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});

describe('the console menu on a phone', () => {
  beforeEach(() => setWidth(500));

  const menuButton = () => screen.getByRole('button', { name: 'Open menu' });

  it('sits behind a menu button in a slim top bar', async () => {
    renderLayout();
    const button = menuButton();
    expect(within(screen.getByRole('banner')).getByText('Figbloom console')).toBeTruthy();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe('console-sidebar');
    await waitFor(() => expect(document.getElementById('console-sidebar')?.getAttribute('data-state')).toBe('closed'));
  });

  it('never folds to icons in the drawer, even when folded on the desktop', async () => {
    window.localStorage.setItem(COLLAPSED_KEY, 'true');
    renderLayout();
    fireEvent.click(menuButton());
    const drawer = await screen.findByRole('dialog', { name: 'Console menu' });
    expect(within(drawer).getByRole('link', { name: 'Schools' }).textContent).toBe('Schools');
    expect(within(drawer).queryByRole('button', { name: 'Collapse sidebar' })).toBeNull();
  });

  it('opens as a drawer, takes focus, and Escape closes it, giving focus back', async () => {
    renderLayout();
    fireEvent.click(menuButton());
    const drawer = await screen.findByRole('dialog', { name: 'Console menu' });
    expect(drawer.getAttribute('aria-modal')).toBe('true');
    expect(drawer.getAttribute('data-state')).toBe('open');
    expect(menuButton().getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close menu' })));
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await waitFor(() => expect(menuButton().getAttribute('aria-expanded')).toBe('false'));
    expect(document.activeElement).toBe(menuButton());
  });

  it('closes on a click outside, and with its close button', async () => {
    renderLayout();
    fireEvent.click(menuButton());
    fireEvent.click(await screen.findByTestId('console-sidebar-backdrop'));
    await waitFor(() => expect(menuButton().getAttribute('aria-expanded')).toBe('false'));
    expect(screen.queryByTestId('console-sidebar-backdrop')).toBeNull();
    fireEvent.click(menuButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Close menu' }));
    await waitFor(() => expect(menuButton().getAttribute('aria-expanded')).toBe('false'));
  });

  it('closes once you pick a page', async () => {
    renderLayout('/platform/organisations');
    fireEvent.click(menuButton());
    const drawer = await screen.findByRole('dialog', { name: 'Console menu' });
    fireEvent.click(within(drawer).getByRole('link', { name: 'Staff' }));
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/platform/staff'));
    await waitFor(() => expect(menuButton().getAttribute('aria-expanded')).toBe('false'));
    expect(document.getElementById('console-sidebar')?.getAttribute('data-state')).toBe('closed');
  });
});
