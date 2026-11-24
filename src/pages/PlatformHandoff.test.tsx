import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ verifyOtp: vi.fn(), getSession: vi.fn(), assign: vi.fn() }));

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      verifyOtp: (...a: unknown[]) => api.verifyOtp(...a),
      getSession: (...a: unknown[]) => api.getSession(...a),
    },
  },
}));

import PlatformHandoff from './PlatformHandoff';
import { ARRIVING_KEY } from '../lib/arriving';

const realLocation = window.location;
const TOKEN = 'a'.repeat(32);

function openAt(search: string, hash: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, pathname: '/handoff', search, hash, assign: api.assign },
  });
  return render(<PlatformHandoff />);
}

beforeEach(() => {
  sessionStorage.clear();
  api.verifyOtp.mockReset();
  api.getSession.mockReset();
  api.assign.mockReset();
  document.title = 'Figbloom HR';
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

describe('PlatformHandoff', () => {
  it('while signing in, is the one full-screen "Opening Figbloom HR" screen: opaque, no fade-in, no sign-in page around it', async () => {
    api.verifyOtp.mockReturnValue(new Promise(() => {}));
    const { container } = openAt('', `#token_hash=${TOKEN}&next=/leave`);
    const status = screen.getByRole('status', { name: 'Opening Figbloom HR' });
    expect(status.textContent).toMatch(/^Opening Figbloom HR\.\.\.$/);
    expect(status.className).not.toMatch(/fb-loader--fade-in/);
    const cover = container.firstChild as HTMLElement;
    expect(cover.className).toMatch(/fixed inset-0/);
    expect(cover.className).toMatch(/(^|\s)bg-page(\s|$)/);
    expect(screen.queryByRole('heading')).toBeNull(); // not the sign-in page (AuthShell) around it
    expect(document.title).toBe('Opening Figbloom HR');
  });

  it('marks the tab as arriving just before it opens the next page', async () => {
    api.verifyOtp.mockImplementation(() => {
      expect(sessionStorage.getItem(ARRIVING_KEY)).toBeNull();
      return Promise.resolve({ error: null });
    });
    openAt('', `#token_hash=${TOKEN}&next=/leave`);
    await waitFor(() => expect(api.assign).toHaveBeenCalledWith('/leave'));
    expect(sessionStorage.getItem(ARRIVING_KEY)).toBe('1');
  });

  it('connect: the same screen, then HR sign-in (or the app when signed in), marked as arriving', async () => {
    api.getSession.mockResolvedValue({ data: { session: null } });
    openAt('', `#connect=${TOKEN}`);
    expect(screen.getByRole('status', { name: 'Opening Figbloom HR' })).toBeTruthy();
    await waitFor(() => expect(api.assign).toHaveBeenCalledWith('/login'));
    expect(sessionStorage.getItem(ARRIVING_KEY)).toBe('1');
    cleanup();
    sessionStorage.clear();
    api.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    openAt('', `#connect=${TOKEN}`);
    await waitFor(() => expect(api.assign).toHaveBeenCalledWith('/'));
    expect(sessionStorage.getItem(ARRIVING_KEY)).toBe('1');
  });

  it('a failed sign-in shows the message page and does not mark the tab', async () => {
    api.verifyOtp.mockResolvedValue({ error: new Error('expired') });
    openAt('', `#token_hash=${TOKEN}&next=/leave`);
    expect(await screen.findByText('Go to Figbloom HR sign-in')).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Opening Figbloom HR' })).toBeNull();
    expect(api.assign).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(ARRIVING_KEY)).toBeNull();
  });

  it('a status page keeps the sign-in page layout with its message', () => {
    openAt('?status=off&from=fleet', '');
    expect(screen.getByText('Go to Figbloom HR sign-in')).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Opening Figbloom HR' })).toBeNull();
    expect(document.title).toBe('Figbloom HR');
  });
});
