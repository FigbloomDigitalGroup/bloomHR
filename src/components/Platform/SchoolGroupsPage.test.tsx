import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../lib/adminApi';
import type { SchoolGroup } from '../../lib/platformSchoolGroups';
import type { School } from '../../lib/platformSchools';

const api = vi.hoisted(() => ({
  role: 'owner' as import('../../lib/platformRoles').PlatformRole | null,
  groups: [] as SchoolGroup[],
  live: false,
  listErrors: [] as Error[],
  listCalls: 0,
  schools: [] as School[],
  schoolsError: null as Error | null,
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
vi.mock('../../lib/platformSchools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformSchools')>()),
  listSchools: () => (api.schoolsError ? Promise.reject(api.schoolsError) : Promise.resolve({ generated_at: '', schools: api.schools })),
}));
vi.mock('../../lib/platformSchoolGroups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformSchoolGroups')>()),
  listSchoolGroups: () => {
    api.listCalls += 1;
    const error = api.listErrors.shift();
    return error ? Promise.reject(error) : Promise.resolve({ groups: api.groups, counts: {}, truncated: false, decisions_live: api.live });
  },
  setSchoolGroupStatus: (id: string, action: string, reason: string) => {
    api.decisions.push([id, action, reason]);
    if (api.decisionError) return Promise.reject(api.decisionError);
    const g = api.groups.find((x) => x.id === id)!;
    const to = { approve: 'active', reject: 'rejected', suspend: 'suspended', reactivate: 'active' }[action]!;
    return Promise.resolve({ ...g, status: to, status_reason: reason.trim() || null });
  },
}));

import SchoolGroupsPage from './SchoolGroupsPage';
import { ConsoleBadgesContext } from '../Console/consoleBadges';

const group = (id: string, name: string, status: string, schools: [string, string, string][], extra: Partial<SchoolGroup> = {}): SchoolGroup => ({
  id, name, status, status_reason: null, owner_email: `owner@${id}.ac.ke`, created_at: '2026-10-01T08:00:00Z', local_organization_id: `l-${id}`,
  tenant_count: schools.length,
  schools: schools.map(([n, slug, local]) => ({ id: `p-${slug}`, name: n, status: 'active', local_tenant_id: local, local_slug: slug })),
  ...extra,
});
const school = (id: string, students: number, teachers: number, parents: number) =>
  ({ id, name: id, slug: id, status: 'active', status_reason: null, organization: null, created_at: '', admin_email: null, students, teachers, parents, last_activity_at: null }) as School;

afterEach(cleanup);
beforeEach(() => {
  api.role = 'owner';
  api.live = false;
  api.groups = [
    group('g1', 'Hillside Schools', 'pending', [['Hillside Primary', 'hillside-primary', 's1'], ['Hillside Secondary', 'hillside-secondary', 's2']]),
    group('g2', 'Lakeview Trust', 'active', [['Lakeview High', 'lakeview-high', 's3'], ['Lakeview Junior', 'lakeview-junior', 's4'], ['Lakeview Annex', 'lakeview-annex', 's5']]),
    group('g3', 'Moi Group', 'suspended', [['Moi Girls', 'moi-girls', 's6']], { status_reason: 'Fees unpaid' }),
    group('g4', 'Empty Org', 'rejected', []),
  ];
  api.listErrors = [];
  api.listCalls = 0;
  api.schools = [school('s1', 100, 10, 90), school('s2', 50, 5, 40), school('s3', 300, 20, 250)];
  api.schoolsError = null;
  api.decisions = [];
  api.decisionError = null;
  toast.success.mockReset();
  toast.error.mockReset();
});

const renderPage = (publish?: (path: string, badge: unknown) => void) =>
  render(
    <ConsoleBadgesContext.Provider value={publish ?? (() => {})}>
      <MemoryRouter>
        <SchoolGroupsPage />
      </MemoryRouter>
    </ConsoleBadgesContext.Provider>
  );
