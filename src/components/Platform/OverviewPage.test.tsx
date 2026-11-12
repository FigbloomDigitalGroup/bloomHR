import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../lib/adminApi';
import type { OrganisationTotals } from '../../lib/platformOrganisations';
import type { School } from '../../lib/platformSchools';
import type { FleetCompaniesList, FleetCompany } from '../../lib/platformFleet';

const api = vi.hoisted(() => ({
  role: 'viewer' as import('../../lib/platformRoles').PlatformRole | null,
  totals: null as OrganisationTotals | null,
  totalsError: null as Error | null,
  schools: [] as School[],
  schoolsErrors: [] as Error[],
  schoolsCalls: 0,
  fleet: null as FleetCompaniesList | null,
  fleetErrors: [] as Error[],
  fleetCalls: 0,
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/platformRoles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformRoles')>()),
  myPlatformRole: () => Promise.resolve(api.role),
}));
vi.mock('../../lib/platformOrganisations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformOrganisations')>()),
  organisationTotals: () => (api.totalsError ? Promise.reject(api.totalsError) : Promise.resolve(api.totals)),
}));
vi.mock('../../lib/platformSchools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformSchools')>()),
  listSchools: () => {
    api.schoolsCalls += 1;
    const error = api.schoolsErrors.shift();
    return error ? Promise.reject(error) : Promise.resolve({ generated_at: '2026-11-02T10:00:00Z', schools: api.schools });
  },
}));

vi.mock('../../lib/platformFleet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformFleet')>()),
  listFleetCompanies: () => {
    api.fleetCalls += 1;
    const error = api.fleetErrors.shift();
    return error ? Promise.reject(error) : Promise.resolve(api.fleet!);
  },
}));

import OverviewPage from './OverviewPage';
import { ConsoleBadgesContext } from '../Console/consoleBadges';

const school = (name: string, status: string, students: number, lastActive: string | null): School => ({
  id: name, name, slug: name, status, status_reason: null, organization: null, created_at: '2026-09-01T08:00:00Z',
  admin_email: null, students, teachers: 0, parents: 0, last_activity_at: lastActive,
});

const company = (id: string, status: FleetCompany['status'], vehicles: number, drivers: number, trips: number): FleetCompany => ({
  id, name: id, fleet_status: status, plan: 'trial', created_at: null, owner_name: null, owner_email: null, vehicles, drivers, admins: 1,
  trips_last_30_days: trips, last_location_at: null, in_fleet: true, organization_id: status ? `org-${id}` : null, status, status_reason: null,
});

