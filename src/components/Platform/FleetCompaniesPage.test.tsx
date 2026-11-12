import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../lib/adminApi';
import type { FleetCompaniesList, FleetCompany } from '../../lib/platformFleet';

const api = vi.hoisted(() => ({
  role: 'owner' as import('../../lib/platformRoles').PlatformRole | null,
  companies: [] as FleetCompany[],
  platform: { ok: true } as FleetCompaniesList['platform'],
  listErrors: [] as Error[],
  listCalls: 0,
  decisions: [] as unknown[][],
  decisionError: null as Error | null,
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toast }));
vi.mock('../../lib/platformRoles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformRoles')>()),
  myPlatformRole: () => Promise.resolve(api.role),
}));
vi.mock('../../lib/platformFleet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformFleet')>()),
  listFleetCompanies: () => {
    api.listCalls += 1;
    const error = api.listErrors.shift();
    return error ? Promise.reject(error) : Promise.resolve({ generated_at: null, companies: api.companies, truncated: false, platform: api.platform });
  },
  setFleetCompanyStatus: (id: string, action: string, reason: string) => {
    api.decisions.push([id, action, reason]);
    if (api.decisionError) return Promise.reject(api.decisionError);
    const to = { approve: 'active', reject: 'rejected', suspend: 'suspended', reactivate: 'active' }[action]!;
    return Promise.resolve({ organization_id: id, status: to, status_reason: reason.trim() || null });
  },
}));

import FleetCompaniesPage from './FleetCompaniesPage';
import { ConsoleBadgesContext } from '../Console/consoleBadges';

const company = (id: string, name: string, status: FleetCompany['status'], extra: Partial<FleetCompany> = {}): FleetCompany => ({
  id, name, fleet_status: status ?? 'pending', plan: 'trial', created_at: '2026-10-01T08:00:00Z',
  owner_name: `Owner ${name}`, owner_email: `owner@${id}.co.ke`,
  vehicles: 10, drivers: 8, admins: 2, trips_last_30_days: 100, last_location_at: '2026-11-12T07:55:00Z',
  in_fleet: true, organization_id: status ? `org-${id}` : null, status, status_reason: null,
  ...extra,
});

afterEach(cleanup);
beforeEach(() => {
  api.role = 'owner';
  api.platform = { ok: true };
  api.companies = [
    company('c1', 'Swift Couriers', 'pending'),
    company('c2', 'Rift Valley Haulage', 'active', { plan: 'pro', vehicles: 40, drivers: 30, trips_last_30_days: 900 }),
    company('c3', 'Coast Movers', 'suspended', { status_reason: 'Unpaid' }),
    company('c4', 'Fake Fleet Ltd', 'rejected', { vehicles: 0, drivers: 0, trips_last_30_days: 0 }),
    company('c5', 'Brand New Logistics', null, { vehicles: null, drivers: null, trips_last_30_days: null }),
  ];
  api.listErrors = [];
  api.listCalls = 0;
  api.decisions = [];
  api.decisionError = null;
  toast.success.mockReset();
  toast.error.mockReset();
});

const renderPage = (publish?: (path: string, badge: unknown) => void) =>
  render(
    <ConsoleBadgesContext.Provider value={publish ?? (() => {})}>
      <MemoryRouter>
        <FleetCompaniesPage />
      </MemoryRouter>
    </ConsoleBadgesContext.Provider>
  );
const rowOf = async (name: string) => (await screen.findByRole('button', { name })).closest('tr') as HTMLElement;
const stat = (label: string) => screen.getByText(label, { selector: 'div' }).nextElementSibling?.textContent;

