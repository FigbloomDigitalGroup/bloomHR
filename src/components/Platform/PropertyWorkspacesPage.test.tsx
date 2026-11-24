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
  hrEnabled: [] as string[],
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
  enablePropertyHr: (tenant: string) => {
    api.hrEnabled.push(tenant);
    return Promise.resolve({ state: 'enabling', module_status: 'active', hr_tenant_id: null });
  },
}));

import PropertyWorkspacesPage from './PropertyWorkspacesPage';
import { ConsoleBadgesContext } from '../Console/consoleBadges';

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
  api.hrEnabled = [];
  toast.success.mockReset();
  toast.error.mockReset();
});

const renderPage = (publish?: (path: string, badge: unknown) => void) =>
  render(
    <ConsoleBadgesContext.Provider value={publish ?? (() => {})}>
      <MemoryRouter>
        <PropertyWorkspacesPage />
      </MemoryRouter>
    </ConsoleBadgesContext.Provider>
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
    expect(headers).toEqual(['Workspace', 'Status', 'Owner', 'Plan', 'Properties', 'Units', 'Created', 'HR & Payroll', '']);
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

  it.each(['owner', 'admin', 'support'] as const)('%s suspends and reactivates', async (role) => {
    api.role = role;
    renderPage();
    expect(await actionsOf('Kilimani Homes')).toEqual(['Suspend']);
    expect(await actionsOf('Paused Estates')).toEqual(['Reactivate']);
    expect(await actionsOf('Fresh Start')).toEqual([]);
  });

  it('a viewer sees every workspace but changes nothing', async () => {
    api.role = 'viewer';
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

describe('HR & Payroll per workspace (ERP/PROPERTY_HR_CONTRACT.md)', () => {
  const withHr = () => {
    api.workspaces = [
      workspace('w1', 'Kilimani Homes', 'active', { platform_tenant_id: 't-1', hr: { state: 'off', module_status: null, hr_tenant_id: null } }),
      workspace('w2', 'Paused Estates', 'suspended', { platform_tenant_id: 't-2', hr: { state: 'on', module_status: 'active', hr_tenant_id: 'hr-2' } }),
      workspace('w3', 'Fresh Start', null, { platform_tenant_id: null, hr: null }),
    ];
  };

  it('shows Off / On, and nothing for a workspace without a platform account', async () => {
    withHr();
    renderPage();
    expect(within(await rowOf('Kilimani Homes')).getByText('Off')).toBeTruthy();
    expect(within(await rowOf('Paused Estates')).getByText('On')).toBeTruthy();
    expect(within(await rowOf('Fresh Start')).queryByRole('button', { name: /Enable HR/ })).toBeNull();
  });

  it("an owner enables it: the platform is asked, the workspace shows Enabling, and the creator is invited", async () => {
    withHr();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Enable HR & Payroll for Kilimani Homes' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/emails the workspace's creator an invitation/)).toBeTruthy();
    expect(within(dialog).getByText(/Tenants and landlords never are/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(api.hrEnabled).toEqual(['t-1']));
    expect(within(await rowOf('Kilimani Homes')).getByText('Enabling')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("invites the workspace's creator"));
  });

  it('the detail panel shows it too', async () => {
    withHr();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Paused Estates' }));
    const details = within(await screen.findByRole('dialog')).getByLabelText('Workspace details');
    expect(within(details).getByText('HR & Payroll')).toBeTruthy();
    expect(within(details).getByText('On')).toBeTruthy();
  });

  const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
  const withRequests = () => {
    withHr();
    api.workspaces[0] = { ...api.workspaces[0], hr_requested_at: daysAgo(1) };
    // already on: the request is done, nothing shows
    api.workspaces[1] = { ...api.workspaces[1], hr_requested_at: daysAgo(9) };
    // no platform account yet: still asked for
    api.workspaces[2] = { ...api.workspaces[2], hr_requested_at: daysAgo(3) };
  };

  it('shows "Requested …" beside Off when the customer asked for HR in Property, and a chip lists those waiting', async () => {
    withRequests();
    const published: Record<string, unknown> = {};
    renderPage((path, badge) => {
      published[path] = badge;
    });
    const kilimani = await rowOf('Kilimani Homes');
    expect(within(kilimani).getByText('Off')).toBeTruthy();
    expect(within(kilimani).getByText('Requested yesterday')).toBeTruthy();
    expect(within(await rowOf('Fresh Start')).getByText('Requested 3 days ago')).toBeTruthy();
    expect(within(await rowOf('Paused Estates')).queryByText(/^Requested/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'HR requested (2)' }));
    const names = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('button')[0].textContent);
    expect(names).toEqual(['Fresh Start', 'Kilimani Homes']);
    await waitFor(() =>
      expect(published['/platform/property/workspaces']).toEqual({ count: 2, label: '2 asking for HR & Payroll' })
    );
  });

  it('the detail panel shows the request too', async () => {
    withRequests();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Kilimani Homes' }));
    const details = within(await screen.findByRole('dialog')).getByLabelText('Workspace details');
    expect(within(details).getByText('Requested yesterday')).toBeTruthy();
  });

  it('no chip and no menu badge without requests', async () => {
    withHr();
    const published: Record<string, unknown> = {};
    renderPage((path, badge) => {
      published[path] = badge;
    });
    await rowOf('Kilimani Homes');
    expect(screen.queryByRole('button', { name: /HR requested/ })).toBeNull();
    await waitFor(() => expect('/platform/property/workspaces' in published).toBe(true));
    expect(published['/platform/property/workspaces']).toBeNull();
  });

  it.each(['support', 'viewer'] as const)('%s sees the state but cannot enable it (HR is a paid add-on)', async (role) => {
    withHr();
    api.role = role;
    renderPage();
    expect(within(await rowOf('Kilimani Homes')).getByText('Off')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Enable HR/ })).toBeNull();
  });
});
