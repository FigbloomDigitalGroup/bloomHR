import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Organisation, OrganisationTotals } from '../../lib/platformOrganisations';

const api = vi.hoisted(() => ({
  admin: true,
  list: [] as Organisation[],
  totals: null as OrganisationTotals | null,
  decisions: [] as unknown[][],
  auto: [] as boolean[],
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/platformRates', () => ({ isPlatformAdmin: () => Promise.resolve(api.admin) }));
vi.mock('../../lib/platformOrganisations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformOrganisations')>()),
  listOrganisations: () => Promise.resolve(api.list),
  organisationTotals: () => Promise.resolve(api.totals),
  setCompanyStatus: (...args: unknown[]) => {
    api.decisions.push(args);
    return Promise.resolve(args[1] === 'reject' ? 'rejected' : 'active');
  },
  setAutoApprove: (on: boolean) => {
    api.auto.push(on);
    return Promise.resolve(on);
  },
}));

import OrganisationsPage from './OrganisationsPage';

const org = (name: string, status: Organisation['status'], extra: Partial<Organisation> = {}): Organisation => ({
  id: name, name, slug: name, plan: 'trial', status, created_at: '2026-10-20T08:00:00Z', owner_id: 'u', owner_name: null,
  owner_email: `owner@${name.split(' ')[0].toLowerCase()}.co`, employees: 0, users: 1, payroll_runs: 0, last_activity: null,
  status_reason: null, status_changed_at: null, status_changed_by_email: null, ...extra,
});

afterEach(cleanup);
beforeEach(() => {
  api.admin = true;
  api.list = [
    org('Acme Ltd', 'pending', { owner_name: 'Amina Otieno' }),
    org('Beta Co', 'active', { employees: 42, users: 5, payroll_runs: 7, last_activity: '2026-10-28T09:00:00Z' }),
    org('Gamma Farms', 'suspended', { status_reason: 'Unpaid invoice' }),
  ];
  api.totals = {
    by_status: { pending: 1, active: 1, rejected: 0, suspended: 1, total: 3 },
    signups_by_week: [{ week: '2026-10-19', count: 2 }, { week: '2026-10-26', count: 1 }],
    active_last_7_days: 1,
    auto_approve: false,
  };
  api.decisions = [];
  api.auto = [];
});

const rowOf = async (name: string) => (await screen.findByText(name)).closest('tr') as HTMLElement;

describe('the organisations page', () => {
  it('is for platform admins only', async () => {
    api.admin = false;
    render(<OrganisationsPage />);
    expect(await screen.findByText(/Only Figbloom platform admins can see and approve companies/)).toBeTruthy();
    expect(screen.queryByText('Acme Ltd')).toBeNull();
  });

  it('lists every company with its owner and counts, and the totals', async () => {
    render(<OrganisationsPage />);
    const beta = await rowOf('Beta Co');
    expect(within(beta).getByText('42')).toBeTruthy();
    expect(within(beta).getByText('7')).toBeTruthy();
    expect(within(await rowOf('Acme Ltd')).getByText('Amina Otieno')).toBeTruthy();
    expect(within(await rowOf('Gamma Farms')).getByText('Unpaid invoice')).toBeTruthy();
    expect(screen.getByText('Active in the last 7 days')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'New sign-ups per week' })).getAllByRole('listitem')).toHaveLength(2);
  });

  it('filters by status and searches by name', async () => {
    render(<OrganisationsPage />);
    await rowOf('Acme Ltd');
    fireEvent.click(screen.getByRole('tab', { name: /Waiting for approval/ }));
    expect(screen.queryByText('Beta Co')).toBeNull();
    expect(screen.getByText('Acme Ltd')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    fireEvent.change(screen.getByPlaceholderText('Search by company name'), { target: { value: 'gam' } });
    expect(screen.getByText('Gamma Farms')).toBeTruthy();
    expect(screen.queryByText('Acme Ltd')).toBeNull();
  });

  it('approves a waiting company', async () => {
    render(<OrganisationsPage />);
    fireEvent.click(within(await rowOf('Acme Ltd')).getByText('Approve'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.decisions).toEqual([['Acme Ltd', 'approve', '']]));
  });

  it('rejects only with a reason', async () => {
    render(<OrganisationsPage />);
    fireEvent.click(within(await rowOf('Acme Ltd')).getByText('Reject'));
    const dialog = await screen.findByRole('dialog');
    const button = within(dialog).getByRole('button', { name: 'Reject' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Why\?/), { target: { value: 'Not a real business' } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(api.decisions).toEqual([['Acme Ltd', 'reject', 'Not a real business']]));
  });

  it('offers suspend for an active company and reactivate for a suspended one', async () => {
    render(<OrganisationsPage />);
    expect(within(await rowOf('Beta Co')).getByText('Suspend')).toBeTruthy();
    expect(within(await rowOf('Gamma Farms')).getByText('Reactivate')).toBeTruthy();
    expect(within(await rowOf('Gamma Farms')).queryByText('Approve')).toBeNull();
  });

  it('turns automatic approval on', async () => {
    render(<OrganisationsPage />);
    const box = (await screen.findByLabelText(/Approve new companies automatically/)) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect(api.auto).toEqual([true]));
    await waitFor(() => expect((screen.getByLabelText(/Approve new companies automatically/) as HTMLInputElement).checked).toBe(true));
  });
});