describe('the Fleet companies page', () => {
  it('is for platform admins only', async () => {
    api.role = null;
    renderPage();
    expect(await screen.findByText('Only Figbloom platform admins can see Fleet companies.')).toBeTruthy();
    expect(api.listCalls).toBe(0);
  });

  it("lists each company with Fleet's summary and the platform's status", async () => {
    renderPage();
    const swift = await rowOf('Swift Couriers');
    expect(within(swift).getByText('Owner Swift Couriers')).toBeTruthy();
    expect(within(swift).getByText('owner@c1.co.ke')).toBeTruthy();
    expect(within(swift).getByText('trial')).toBeTruthy();
    expect(within(swift).getByText('10')).toBeTruthy();
    expect(within(swift).getByText('1 Oct 2026')).toBeTruthy();
    expect(within(swift).getByText('Waiting for approval')).toBeTruthy();
    expect(within(await rowOf('Coast Movers')).getByText('Unpaid')).toBeTruthy();
    // not on the platform yet: says so, counts unknown rather than zero, nothing to decide
    const fresh = await rowOf('Brand New Logistics');
    expect(within(fresh).getByText('Not on the platform yet')).toBeTruthy();
    expect(within(fresh).getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(within(fresh).queryByText('Approve')).toBeNull();
  });

  it('shows the totals', async () => {
    renderPage();
    await rowOf('Swift Couriers');
    expect(stat('Companies')).toBe('5');
    expect(stat('Waiting for approval')).toBe('1');
    expect(stat('Active')).toBe('1');
    expect(stat('Suspended or rejected')).toBe('2');
    expect(stat('Trips, last 30 days')).toBe('1,100');
  });

  it('filters by status and searches by company or owner', async () => {
    renderPage();
    await rowOf('Swift Couriers');
    fireEvent.click(screen.getByRole('tab', { name: 'Suspended (1)' }));
    expect(screen.queryByRole('button', { name: 'Swift Couriers' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Coast Movers' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Not on the platform yet (1)' }));
    expect(screen.getByRole('button', { name: 'Brand New Logistics' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    const search = screen.getByPlaceholderText('Search by company or owner');
    fireEvent.change(search, { target: { value: 'owner@c2' } });
    expect(screen.getByRole('button', { name: 'Rift Valley Haulage' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Swift Couriers' })).toBeNull();
    fireEvent.change(search, { target: { value: 'nothing like it' } });
    expect(screen.getByText('No companies match.')).toBeTruthy();
  });

  it("opens a company's details", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Rift Valley Haulage' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Owner Rift Valley Haulage')).toBeTruthy();
    expect(within(dialog).getByText('pro')).toBeTruthy();
    expect(within(dialog).getByText('900')).toBeTruthy();
    expect(within(dialog).getByText('org-c2')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Suspend' })).toBeTruthy();
  });

  it('publishes the menu badge: companies waiting for approval', async () => {
    const published: Record<string, unknown> = {};
    renderPage((path, badge) => {
      published[path] = badge;
    });
    await waitFor(() => expect(published['/platform/fleet/companies']).toEqual({ count: 1, label: '1 waiting for approval' }));
  });

  it("says Fleet isn't connected to the console yet (503), with no retry", async () => {
    api.listErrors = [new ApiError("Figbloom Fleet isn't connected to the console yet.", 503, 'fleet_not_connected')];
    renderPage();
    expect(await screen.findByText("Fleet isn't connected to the console yet")).toBeTruthy();
    expect(screen.getByText(/FLEET_PLATFORM_URL and FLEET_PLATFORM_SECRET/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it("says Fleet didn't answer (502), and tries again", async () => {
    api.listErrors = [new ApiError("Figbloom Fleet didn't answer. Try again.", 502, 'fleet_unavailable')];
    renderPage();
    expect(await screen.findByText("Figbloom Fleet didn't answer, try again")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await rowOf('Swift Couriers')).toBeTruthy();
    expect(api.listCalls).toBe(2);
  });

  it("without the platform, lists the companies with a note, and offers no decisions", async () => {
    api.platform = { ok: false, code: 'platform_not_connected', message: "The Figbloom platform isn't connected to the console yet." };
    api.companies = api.companies.map((c) => ({ ...c, status: null, organization_id: null }));
    renderPage();
    await rowOf('Swift Couriers');
    expect(screen.getByRole('note').textContent).toMatch(/The Figbloom platform isn't connected to the console/);
    for (const a of ['Approve', 'Reject', 'Suspend', 'Reactivate']) expect(screen.queryByText(a)).toBeNull();
  });
});

describe('the Fleet companies page: decisions by role', () => {
  const actionsOf = async (name: string) => {
    const row = await rowOf(name);
    return ['Approve', 'Reject', 'Suspend', 'Reactivate'].filter((a) => within(row).queryByText(a));
  };

  it.each(['owner', 'admin'] as const)('%s approves, rejects, suspends and reactivates', async (role) => {
    api.role = role;
    renderPage();
    expect(await actionsOf('Swift Couriers')).toEqual(['Approve', 'Reject']);
    expect(await actionsOf('Rift Valley Haulage')).toEqual(['Suspend']);
    expect(await actionsOf('Coast Movers')).toEqual(['Reactivate']);
    expect(await actionsOf('Fake Fleet Ltd')).toEqual(['Reactivate']);
  });

  it('support suspends and reactivates suspended companies, never approves, rejects or reactivates a rejected one', async () => {
    api.role = 'support';
    renderPage();
    expect(await actionsOf('Swift Couriers')).toEqual([]);
    expect(await actionsOf('Rift Valley Haulage')).toEqual(['Suspend']);
    expect(await actionsOf('Coast Movers')).toEqual(['Reactivate']);
    expect(await actionsOf('Fake Fleet Ltd')).toEqual([]);
  });

  it('a viewer sees every company but decides nothing', async () => {
    api.role = 'viewer';
    renderPage();
    await rowOf('Swift Couriers');
    for (const a of ['Approve', 'Reject', 'Suspend', 'Reactivate']) expect(screen.queryByText(a)).toBeNull();
  });

  it("approves on the platform (by the company's platform ID), and the row follows", async () => {
    renderPage();
    fireEvent.click(within(await rowOf('Swift Couriers')).getByText('Approve'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('The company can use Figbloom Fleet. Fleet emails the owner that it is approved.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.decisions).toEqual([['org-c1', 'approve', '']]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Swift Couriers: active. Figbloom Fleet applies it within a minute.'));
    expect(within(await rowOf('Swift Couriers')).getByText('Active')).toBeTruthy();
  });

  it('suspends only with a reason', async () => {
    renderPage();
    fireEvent.click(within(await rowOf('Rift Valley Haulage')).getByText('Suspend'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('alert').textContent).toMatch(/^Suspends the company/);
    const button = within(dialog).getByRole('button', { name: 'Suspend' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Why\?/), { target: { value: 'Unpaid' } });
    fireEvent.click(button);
    await waitFor(() => expect(api.decisions).toEqual([['org-c2', 'suspend', 'Unpaid']]));
  });

  it('rejects only with a reason', async () => {
    renderPage();
    fireEvent.click(within(await rowOf('Swift Couriers')).getByText('Reject'));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the platform's refusal and keeps the dialog open", async () => {
    api.decisionError = new ApiError('A active organisation cannot become rejected', 409, 'invalid_transition');
    renderPage();
    fireEvent.click(within(await rowOf('Swift Couriers')).getByText('Approve'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('A active organisation cannot become rejected'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
