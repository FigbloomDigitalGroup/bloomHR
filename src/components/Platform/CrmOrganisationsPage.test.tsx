import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../lib/adminApi';
import type { CrmOrganisation, CrmOrganisationsList, NewCrmOrganisation } from '../../lib/platformCrm';

const api = vi.hoisted(() => ({
  role: 'owner' as import('../../lib/platformRoles').PlatformRole | null,
  organisations: [] as CrmOrganisation[],
  platform: { ok: true } as CrmOrganisationsList['platform'],
  listErrors: [] as Error[],
  listCalls: 0,
  decisions: [] as unknown[][],
  decisionError: null as Error | null,
  created: [] as NewCrmOrganisation[],
  createError: null as Error | null,
  detail: null as CrmOrganisation | null,
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toast }));
vi.mock('../../lib/platformRoles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformRoles')>()),
  myPlatformRole: () => Promise.resolve(api.role),
}));
vi.mock('../../lib/platformCrm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformCrm')>()),
  listCrmOrganisations: () => {
    api.listCalls += 1;
    const error = api.listErrors.shift();
    return error ? Promise.reject(error) : Promise.resolve({ organizations: api.organisations, truncated: false, platform: api.platform });
  },
  getCrmOrganisation: (id: string) => (api.detail && api.detail.id === id ? Promise.resolve(api.detail) : Promise.reject(new Error('no'))),
  setCrmOrganisationStatus: (id: string, action: string, reason: string) => {
    api.decisions.push([id, action, reason]);
    if (api.decisionError) return Promise.reject(api.decisionError);
    const to = action === 'suspend' ? 'suspended' : 'active';
    return Promise.resolve({ organization_id: id, status: to, status_reason: reason.trim() || null });
  },
  createCrmOrganisation: (input: NewCrmOrganisation) => {
    api.created.push(input);
    if (api.createError) return Promise.reject(api.createError);
    return Promise.resolve(organisation('new1', 'Acme Insurance', null, {
      slug: 'acme', admin_name: input.adminName, admin_email: input.adminEmail, active_members: 0, pending_invitations: 1,
    }));
  },
}));

import CrmOrganisationsPage from './CrmOrganisationsPage';

function organisation(id: string, name: string, status: string | null, extra: Partial<CrmOrganisation> = {}): CrmOrganisation {
  return {
    id, name, slug: name.toLowerCase().replace(/\s+/g, '-'), crm_status: status ?? 'active', created_at: '2026-10-01T08:00:00Z',
    admin_name: `Admin ${name}`, admin_email: `admin@${id}.co.ke`,
    active_members: 7, pending_invitations: 1, leads: 120, open_deals: 9, companies: 40, last_activity_at: '2026-11-18T07:55:00Z',
    platform_organization_id: status ? `org-${id}` : null, in_crm: true, organization_id: status ? `org-${id}` : null, status, status_reason: null,
    ...extra,
  };
}

