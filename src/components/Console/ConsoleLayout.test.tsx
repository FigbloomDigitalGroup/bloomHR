import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import ConsoleLayout, { type ConsoleNavGroup } from './ConsoleLayout';

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
beforeEach(() => setWidth(1280));

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
    expect(within(aside).getByText('Figbloom console')).toBeTruthy();
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
      { product: 'Figbloom HR', items: [{ label: 'Organisations', path: '/platform/organisations' }] },
    ]);
    const products = screen.getByRole('navigation', { name: 'Console' });
    expect(within(products).queryByText('Figbloom HR')).toBeNull();
    expect(within(products).getByRole('link', { name: 'Organisations' })).toBeTruthy();
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
