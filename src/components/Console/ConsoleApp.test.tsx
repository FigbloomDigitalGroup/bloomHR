import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

type AuthListener = (event: string, session: unknown) => void;

const state = vi.hoisted(() => ({
  session: null as unknown,
  admin: true,
  mfa: false,
  listeners: [] as ((event: string, session: unknown) => void)[],
  rpc: vi.fn(),
  from: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: state.session } }),
      onAuthStateChange: (listener: AuthListener) => {
        state.listeners.push(listener);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      signOut: (...args: unknown[]) => state.signOut(...args),
    },
    rpc: (...args: unknown[]) => state.rpc(...args),
    // nothing in the console reads a company's tables
    from: (...args: unknown[]) => state.from(...args),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../lib/platformRates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformRates')>()),
  isPlatformAdmin: () => Promise.resolve(state.admin),
  platformRows: () => Promise.resolve([]),
  latestApprovedMonth: () => Promise.resolve(null),
}));
vi.mock('../../lib/platformOrganisations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformOrganisations')>()),
  listOrganisations: () => Promise.resolve([]),
  organisationTotals: () => Promise.resolve(null),
}));
// the sign-in pages have tests of their own
vi.mock('./ConsoleLogin', () => ({ default: () => <p>Sign-in form</p> }));
vi.mock('../../pages/MFAverification', () => ({ default: () => <p>Two-step code form</p> }));
vi.mock('../../pages/UpdatePassword', () => ({ default: () => <p>New password form</p> }));

import ConsoleApp from './ConsoleApp';

const signedIn = (role?: string) => ({ user: { id: 'u1', email: 'ops@figbloom.org', user_metadata: role ? { role } : {} } });

const Where = () => <p data-testid="path">{useLocation().pathname}</p>;
const renderAt = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ConsoleApp />
      <Where />
    </MemoryRouter>
  );

afterEach(cleanup);
beforeEach(() => {
  state.session = null;
  state.admin = true;
  state.mfa = false;
  state.listeners = [];
  state.rpc.mockReset().mockImplementation((name: string) =>
    Promise.resolve(name === 'mfa_required' ? { data: state.mfa, error: null } : { data: null, error: { message: `unexpected ${name}` } })
  );
  state.from.mockReset();
  state.signOut.mockReset().mockResolvedValue({ error: null });
});

describe('the Figbloom console', () => {
  it('asks a signed-out visitor to sign in, whatever the address', async () => {
    renderAt('/platform/rates');
    expect(await screen.findByText('Sign-in form')).toBeTruthy();
    expect(screen.queryByText('Figbloom console')).toBeNull();
  });

  it('keeps the password reset page', async () => {
    renderAt('/update-password');
    expect(await screen.findByText('New password form')).toBeTruthy();
  });

  it('moves on once someone signs in', async () => {
    renderAt('/login');
    await screen.findByText('Sign-in form');
    state.session = signedIn();
    act(() => state.listeners.forEach((l) => l('SIGNED_IN', state.session)));
    expect(await screen.findByText('Figbloom console')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/platform/organisations'));
  });

  it('tells someone who is not a platform admin, by name, and lets them sign out', async () => {
    state.session = signedIn('ADMIN');
    state.admin = false;
    renderAt('/platform/organisations');
    expect(await screen.findByText('No console access')).toBeTruthy();
    expect(screen.getByText('ops@figbloom.org')).toBeTruthy();
    expect(screen.queryByText('Organisations')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(state.signOut).toHaveBeenCalledWith({ scope: 'local' }));
  });

  it('opens Organisations for a platform admin in no company', async () => {
    state.session = signedIn();
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Organisations' })).toBeTruthy();
    expect(screen.getByTestId('path').textContent).toBe('/platform/organisations');
    expect(screen.getByText('ops@figbloom.org')).toBeTruthy();
    expect(document.title).toBe('Figbloom console');
    // one product so far: its name isn't shown as if it were the console's
    expect(screen.queryByText('Figbloom HR')).toBeNull();
    expect(state.from).not.toHaveBeenCalled();
  });

  it('opens the platform pages for a platform admin who is staff in their company', async () => {
    state.session = signedIn('STAFF');
    renderAt('/platform/rates');
    expect(await screen.findByRole('heading', { name: 'Statutory rates' })).toBeTruthy();
    expect(screen.queryByText(/staff portal/i)).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Organisations' }));
    expect(await screen.findByRole('heading', { name: 'Organisations' })).toBeTruthy();
    expect(state.from).not.toHaveBeenCalled();
  });

  it('sends any other address to Organisations', async () => {
    state.session = signedIn();
    renderAt('/dashboard');
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/platform/organisations'));
  });

  it('asks for the two-step code first when the sign-in still needs one', async () => {
    state.session = signedIn();
    state.mfa = true;
    renderAt('/platform/organisations');
    expect(await screen.findByText('Two-step code form')).toBeTruthy();
    expect(screen.getByTestId('path').textContent).toBe('/mfa');
    expect(screen.queryByText('Figbloom console')).toBeNull();
  });
});