afterEach(cleanup);
beforeEach(() => {
  api.role = 'owner';
  api.platform = { ok: true };
  api.organisations = [
    organisation('o1', 'Figbloom', 'active'),
    organisation('o2', 'Paused Ltd', 'suspended', { crm_status: 'suspended', status_reason: 'Unpaid' }),
    organisation('o3', 'Fresh Start', null, { admin_name: null, admin_email: null, active_members: 0, last_activity_at: null }),
  ];
  api.listErrors = [];
  api.listCalls = 0;
  api.decisions = [];
  api.decisionError = null;
  api.created = [];
  api.createError = null;
  api.detail = null;
  toast.success.mockReset();
  toast.error.mockReset();
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <CrmOrganisationsPage />
    </MemoryRouter>
  );
const rowOf = async (name: string) => (await screen.findByRole('button', { name })).closest('tr') as HTMLElement;
const stat = (label: string) => screen.getByText(label, { selector: 'div' }).nextElementSibling?.textContent;

describe('the CRM organisations page', () => {
  it('is for platform admins only', async () => {
    api.role = null;
    renderPage();
    expect(await screen.findByText('Only Figbloom platform admins can see CRM organisations.')).toBeTruthy();
    expect(api.listCalls).toBe(0);
  });

  it("lists each organisation with CRM's summary and its status", async () => {
    renderPage();
    const figbloom = await rowOf('Figbloom');
    expect(within(figbloom).getByText('figbloom')).toBeTruthy();
    expect(within(figbloom).getByText('Active')).toBeTruthy();
    expect(within(figbloom).getByText('Admin Figbloom')).toBeTruthy();
    expect(within(figbloom).getByText('admin@o1.co.ke')).toBeTruthy();
    expect(within(figbloom).getByText('7')).toBeTruthy();
    expect(within(figbloom).getByText('1 Oct 2026')).toBeTruthy();
    expect(within(await rowOf('Paused Ltd')).getByText('Unpaid')).toBeTruthy();
    // not on the platform yet: CRM's own status, and nothing to do yet
    const fresh = await rowOf('Fresh Start');
    expect(within(fresh).getByText('Active')).toBeTruthy();
    expect(within(fresh).queryByText('Suspend')).toBeNull();
  });

  it('never shows deal values or customer data: the table has no such column', async () => {
    renderPage();
    await rowOf('Figbloom');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Organisation', 'Slug', 'Status', 'Admin', 'Members', 'Last activity', 'Created', '']);
  });

  it('shows the totals', async () => {
    renderPage();
    await rowOf('Figbloom');
    expect(stat('Organisations')).toBe('3');
    expect(stat('Active')).toBe('2');
    expect(stat('Suspended')).toBe('1');
  });

  it('filters by status and searches by organisation or admin', async () => {
    renderPage();
    await rowOf('Figbloom');
    fireEvent.click(screen.getByRole('tab', { name: 'Suspended (1)' }));
    expect(screen.queryByRole('button', { name: 'Figbloom' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Paused Ltd' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    const search = screen.getByPlaceholderText('Search by organisation or admin');
    fireEvent.change(search, { target: { value: 'admin@o2' } });
    expect(screen.getByRole('button', { name: 'Paused Ltd' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Figbloom' })).toBeNull();
    fireEvent.change(search, { target: { value: 'nothing like it' } });
    expect(screen.getByText('No organisations match.')).toBeTruthy();
  });

  it("opens an organisation's details with its counts, refreshed from CRM", async () => {
    api.detail = organisation('o1', 'Figbloom', 'active', { leads: 121 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Figbloom' }));
    const dialog = await screen.findByRole('dialog');
    const details = within(dialog).getByLabelText('Organisation details');
    expect(within(details).getByText('Pending invitations')).toBeTruthy();
    expect(within(details).getByText('Open deals')).toBeTruthy();
    expect(within(details).getByText('40')).toBeTruthy();
    expect(await within(details).findByText('121')).toBeTruthy();
    expect(within(details).getByText('org-o1')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Suspend' })).toBeTruthy();
  });

  it("before CRM has registered it: Suspend is off, and says why", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Fresh Start' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('not registered yet')).toBeTruthy();
    expect(within(dialog).getByRole('note').textContent).toMatch(/registers a new organisation with the Figbloom platform within a minute/);
    expect((within(dialog).getByRole('button', { name: 'Suspend' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says CRM isn't connected to the console yet (503), with no retry", async () => {
    api.listErrors = [new ApiError("Figbloom CRM isn't connected to the console yet.", 503, 'crm_not_connected')];
    renderPage();
    expect(await screen.findByText("CRM isn't connected to the console yet")).toBeTruthy();
    expect(screen.getByText(/CRM_PLATFORM_URL and CRM_PLATFORM_SECRET/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New organisation' })).toBeNull();
  });

  it("says CRM didn't answer (502), and tries again", async () => {
    api.listErrors = [new ApiError("Figbloom CRM didn't answer. Try again.", 502, 'crm_unavailable')];
    renderPage();
    expect(await screen.findByText("Figbloom CRM didn't answer, try again")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await rowOf('Figbloom')).toBeTruthy();
    expect(api.listCalls).toBe(2);
  });

  it('without the platform, lists the organisations with a note, and offers no actions', async () => {
    api.platform = { ok: false, code: 'platform_not_connected', message: "The Figbloom platform isn't connected to the console yet." };
    api.organisations = api.organisations.map((o) => ({ ...o, status: null, organization_id: null }));
    renderPage();
    await rowOf('Figbloom');
    expect(screen.getByRole('note').textContent).toMatch(/The Figbloom platform isn't connected to the console/);
    for (const a of ['Suspend', 'Reactivate']) expect(screen.queryByText(a)).toBeNull();
  });
});

describe('the CRM organisations page: suspend and reactivate by role', () => {
  const actionsOf = async (name: string) => {
    const row = await rowOf(name);
    return ['Suspend', 'Reactivate'].filter((a) => within(row).queryByText(a));
  };

  it.each(['owner', 'admin'] as const)('%s suspends and reactivates', async (role) => {
    api.role = role;
    renderPage();
    expect(await actionsOf('Figbloom')).toEqual(['Suspend']);
    expect(await actionsOf('Paused Ltd')).toEqual(['Reactivate']);
    expect(await actionsOf('Fresh Start')).toEqual([]);
  });

  it.each(['support', 'viewer'] as const)('%s sees every organisation but changes nothing, and creates nothing', async (role) => {
    api.role = role;
    renderPage();
    await rowOf('Figbloom');
    for (const a of ['Suspend', 'Reactivate']) expect(screen.queryByText(a)).toBeNull();
    expect(screen.queryByRole('button', { name: 'New organisation' })).toBeNull();
  });

  it("suspends only with a reason, on the platform (by the platform's ID), and the row follows", async () => {
    renderPage();
    fireEvent.click(within(await rowOf('Figbloom')).getByText('Suspend'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('alert').textContent).toMatch(/^Suspends the organisation/);
    const button = within(dialog).getByRole('button', { name: 'Suspend' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Why\?/), { target: { value: 'Unpaid' } });
    fireEvent.click(button);
    await waitFor(() => expect(api.decisions).toEqual([['org-o1', 'suspend', 'Unpaid']]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Figbloom: suspended. Figbloom CRM applies it within a minute.'));
    expect(within(await rowOf('Figbloom')).getByText('Suspended')).toBeTruthy();
  });

  it('reactivates without a reason', async () => {
    renderPage();
    fireEvent.click(within(await rowOf('Paused Ltd')).getByText('Reactivate'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(api.decisions).toEqual([['org-o2', 'reactivate', '']]));
  });

  it("shows the platform's refusal and keeps the dialog open", async () => {
    api.decisionError = new ApiError("An active organisation can't be reactivated.", 409, 'invalid_transition');
    renderPage();
    fireEvent.click(within(await rowOf('Paused Ltd')).getByText('Reactivate'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("An active organisation can't be reactivated."));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('New organisation', () => {
  const fill = (dialog: HTMLElement, values: Record<string, string>) => {
    for (const [label, value] of Object.entries(values)) fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
  };

  it('creates it through CRM, and it appears in the list', async () => {
    renderPage();
    await rowOf('Figbloom');
    fireEvent.click(screen.getByRole('button', { name: 'New organisation' }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Create organisation' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fill(dialog, { 'Organisation name': 'Acme Insurance', "Admin's name": 'Wanjiru Kamau', "Admin's email": 'wanjiru@acme.co.ke' });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(api.created).toEqual([{ name: 'Acme Insurance', slug: '', adminName: 'Wanjiru Kamau', adminEmail: 'wanjiru@acme.co.ke' }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('Acme Insurance created in Figbloom CRM. wanjiru@acme.co.ke has been invited.');
    expect(within(await rowOf('Acme Insurance')).getByText('acme')).toBeTruthy();
    expect(stat('Organisations')).toBe('4');
  });

  it("shows the API's field errors next to their fields, and keeps the form", async () => {
    api.createError = new ApiError('That slug is taken', 409, 'slug_taken', [{ path: 'slug', message: 'That slug is taken' }]);
    renderPage();
    await rowOf('Figbloom');
    fireEvent.click(screen.getByRole('button', { name: 'New organisation' }));
    const dialog = await screen.findByRole('dialog');
    fill(dialog, { 'Organisation name': 'Acme', 'Slug (optional)': 'figbloom', "Admin's name": 'W', "Admin's email": 'w@acme.co.ke' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create organisation' }));
    const slug = within(dialog).getByLabelText('Slug (optional)');
    await waitFor(() => expect(slug.getAttribute('aria-invalid')).toBe('true'));
    expect(within(dialog).getByText('That slug is taken')).toBeTruthy();
    // the same message isn't repeated under the form
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(within(dialog).getByLabelText('Organisation name').getAttribute('aria-invalid')).toBeNull();
    expect((within(dialog).getByLabelText('Organisation name') as HTMLInputElement).value).toBe('Acme');
  });

  it('shows any other refusal under the form', async () => {
    api.createError = new ApiError("Figbloom CRM didn't answer. Try again.", 502, 'crm_unavailable');
    renderPage();
    await rowOf('Figbloom');
    fireEvent.click(screen.getByRole('button', { name: 'New organisation' }));
    const dialog = await screen.findByRole('dialog');
    fill(dialog, { 'Organisation name': 'Acme', "Admin's name": 'W', "Admin's email": 'w@acme.co.ke' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create organisation' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe("Figbloom CRM didn't answer. Try again.");
  });
});
