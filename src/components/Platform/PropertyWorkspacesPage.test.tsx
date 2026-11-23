import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../lib/adminApi';
import type { PropertyWorkspace, PropertyWorkspacesList } from '../../lib/platformProperty';

const api = vi.hoisted(() => ({
  role: 'owner' as import('../../lib/platformRoles').PlatformRole | null,
  workspaces: [] as PropertyWorkspace[],
  platform: { ok: true } as PropertyWorkspacesList['platform'],
  listErrors: [] as Error[],
  listCalls: 0,
  decisions: [] as unknown[][],
  decisionError: null as Error | null,
  detail: null as PropertyWorkspace | null,
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toast }));
vi.mock('../../lib/platformRoles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformRoles')>()),
  myPlatformRole: () => Promise.resolve(api.role),
}));
vi.mock('../../lib/platformProperty', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformProperty')>()),
  listPropertyWorkspaces: () => {
    api.listCalls += 1;
    const error = api.listErrors.shift();
    return error ? Promise.reject(error) : Promise.resolve({ workspaces: api.workspaces, truncated: false, platform: api.platform });
  },
  getPropertyWorkspace: (id: string) => (api.detail && api.detail.id === id ? Promise.resolve(api.detail) : Promise.reject(new Error('no'))),
  setPropertyWorkspaceStatus: (id: string, action: string, reason: string) => {
    api.decisions.push([id, action, reason]);
    if (api.decisionError) return Promise.reject(api.decisionError);
    const to = action === 'suspend' ? 'suspended' : 'active';
    return Promise.resolve({ organization_id: id, status: to, status_reason: reason.trim() || null });
  },
}));

import PropertyWorkspacesPage from './PropertyWorkspacesPage';

function workspace(id: string, name: string, status: string | null, extra: Partial<PropertyWorkspace> = {}): PropertyWorkspace {
  return {
    id, name, slug: name.toLowerCase().replace(/\s+/g, '-'), property_active: true, created_at: '2026-10-01T08:00:00Z',
    creator_name: `Owner ${name}`, creator_email: `owner@${id}.co.ke`, plan_name: 'Growth', plan_status: 'active', trial_ends_at: null,
    properties: 4, units: 60, occupied_units: 52, team_members: 3, tenants: 55,
    platform_organization_id: status ? `org-${id}` : null, platform_tenant_id: status ? `t-${id}` : null, registered_at: null,
    in_property: true, organization_id: status ? `org-${id}` : null, status, status_reason: null,
    ...extra,
  };
}

