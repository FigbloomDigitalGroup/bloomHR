import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({
  role: 'ADMIN' as string | null,
  companies: [{ tenant_id: 't1', name: 'Favor Farm', slug: 'favor-farm', role: 'ADMIN', is_current: true }] as unknown,
  profileCount: 0,
  employeeCount: 0,
  invitations: [] as unknown[],
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => Promise.resolve({ count: table === 'company_logo' ? state.profileCount : state.employeeCount, error: null }),
    }),
  },
}));
vi.mock('../../lib/companyApi', () => ({ companyApi: { listInvitations: () => Promise.resolve(state.invitations) } }));
vi.mock('../../hooks/useMyCompanies', () => ({ useMyCompanies: () => ({ data: state.companies }) }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ userRole: state.role }) }));

import GetStarted, { OPEN_COMPANY_PROFILE } from './GetStarted';

const open = () =>
  render(
    <MemoryRouter>
      <GetStarted />
    </MemoryRouter>
  );

beforeEach(() => {
  localStorage.clear();
  state.role = 'ADMIN';
  state.profileCount = 0;
  state.employeeCount = 0;
  state.invitations = [];
});
afterEach(() => cleanup());

describe('GetStarted', () => {
  it('guides a new administrator through profile, team, employees and look', async () => {
    open();
    expect(await screen.findByText('Get Favor Farm set up')).toBeTruthy();
    expect(screen.getByText('0 of 4 done')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Invite people' }).getAttribute('href')).toBe('/invite-people');
    expect(screen.getByRole('link', { name: 'Add employee' }).getAttribute('href')).toBe('/add-employee');
    expect(screen.getByRole('link', { name: 'Appearance' }).getAttribute('href')).toBe('/appearance');
  });

  it('ticks off what has already been done', async () => {
    state.profileCount = 1;
    state.employeeCount = 12;
    state.invitations = [{ id: 'i1' }];
    open();
    expect(await screen.findByText('3 of 4 done')).toBeTruthy();
  });

  it('the profile step asks the top bar to open the company profile', async () => {
    const opened = vi.fn();
    window.addEventListener(OPEN_COMPANY_PROFILE, opened);
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Open profile' }));
    expect(opened).toHaveBeenCalledTimes(1);
    window.removeEventListener(OPEN_COMPANY_PROFILE, opened);
  });

  it('can be hidden, and stays hidden for that company', async () => {
    const { unmount } = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Hide' }));
    expect(screen.queryByText('Get Favor Farm set up')).toBeNull();
    unmount();
    open();
    await waitFor(() => expect(localStorage.getItem('getstarted_dismissed_t1')).toBe('1'));
    expect(screen.queryByText('Get Favor Farm set up')).toBeNull();
  });

  it('is shown to administrators only', async () => {
    state.role = 'HR';
    open();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText(/set up/)).toBeNull();
  });
});