afterEach(cleanup);
beforeEach(() => {
  api.role = 'viewer';
  api.totals = {
    by_status: { pending: 2, active: 7, rejected: 1, suspended: 3, total: 13 },
    signups_by_week: [],
    active_last_7_days: 5,
    auto_approve: false,
  };
  api.totalsError = null;
  api.schools = [
    school('A', 'active', 1200, new Date().toISOString()),
    school('B', 'active', 300, null),
    school('C', 'suspended', 50, null),
    school('D', 'trial', 0, new Date(Date.now() - 40 * 86_400_000).toISOString()),
  ];
  api.schoolsErrors = [];
  api.schoolsCalls = 0;
  api.fleet = {
    generated_at: null,
    truncated: false,
    platform: { ok: true },
    companies: [company('a', 'pending', 3, 2, 10), company('b', 'pending', 0, 0, 0), company('c', 'active', 20, 15, 400), company('d', null, 1, 1, 0)],
  };
  api.fleetErrors = [];
  api.fleetCalls = 0;
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <OverviewPage />
    </MemoryRouter>
  );

const card = (name: string) => screen.getByRole('region', { name });
/** the figure under a label, in a card */
const figure = (region: HTMLElement, label: string) => within(region).getByText(label, { selector: 'div' }).nextElementSibling?.textContent;

describe('the console overview', () => {
  it('shows Figbloom HR and Figbloom Schools, each with its numbers and links, for any role', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeTruthy();
    await waitFor(() => expect(within(card('Figbloom HR')).queryByText('Companies')).toBeTruthy());
    const hr = card('Figbloom HR');
    expect(figure(hr, 'Companies')).toBe('13');
    expect(figure(hr, 'Waiting for approval')).toBe('2');
    expect(figure(hr, 'Active in the last 7 days')).toBe('5');
    expect(figure(hr, 'Suspended')).toBe('3');
    expect(within(hr).getByRole('link', { name: 'Organisations' }).getAttribute('href')).toBe('/platform/organisations');
    expect(within(hr).getByRole('link', { name: 'Statutory rates' }).getAttribute('href')).toBe('/platform/rates');

    await waitFor(() => expect(within(card('Figbloom Schools')).queryByText('Students')).toBeTruthy());
    const schools = card('Figbloom Schools');
    expect(figure(schools, 'Schools')).toBe('4');
    expect(figure(schools, 'Active')).toBe('2');
    expect(figure(schools, 'Suspended')).toBe('1');
    expect(figure(schools, 'Students')).toBe('1,550');
    expect(figure(schools, 'Active in the last 7 days')).toBe('1');
    expect(within(schools).getByRole('link', { name: 'Schools' }).getAttribute('href')).toBe('/platform/schools');
  });

  it("says Figbloom Schools isn't connected, and HR still shows", async () => {
    api.schoolsErrors = [new ApiError("Figbloom Schools isn't connected yet.", 503, 'schools_not_connected')];
    renderPage();
    expect(await within(await screen.findByRole('region', { name: 'Figbloom Schools' })).findByText("Figbloom Schools isn't connected yet")).toBeTruthy();
    expect(within(card('Figbloom Schools')).queryByRole('button', { name: 'Try again' })).toBeNull();
    await waitFor(() => expect(figure(card('Figbloom HR'), 'Companies')).toBe('13'));
  });

  it("says Figbloom Schools didn't answer, and tries again", async () => {
    api.schoolsErrors = [new ApiError("Figbloom Schools didn't answer. Try again.", 502, 'schools_unavailable')];
    renderPage();
    const schools = await screen.findByRole('region', { name: 'Figbloom Schools' });
    expect(await within(schools).findByText("Figbloom Schools didn't answer")).toBeTruthy();
    fireEvent.click(within(schools).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(figure(card('Figbloom Schools'), 'Schools')).toBe('4'));
    expect(api.schoolsCalls).toBe(2);
  });

  it('keeps Schools when Figbloom HR fails', async () => {
    api.totalsError = new Error('permission denied');
    renderPage();
    expect(await within(await screen.findByRole('region', { name: 'Figbloom HR' })).findByText(/Could not load Figbloom HR: permission denied/)).toBeTruthy();
    await waitFor(() => expect(figure(card('Figbloom Schools'), 'Schools')).toBe('4'));
  });

  it('shows Figbloom Fleet: companies, waiting for approval, vehicles and trips, with a link to its companies', async () => {
    renderPage();
    await waitFor(() => expect(within(card('Figbloom Fleet')).queryByText('Vehicles')).toBeTruthy());
    const fleet = card('Figbloom Fleet');
    expect(figure(fleet, 'Companies')).toBe('4');
    expect(figure(fleet, 'Waiting for approval')).toBe('2');
    expect(figure(fleet, 'Vehicles')).toBe('24');
    expect(figure(fleet, 'Trips, last 30 days')).toBe('410');
    expect(within(fleet).getByRole('link', { name: 'Companies' }).getAttribute('href')).toBe('/platform/fleet/companies');
  });

  it("says Fleet isn't connected to the console yet, and the others still show", async () => {
    api.fleetErrors = [new ApiError("Figbloom Fleet isn't connected to the console yet.", 503, 'fleet_not_connected')];
    renderPage();
    const fleet = await screen.findByRole('region', { name: 'Figbloom Fleet' });
    expect(await within(fleet).findByText("Fleet isn't connected to the console yet")).toBeTruthy();
    expect(within(fleet).getByText(/FLEET_PLATFORM_URL and FLEET_PLATFORM_SECRET/)).toBeTruthy();
    expect(within(fleet).queryByRole('button', { name: 'Try again' })).toBeNull();
    await waitFor(() => expect(figure(card('Figbloom Schools'), 'Schools')).toBe('4'));
    await waitFor(() => expect(figure(card('Figbloom HR'), 'Companies')).toBe('13'));
  });

  it("says Fleet didn't answer, and tries again", async () => {
    api.fleetErrors = [new ApiError("Figbloom Fleet didn't answer. Try again.", 502, 'fleet_unavailable')];
    renderPage();
    const fleet = await screen.findByRole('region', { name: 'Figbloom Fleet' });
    fireEvent.click(await within(fleet).findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(figure(card('Figbloom Fleet'), 'Companies')).toBe('4'));
    expect(api.fleetCalls).toBe(2);
  });

  it("without the platform's statuses, Fleet's waiting count is unknown, not zero", async () => {
    api.fleet = { ...api.fleet!, platform: { ok: false, code: 'platform_not_connected', message: 'x' }, companies: api.fleet!.companies.map((c) => ({ ...c, status: null })) };
    renderPage();
    await waitFor(() => expect(within(card('Figbloom Fleet')).queryByText('Vehicles')).toBeTruthy());
    expect(figure(card('Figbloom Fleet'), 'Waiting for approval')).toBe('—');
  });

  it('is for platform admins only', async () => {
    api.role = null;
    renderPage();
    expect(await screen.findByText('Only Figbloom platform admins can see the console.')).toBeTruthy();
    expect(api.schoolsCalls).toBe(0);
    expect(api.fleetCalls).toBe(0);
  });

  it('publishes the menu badges: companies waiting for approval, schools needing attention', async () => {
    const published: Record<string, unknown> = {};
    render(
      <ConsoleBadgesContext.Provider value={(path, badge) => { published[path] = badge; }}>
        <MemoryRouter>
          <OverviewPage />
        </MemoryRouter>
      </ConsoleBadgesContext.Provider>
    );
    // B and C never signed in and have no admin; C is suspended, so left out; A and D have no admin
    await waitFor(() => expect(published['/platform/schools']).toEqual({ count: 3, label: '3 need attention' }));
    expect(published['/platform/organisations']).toEqual({ count: 2, label: '2 waiting for approval' });
    await waitFor(() => expect(published['/platform/fleet/companies']).toEqual({ count: 2, label: '2 waiting for approval' }));
    expect(figure(card('Figbloom Schools'), 'Needs attention')).toBe('3');
  });
});