const rowOf = async (name: string) => (await screen.findByText(name)).closest('tr') as HTMLElement;
const stat = (label: string) => screen.getByText(label, { selector: 'div' }).nextElementSibling?.textContent;

describe('the school groups page', () => {
  it('is for platform admins only', async () => {
    api.role = null;
    renderPage();
    expect(await screen.findByText('Only Figbloom platform admins can see school groups.')).toBeTruthy();
    expect(api.listCalls).toBe(0);
  });

  it('lists each group with its owner, schools (linked to the Schools page), count, people, created date and status', async () => {
    renderPage();
    const hill = await rowOf('Hillside Schools');
    expect(within(hill).getByText('owner@g1.ac.ke')).toBeTruthy();
    expect(within(hill).getByRole('link', { name: 'hillside-primary' }).getAttribute('href')).toBe('/platform/schools?q=hillside-primary');
    expect(within(hill).getByText('2')).toBeTruthy();
    // joined from Figbloom Schools' list by school ID
    expect(within(hill).getByText('150 / 15 / 130')).toBeTruthy();
    expect(within(hill).getByText('1 Oct 2026')).toBeTruthy();
    expect(within(hill).getByText('Waiting for approval')).toBeTruthy();
    expect(within(await rowOf('Moi Group')).getByText('Fees unpaid')).toBeTruthy();
    // Moi Girls isn't in Schools' list: unknown, not zero
    expect(within(await rowOf('Moi Group')).getByText('—', { selector: 'td' })).toBeTruthy();
  });

  it('shows the totals', async () => {
    renderPage();
    await rowOf('Hillside Schools');
    expect(stat('Groups')).toBe('4');
    expect(stat('Waiting for approval')).toBe('1');
    expect(stat('Active')).toBe('1');
    expect(stat('Suspended or rejected')).toBe('2');
    expect(stat('No schools')).toBe('1');
  });

  it("still lists the groups when Figbloom Schools can't be read, without their people", async () => {
    api.schoolsError = new ApiError("Figbloom Schools isn't connected yet.", 503, 'schools_not_connected');
    renderPage();
    const lake = await rowOf('Lakeview Trust');
    expect(await screen.findByText(/Students, teachers and parents come from Figbloom Schools, which couldn't be reached/)).toBeTruthy();
    expect(within(lake).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('filters by status and searches by group name, school name or slug', async () => {
    renderPage();
    await rowOf('Hillside Schools');
    fireEvent.click(screen.getByRole('tab', { name: 'Suspended (1)' }));
    expect(screen.queryByText('Hillside Schools')).toBeNull();
    expect(screen.getByText('Moi Group')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    const search = screen.getByPlaceholderText('Search by group, school or slug');
    fireEvent.change(search, { target: { value: 'lakeview-junior' } });
    expect(screen.getByText('Lakeview Trust')).toBeTruthy();
    expect(screen.queryByText('Hillside Schools')).toBeNull();
    fireEvent.change(search, { target: { value: 'moi girls' } });
    expect(screen.getByText('Moi Group')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'nothing like it' } });
    expect(screen.getByText('No school groups match.')).toBeTruthy();
  });

  it('shows the switch-on banner until decisions are live', async () => {
    renderPage();
    await rowOf('Hillside Schools');
    expect(screen.getByRole('note').textContent).toBe(
      "Decisions here are recorded on the Figbloom platform. Figbloom Schools starts applying them at switch-on; until then use Schools' own console for changes that must take effect now."
    );
    cleanup();
    api.live = true;
    renderPage();
    await rowOf('Hillside Schools');
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('publishes the menu badge: groups waiting for approval', async () => {
    const published: Record<string, unknown> = {};
    renderPage((path, badge) => {
      published[path] = badge;
    });
    await waitFor(() => expect(published['/platform/school-groups']).toEqual({ count: 1, label: '1 waiting for approval' }));
  });

  it("says the platform isn't connected (503), with no retry", async () => {
    api.listErrors = [new ApiError("The Figbloom platform isn't connected to the console yet.", 503, 'platform_not_connected')];
    renderPage();
    expect(await screen.findByText("The Figbloom platform isn't connected yet")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it("says the platform didn't answer (502), and tries again", async () => {
    api.listErrors = [new ApiError("The Figbloom platform didn't answer. Try again.", 502, 'platform_unavailable')];
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await rowOf('Hillside Schools')).toBeTruthy();
    expect(api.listCalls).toBe(2);
  });
});

describe('the school groups page: decisions by role', () => {
  const actionsOf = async (name: string) => {
    const row = await rowOf(name);
    return ['Approve', 'Reject', 'Suspend', 'Reactivate'].filter((a) => within(row).queryByText(a));
  };

  it.each(['owner', 'admin'] as const)('%s approves, rejects, suspends and reactivates', async (role) => {
    api.role = role;
    renderPage();
    expect(await actionsOf('Hillside Schools')).toEqual(['Approve', 'Reject']);
    expect(await actionsOf('Lakeview Trust')).toEqual(['Suspend']);
    expect(await actionsOf('Moi Group')).toEqual(['Reactivate']);
    expect(await actionsOf('Empty Org')).toEqual(['Reactivate']);
  });

  it('support suspends and reactivates suspended groups, never approves, rejects or reactivates a rejected one', async () => {
    api.role = 'support';
    renderPage();
    expect(await actionsOf('Hillside Schools')).toEqual([]);
    expect(await actionsOf('Lakeview Trust')).toEqual(['Suspend']);
    expect(await actionsOf('Moi Group')).toEqual(['Reactivate']);
    // Empty Org was rejected: reactivating it would override that, so only Owner/Admin see it
    expect(await actionsOf('Empty Org')).toEqual([]);
  });

  it('an admin reactivates a rejected group', async () => {
    api.role = 'admin';
    renderPage();
    fireEvent.click(within(await rowOf('Empty Org')).getByText('Reactivate'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(api.decisions).toEqual([['g4', 'reactivate', '']]));
  });

  it('a viewer sees every group but decides nothing', async () => {
    api.role = 'viewer';
    renderPage();
    await rowOf('Hillside Schools');
    for (const a of ['Approve', 'Reject', 'Suspend', 'Reactivate']) expect(screen.queryByText(a)).toBeNull();
  });

  it('approves, and says Schools applies it at switch-on', async () => {
    renderPage();
    fireEvent.click(within(await rowOf('Hillside Schools')).getByText('Approve'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText("The group's 2 schools can use Figbloom Schools.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.decisions).toEqual([['g1', 'approve', '']]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Hillside Schools: active on the platform. Figbloom Schools applies it at switch-on.'));
    expect(within(await rowOf('Hillside Schools')).getByText('Active')).toBeTruthy();
  });

  it('suspends only with a reason, warning that every school in the group is suspended', async () => {
    renderPage();
    fireEvent.click(within(await rowOf('Lakeview Trust')).getByText('Suspend'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('alert').textContent).toMatch(/^Suspends all 3 schools in this group/);
    const button = within(dialog).getByRole('button', { name: 'Suspend' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Why\?/), { target: { value: 'Fees unpaid' } });
    fireEvent.click(button);
    await waitFor(() => expect(api.decisions).toEqual([['g2', 'suspend', 'Fees unpaid']]));
  });

  it('rejects only with a reason', async () => {
    renderPage();
    fireEvent.click(within(await rowOf('Hillside Schools')).getByText('Reject'));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reactivating says it restores the schools the group's suspension locked", async () => {
    api.live = true;
    renderPage();
    fireEvent.click(within(await rowOf('Moi Group')).getByText('Reactivate'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText("Restores the schools this group's suspension locked.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Moi Group: active.'));
  });

  it("shows the platform's refusal and keeps the dialog open", async () => {
    api.decisionError = new ApiError('A active organisation cannot become rejected', 409, 'invalid_transition');
    renderPage();
    fireEvent.click(within(await rowOf('Hillside Schools')).getByText('Approve'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('A active organisation cannot become rejected'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
