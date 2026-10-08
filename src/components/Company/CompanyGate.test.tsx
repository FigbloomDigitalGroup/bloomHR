import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({
  companies: undefined as unknown,
  isLoading: false,
  switchToCompany: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signOut: vi.fn(),
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }),
    },
  },
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../hooks/useMyCompanies', () => ({
  useMyCompanies: () => ({ data: state.companies, isLoading: state.isLoading }),
  switchToCompany: (...args: unknown[]) => state.switchToCompany(...args),
}));

import toast from 'react-hot-toast';
import CompanyGate from './CompanyGate';
import CompanySwitcher from './CompanySwitcher';
import { hasChosenCompany } from '../../lib/companyChoice';

const A = { tenant_id: 'a', name: 'Acme Ltd', slug: 'acme', role: 'ADMIN', is_current: true };
const B = { tenant_id: 'b', name: 'Beta Co', slug: 'beta', role: 'STAFF', is_current: false };

beforeEach(() => {
  sessionStorage.clear();
  state.companies = [A];
  state.isLoading = false;
  state.switchToCompany.mockReset().mockResolvedValue(undefined);
  vi.mocked(toast.error).mockClear();
});
afterEach(() => cleanup());

const gate = () =>
  render(
    <CompanyGate userId="u1">
      <div>the app</div>
    </CompanyGate>
  );

describe('CompanyGate', () => {
  it('lets a person with one company straight in', () => {
    gate();
    expect(screen.getByText('the app')).toBeTruthy();
  });

  it('waits while the companies load, instead of flashing the app', () => {
    state.isLoading = true;
    gate();
    expect(screen.queryByText('the app')).toBeNull();
    expect(screen.getByText(/Loading your workspace/)).toBeTruthy();
  });

  it('lets people through if the companies could not be loaded (the database still limits them)', () => {
    state.companies = undefined;
    gate();
    expect(screen.getByText('the app')).toBeTruthy();
  });

  it('asks a person in several companies to choose before showing anything', () => {
    state.companies = [A, B];
    gate();
    expect(screen.queryByText('the app')).toBeNull();
    expect(screen.getByText('Which company are you working in?')).toBeTruthy();
    expect(screen.getByText('Acme Ltd')).toBeTruthy();
    expect(screen.getByText('Beta Co')).toBeTruthy();
  });

  it('keeping the company they are in opens the app and remembers the choice', () => {
    state.companies = [A, B];
    gate();
    fireEvent.click(screen.getByRole('button', { name: /Acme Ltd/ }));
    expect(screen.getByText('the app')).toBeTruthy();
    expect(state.switchToCompany).not.toHaveBeenCalled();
    expect(hasChosenCompany('u1')).toBe(true);
  });

  it('choosing another company switches to it', async () => {
    state.companies = [A, B];
    gate();
    fireEvent.click(screen.getByRole('button', { name: /Beta Co/ }));
    await waitFor(() => expect(state.switchToCompany).toHaveBeenCalledWith('u1', 'b'));
  });

  it('shows why a switch failed and lets them try again', async () => {
    state.companies = [A, B];
    state.switchToCompany.mockRejectedValue(new Error('You are not a member of that company'));
    gate();
    fireEvent.click(screen.getByRole('button', { name: /Beta Co/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('You are not a member of that company'));
    expect((screen.getByRole('button', { name: /Beta Co/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not ask again after they have chosen in this tab (a page refresh)', () => {
    state.companies = [A, B];
    sessionStorage.setItem('company_chosen_for', 'u1');
    gate();
    expect(screen.getByText('the app')).toBeTruthy();
  });
});

describe('CompanySwitcher', () => {
  const onOpenProfile = vi.fn();
  const open = () =>
    render(
      <MemoryRouter>
        <CompanySwitcher name="Acme Ltd" onOpenProfile={onOpenProfile} />
      </MemoryRouter>
    );
  const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /Acme Ltd/ }));

  it('one company: the menu has the profile and "New company", nothing to switch to', () => {
    onOpenProfile.mockClear();
    open();
    openMenu();
    expect(screen.queryByText('Switch company')).toBeNull();
    expect(screen.getByRole('menuitem', { name: /New company/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /Company profile/ }));
    expect(onOpenProfile).toHaveBeenCalled();
  });

  it('staff in one company cannot create a company from the menu', () => {
    state.companies = [{ ...A, role: 'STAFF' }];
    open();
    openMenu();
    expect(screen.queryByRole('menuitem', { name: /New company/ })).toBeNull();
  });

  it('lists every company, marks the current one, and switches to another', async () => {
    state.companies = [A, B];
    open();
    openMenu();
    expect(screen.getByText('Switch company')).toBeTruthy();
    expect(screen.getByLabelText('Current')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /New company/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: /Beta Co/ }));
    await waitFor(() => expect(state.switchToCompany).toHaveBeenCalledWith('u1', 'b'));
  });

  it('does nothing when the current company is chosen', async () => {
    state.companies = [A, B];
    open();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Acme Ltd/ }));
    await new Promise((r) => setTimeout(r, 20));
    expect(state.switchToCompany).not.toHaveBeenCalled();
  });
});