afterEach(cleanup);
beforeEach(() => {
  api.role = 'owner';
  api.platform = { ok: true };
  api.workspaces = [
    workspace('w1', 'Kilimani Homes', 'active'),
    workspace('w2', 'Paused Estates', 'suspended', { property_active: false, status_reason: 'Unpaid' }),
    workspace('w3', 'Fresh Start', null, { plan_name: 'Trial', plan_status: 'trialing', trial_ends_at: '2026-12-07T00:00:00Z', units: 0, properties: 0 }),
    workspace('w4', 'Owner Off', 'active', { property_active: false }),
  ];
  api.listErrors = [];
  api.listCalls = 0;
  api.decisions = [];
  api.decisionError = null;
  api.detail = null;
  toast.success.mockReset();
  toast.error.mockReset();
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <PropertyWorkspacesPage />
    </MemoryRouter>
  );
const rowOf = async (name: string) => (await screen.findByRole('button', { name })).closest('tr') as HTMLElement;
const stat = (label: string) => screen.getByText(label, { selector: 'div' }).nextElementSibling?.textContent;

describe('the Property workspaces page', () => {
  it('is for platform admins only', async () => {
    api.role = null;
    renderPage();
    expect(await screen.findByText('Only Figbloom platform admins can see Property workspaces.')).toBeTruthy();
    expect(api.listCalls).toBe(0);
  });

  it("lists each workspace with Property's summary and its status", async () => {
    renderPage();
    const kilimani = await rowOf('Kilimani Homes');
    expect(within(kilimani).getByText('kilimani-homes')).toBeTruthy();
    expect(within(kilimani).getByText('Active')).toBeTruthy();
    expect(within(kilimani).getByText('Owner Kilimani Homes')).toBeTruthy();
    expect(within(kilimani).getByText('owner@w1.co.ke')).toBeTruthy();
    expect(within(kilimani).getByText('Growth (paying)')).toBeTruthy();
    expect(within(kilimani).getByText('60')).toBeTruthy();
    expect(within(kilimani).getByText('1 Oct 2026')).toBeTruthy();
    expect(within(await rowOf('Paused Estates')).getByText('Unpaid')).toBeTruthy();
    // not on the platform yet: Property's own status, and nothing to do yet
    const fresh = await rowOf('Fresh Start');
    expect(within(fresh).getByText('Active')).toBeTruthy();
    expect(within(fresh).getByText('Trial')).toBeTruthy();
    expect(within(fresh).queryByText('Suspend')).toBeNull();
  });

  it('shows a workspace its owner switched off as deactivated by owner, not suspended', async () => {
    renderPage();
    const off = await rowOf('Owner Off');
    expect(within(off).getByText('Deactivated by owner')).toBeTruthy();
    expect(within(off).queryByText('Suspended')).toBeNull();
    // the platform still has it active: it can be suspended, not reactivated
    expect(within(off).getByText('Suspend')).toBeTruthy();
    expect(within(off).queryByText('Reactivate')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Owner Off' }));
    expect(await within(await screen.findByRole('dialog')).findByText(/Its owner switched this workspace off in Figbloom Property/)).toBeTruthy();
  });

  it('never shows tenant names, leases or payments: the table has no such column', async () => {
    renderPage();
    await rowOf('Kilimani Homes');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Workspace', 'Status', 'Owner', 'Plan', 'Properties', 'Units', 'Created', '']);
  });

  it('shows the totals, and has no create button', async () => {
    renderPage();
    await rowOf('Kilimani Homes');
    expect(stat('Workspaces')).toBe('4');
    expect(stat('Active')).toBe('2');
    expect(stat('Suspended')).toBe('1');
    expect(stat('Deactivated by owner')).toBe('1');
    expect(screen.queryByRole('button', { name: /New/ })).toBeNull();
  });

  it('filters by status and searches by workspace or owner', async () => {
    renderPage();
    await rowOf('Kilimani Homes');
    fireEvent.click(screen.getByRole('tab', { name: 'Suspended (1)' }));
    expect(screen.queryByRole('button', { name: 'Kilimani Homes' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Paused Estates' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Deactivated by owner (1)' }));
    expect(screen.getByRole('button', { name: 'Owner Off' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Paused Estates' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    const search = screen.getByPlaceholderText('Search by workspace or owner');
    fireEvent.change(search, { target: { value: 'owner@w2' } });
    expect(screen.getByRole('button', { name: 'Paused Estates' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Kilimani Homes' })).toBeNull();
    fireEvent.change(search, { target: { value: 'nothing like it' } });
    expect(screen.getByText('No workspaces match.')).toBeTruthy();
  });

  it("opens a workspace's details with its counts, refreshed from Property", async () => {
    api.detail = workspace('w1', 'Kilimani Homes', 'active', { tenants: 56 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Kilimani Homes' }));
    const dialog = await screen.findByRole('dialog');
    const details = within(dialog).getByLabelText('Workspace details');
    expect(within(details).getByText('Occupied units')).toBeTruthy();
    expect(within(details).getByText('52')).toBeTruthy();
    expect(within(details).getByText('Team members')).toBeTruthy();
    expect(await within(details).findByText('56')).toBeTruthy();
    expect(within(details).getByText('org-w1')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Suspend' })).toBeTruthy();
  });

  it('before Property has registered it: Suspend is off, and says why', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Fresh Start' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('not registered yet')).toBeTruthy();
    expect(within(dialog).getByText('Trial ends')).toBeTruthy();
    expect(within(dialog).getByRole('note').textContent).toMatch(/registers a new workspace with the Figbloom platform within a minute/);
    expect((within(dialog).getByRole('button', { name: 'Suspend' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says Property isn't connected to the console yet (503), with no retry", async () => {
    api.listErrors = [new ApiError("Figbloom Property isn't connected to the console yet.", 503, 'property_not_connected')];
    renderPage();
    expect(await screen.findByText("Property isn't connected to the console yet")).toBeTruthy();
    expect(screen.getByText(/PROPERTY_PLATFORM_URL and PROPERTY_PLATFORM_SECRET/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it("says Property didn't answer (502), and tries again", async () => {
    api.listErrors = [new ApiError("Figbloom Property didn't answer. Try again.", 502, 'property_unavailable')];
    renderPage();
    expect(await screen.findByText("Figbloom Property didn't answer, try again")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await rowOf('Kilimani Homes')).toBeTruthy();
    expect(api.listCalls).toBe(2);
  });

  it('without the platform, lists the workspaces with a note, and offers no actions', async () => {
    api.platform = { ok: false, code: 'platform_not_connected', message: "The Figbloom platform isn't connected to the console yet." };
    api.workspaces = api.workspaces.map((w) => ({ ...w, status: null, organization_id: null }));
    renderPage();
    await rowOf('Kilimani Homes');
    expect(screen.getByRole('note').textContent).toMatch(/The Figbloom platform isn't connected to the console/);
    expect(within(await rowOf('Paused Estates')).getByText('Inactive')).toBeTruthy();
    for (const a of ['Suspend', 'Reactivate']) expect(screen.queryByText(a)).toBeNull();
  });
});

describe('the Property workspaces page: suspend and reactivate by role', () => {
  const actionsOf = async (name: string) => {
    const row = await rowOf(name);
    return ['Suspend', 'Reactivate'].filter((a) => within(row).queryByText(a));
  };

  it.each(['owner', 'admin'] as const)('%s suspends and reactivates', async (role) => {
    api.role = role;
    renderPage();
    expect(await actionsOf('Kilimani Homes')).toEqual(['Suspend']);
    expect(await actionsOf('Paused Estates')).toEqual(['Reactivate']);
    expect(await actionsOf('Fresh Start')).toEqual([]);
  });

  it.each(['support', 'viewer'] as const)('%s sees every workspace but changes nothing', async (role) => {
    api.role = role;
    renderPage();
    await rowOf('Kilimani Homes');
    for (const a of ['Suspend', 'Reactivate']) expect(screen.queryByText(a)).toBeNull();
  });

  it("suspends only with a reason, on the platform (by the platform's ID), and the row follows", async () => {
    renderPage();
    fireEvent.click(within(await rowOf('Kilimani Homes')).getByText('Suspend'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('alert').textContent).toMatch(/^Suspends the workspace/);
    const button = within(dialog).getByRole('button', { name: 'Suspend' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Why\?/), { target: { value: 'Unpaid' } });
    fireEvent.click(button);
    await waitFor(() => expect(api.decisions).toEqual([['org-w1', 'suspend', 'Unpaid']]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Kilimani Homes: suspended. Figbloom Property applies it within a minute.'));
    expect(within(await rowOf('Kilimani Homes')).getByText('Suspended')).toBeTruthy();
  });

  it('reactivates without a reason, and the row shows active (not deactivated by owner) at once', async () => {
    renderPage();
    fireEvent.click(within(await rowOf('Paused Estates')).getByText('Reactivate'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(api.decisions).toEqual([['org-w2', 'reactivate', '']]));
    await waitFor(async () => expect(within(await rowOf('Paused Estates')).getByText('Active')).toBeTruthy());
  });

  it("shows the platform's refusal and keeps the dialog open", async () => {
    api.decisionError = new ApiError("An active workspace can't be reactivated.", 409, 'invalid_transition');
    renderPage();
    fireEvent.click(within(await rowOf('Paused Estates')).getByText('Reactivate'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("An active workspace can't be reactivated."));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
