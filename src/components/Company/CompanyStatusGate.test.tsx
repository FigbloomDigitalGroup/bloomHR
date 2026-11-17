import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MyCompanyStatus } from '../../lib/platformOrganisations';

const state = vi.hoisted(() => ({
  status: null as unknown,
  admin: false,
  companies: [] as { tenant_id: string; name: string }[],
  switchToCompany: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { signOut: vi.fn() } } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../lib/platformOrganisations', () => ({ myCompanyStatus: () => Promise.resolve(state.status) }));
vi.mock('../../lib/platformRates', () => ({ isPlatformAdmin: () => Promise.resolve(state.admin) }));
vi.mock('../../hooks/useMyCompanies', () => ({
  useMyCompanies: () => ({ data: state.companies, isLoading: false }),
  switchToCompany: (...args: unknown[]) => state.switchToCompany(...args),
}));

import CompanyStatusGate from './CompanyStatusGate';

const company = (status: MyCompanyStatus['status'], extra: Partial<MyCompanyStatus> = {}): MyCompanyStatus => ({
  tenant_id: 'new', name: 'Startup Ltd', status, status_reason: null, status_changed_at: null, other_active_companies: 0, ...extra,
});

const renderAt = (path = '/dashboard') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <CompanyStatusGate userId="u1">
        <p>The app</p>
      </CompanyStatusGate>
    </MemoryRouter>
  );

afterEach(cleanup);
beforeEach(() => {
  state.status = company('active');
  state.admin = false;
  state.companies = [];
  state.switchToCompany.mockReset().mockResolvedValue(undefined);
});

describe('the company status gate', () => {
  it('lets an active company into the app', async () => {
    renderAt();
    expect(await screen.findByText('The app')).toBeTruthy();
  });

  it('carries on as before when the status cannot be read', async () => {
    state.status = null;
    renderAt();
    expect(await screen.findByText('The app')).toBeTruthy();
  });

  it('shows the owner of a pending company only the waiting screen', async () => {
    state.status = company('pending');
    renderAt();
    expect(await screen.findByText('Your company is waiting for approval')).toBeTruthy();
    expect(screen.queryByText('The app')).toBeNull();
  });

  it('says why a company was not approved or is suspended', async () => {
    state.status = company('rejected', { status_reason: 'Not a real business' });
    renderAt();
    expect(await screen.findByText('Your company was not approved')).toBeTruthy();
    expect(screen.getByText('Not a real business')).toBeTruthy();
    cleanup();
    state.status = company('suspended');
    renderAt();
    expect(await screen.findByText('Your company is suspended')).toBeTruthy();
  });

  it('lets someone with another, active company switch to it', async () => {
    state.status = company('pending', { other_active_companies: 1 });
    state.companies = [{ tenant_id: 'a', name: 'Acme Ltd' }];
    renderAt();
    fireEvent.click(await screen.findByText('Open Acme Ltd'));
    await waitFor(() => expect(state.switchToCompany).toHaveBeenCalledWith('u1', 'a'));
  });

  it('lets a platform admin open the platform pages, and offers them the link', async () => {
    state.status = company('pending');
    state.admin = true;
    renderAt('/platform/organisations');
    expect(await screen.findByText('The app')).toBeTruthy();
    cleanup();
    renderAt('/dashboard');
    expect(await screen.findByText('Open Organisations')).toBeTruthy();
    expect(screen.queryByText('The app')).toBeNull();
  });
});
