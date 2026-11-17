import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Which app an address gets: the console's own addresses get the console, every other one the company app as before.

const state = vi.hoisted(() => ({ console: false }));
vi.mock('./lib/console', () => ({ isConsoleHost: () => state.console }));
vi.mock('./lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn(),
    },
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    from: vi.fn(),
  },
}));
vi.mock('./hooks/useCompanyProfile', () => ({
  useCompanyProfile: () => ({ status: 'loading' }),
  withProfileRole: (user: unknown) => user,
  landingTarget: () => null,
}));
vi.mock('./hooks/useMyCompanies', () => ({ useCompanySwitching: () => false }));
vi.mock('./components/Layout/useMobileNav', () => ({
  useMobileNav: () => ({ isMobile: false, open: false, openNav: vi.fn(), closeNav: vi.fn() }),
}));
vi.mock('./components/ProtectedRoutes/UserContext', () => ({ UserProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('./lib/preferences', () => ({ syncThemeWithAccount: vi.fn() }));
vi.mock('./lib/mfaApi', () => ({ loadStaySignedIn: () => Promise.resolve(null) }));
vi.mock('./pages/Login', () => ({ default: () => <p>Company app sign-in</p> }));
vi.mock('./components/Console/ConsoleApp', () => ({ default: () => <p>The Figbloom console</p> }));

import App from './App';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );

afterEach(cleanup);
beforeEach(() => {
  state.console = false;
});

describe('the app an address opens', () => {
  it('a normal address gets the company app, unchanged', async () => {
    renderAt('/platform/organisations');
    expect(await screen.findByText('Company app sign-in')).toBeTruthy();
    expect(screen.queryByText('The Figbloom console')).toBeNull();
  });

  it('a console address gets the console only', async () => {
    state.console = true;
    renderAt('/dashboard');
    expect(await screen.findByText('The Figbloom console')).toBeTruthy();
    expect(screen.queryByText('Company app sign-in')).toBeNull();
  });
});
