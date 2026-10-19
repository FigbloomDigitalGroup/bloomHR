import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({
  role: 'ADMIN' as string | null,
  modules: [] as string[],
  companies: [{ tenant_id: 't1', name: 'Favor Farm', slug: 'favor-farm', role: 'ADMIN', is_current: true }] as unknown,
  profileCount: 0,
  employeeCount: 0,
  invitations: [] as unknown[],
  theme: null as unknown,
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => Promise.resolve({ count: table === 'company_logo' ? state.profileCount : state.employeeCount, error: null }),
    }),
  },
}));
vi.mock('../../lib/companyApi', () => ({ companyApi: { listInvitations: () => Promise.resolve(state.invitations) } }));
vi.mock('../../theme/applyTheme', () => ({ loadStoredTheme: () => state.theme }));
vi.mock('../../hooks/useMyCompanies', () => ({ useMyCompanies: () => ({ data: state.companies }) }));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    userRole: state.role,
    loading: false,
    hasAllPermissions: (ms: string[]) => state.role === 'ADMIN' || ms.every((m) => state.modules.includes(m)),
  }),
}));

import GetStarted, { OPEN_COMPANY_PROFILE, COMPANY_PROFILE_SAVED, SHOW_SETUP_GUIDE } from './GetStarted';

const open = () =>
  render(
    <MemoryRouter>
      <GetStarted />
    </MemoryRouter>
  );

beforeEach(() => {
  localStorage.clear();
  state.role = 'ADMIN';
  state.modules = [];
  state.profileCount = 0;
  state.employeeCount = 0;
  state.invitations = [];
  state.theme = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const allDone = () => {
  state.profileCount = 1;
  state.employeeCount = 12;
  state.invitations = [{ id: 'i1' }];
  state.theme = { mode: 'light' };
};

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

  it('ticks the profile step as soon as the profile is saved, without reloading the page', async () => {
    open();
    expect(await screen.findByText('0 of 4 done')).toBeTruthy();
    state.profileCount = 1; // the person saves their company profile in the top bar
    window.dispatchEvent(new Event(COMPANY_PROFILE_SAVED));
    expect(await screen.findByText('1 of 4 done')).toBeTruthy();
  });

  it('looks again when the person comes back to the tab (for example after inviting someone)', async () => {
    open();
    expect(await screen.findByText('0 of 4 done')).toBeTruthy();
    state.invitations = [{ id: 'i1' }];
    window.dispatchEvent(new Event('focus'));
    expect(await screen.findByText('1 of 4 done')).toBeTruthy();
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

  it('is shown to administrators only by default: not HR (no Settings) nor Checker (no Invite people)', async () => {
    state.role = 'HR';
    state.modules = ['employees', 'hr-admin', 'invite-people'];
    open();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText(/set up/)).toBeNull();
    cleanup();
    state.role = 'CHECKER';
    state.modules = ['employees', 'payroll', 'settings'];
    open();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText(/set up/)).toBeNull();
  });

  it('is shown to a role of the company’s own that holds Settings and Invite people', async () => {
    state.role = 'HR';
    state.modules = ['employees', 'invite-people', 'settings'];
    open();
    expect(await screen.findByText('Get Favor Farm set up')).toBeTruthy();
  });

  describe('once every step is done', () => {
    it('shrinks to one "is set up" line, and goes 7 days after it was first seen complete', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 9, 1, 9, 0));
      allDone();
      const { unmount } = open();
      expect(await screen.findByText('Favor Farm is set up')).toBeTruthy();
      expect(screen.queryByText('Get Favor Farm set up')).toBeNull();
      await waitFor(() => expect(localStorage.getItem('getstarted_complete_t1')).toBeTruthy());
      unmount();

      // 6 days later: still the line
      vi.setSystemTime(new Date(2026, 9, 7, 9, 0));
      const second = open();
      expect(await screen.findByText('Favor Farm is set up')).toBeTruthy();
      second.unmount();

      // 8 days later: nothing
      vi.setSystemTime(new Date(2026, 9, 9, 9, 0));
      open();
      await new Promise((r) => setTimeout(r, 30));
      expect(screen.queryByText('Favor Farm is set up')).toBeNull();
      expect(screen.queryByText('Get Favor Farm set up')).toBeNull();
    });

    it('"Show setup guide" opens the full checklist', async () => {
      allDone();
      open();
      fireEvent.click(await screen.findByRole('button', { name: 'Show setup guide' }));
      expect(screen.getByText('Get Favor Farm set up')).toBeTruthy();
      expect(screen.getByText('4 of 4 done')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
      expect(screen.getByText('Favor Farm is set up')).toBeTruthy();
    });

    it('a step going back to undone shows the full checklist again', async () => {
      allDone();
      open();
      expect(await screen.findByText('Favor Farm is set up')).toBeTruthy();
      state.invitations = []; // the only invitation was withdrawn
      window.dispatchEvent(new Event('focus'));
      expect(await screen.findByText('3 of 4 done')).toBeTruthy();
      await waitFor(() => expect(localStorage.getItem('getstarted_complete_t1')).toBeNull());
    });

    it('the "Setup guide" link brings the checklist back, even when hidden or long finished', async () => {
      allDone();
      localStorage.setItem('getstarted_complete_t1', String(Date.now() - 30 * 24 * 60 * 60 * 1000));
      localStorage.setItem('getstarted_dismissed_t1', '1');
      open();
      await new Promise((r) => setTimeout(r, 30));
      expect(screen.queryByText(/set up/)).toBeNull();
      act(() => {
        window.dispatchEvent(new Event(SHOW_SETUP_GUIDE));
      });
      expect(await screen.findByText('Get Favor Farm set up')).toBeTruthy();
      expect(screen.getByText('4 of 4 done')).toBeTruthy();
      expect(localStorage.getItem('getstarted_dismissed_t1')).toBeNull();
    });
  });
});
