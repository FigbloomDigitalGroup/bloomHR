import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../../lib/adminApi';
import type { School } from '../../lib/platformSchools';

const api = vi.hoisted(() => ({
  admin: true,
  role: 'owner' as import('../../lib/platformRoles').PlatformRole,
  schools: [] as School[],
  // what listing does instead of answering: an error to throw, once per entry, before answering
  listErrors: [] as Error[],
  listCalls: 0,
  changes: [] as unknown[][],
  changeError: null as Error | null,
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toast }));
vi.mock('../../lib/platformRoles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformRoles')>()),
  myPlatformRole: () => Promise.resolve(api.admin ? api.role : null),
}));
vi.mock('../../lib/platformSchools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformSchools')>()),
  listSchools: () => {
    api.listCalls += 1;
    const error = api.listErrors.shift();
    return error ? Promise.reject(error) : Promise.resolve({ generated_at: '2026-11-02T10:00:00Z', schools: api.schools });
  },
  setSchoolStatus: (id: string, status: string, reason: string) => {
    api.changes.push([id, status, reason]);
    if (api.changeError) return Promise.reject(api.changeError);
    const s = api.schools.find((x) => x.id === id)!;
    return Promise.resolve({ ...s, status, status_reason: status === 'suspended' ? reason.trim() : null });
  },
}));

import SchoolsPage from './SchoolsPage';

const school = (name: string, id: string, status: string, extra: Partial<School> = {}): School => ({
  id, name, slug: name.toLowerCase().replace(/ /g, '-'), status, status_reason: null, organization: null,
  created_at: '2026-09-14T08:00:00Z', admin_email: null, students: 0, teachers: 0, parents: 0, last_activity_at: null, ...extra,
});

afterEach(cleanup);
beforeEach(() => {
  api.admin = true;
  api.role = 'owner';
  api.schools = [
    school('Kilimani Secondary', '6f1c2b9e-1d2a-4c3b-9e8f-0a1b2c3d4e5f', 'active', {
      organization: { id: 'g1', name: 'Nairobi Group' }, admin_email: 'head@kilimani.ac.ke', students: 412, teachers: 23, parents: 380,
      last_activity_at: '2026-11-01T17:22:00Z',
    }),
    school('Lavington Primary', 'a2b3c4d5-0000-4000-8000-000000000001', 'suspended', { status_reason: 'Unpaid invoice', students: 100 }),
    school('Ruiru Academy', 'c0ffee00-0000-4000-8000-000000000002', 'archived', { students: 5 }),
  ];
  api.listErrors = [];
  api.listCalls = 0;
  api.changes = [];
  api.changeError = null;
  toast.success.mockReset();
  toast.error.mockReset();
});

// a school's name also shows in the analytics (top schools, needs attention): its row is the one in the table
const rowOf = async (name: string) =>
  (await screen.findAllByText(name)).map((e) => e.closest('tr')).find(Boolean) as HTMLElement;
// the schools table (names also show in the analytics above it)
const inTable = () => within(screen.getByRole('table'));
// a total: the figure under its label
const stat = (label: string) => screen.getByText(label, { selector: 'div' }).nextElementSibling?.textContent;

describe('the schools page', () => {
  it('is for platform admins only', async () => {
    api.admin = false;
    render(<SchoolsPage />);
    expect(await screen.findByText('Only Figbloom platform admins can see schools.')).toBeTruthy();
    expect(api.listCalls).toBe(0);
  });

  it('shows a loader while the schools load', async () => {
    render(<SchoolsPage />);
    expect(await screen.findByText('Loading schools')).toBeTruthy();
    await rowOf('Kilimani Secondary');
  });

  it('lists every school with its group, admin, counts, activity and status, and the totals', async () => {
    render(<SchoolsPage />);
    const kilimani = await rowOf('Kilimani Secondary');
    expect(within(kilimani).getByText('Nairobi Group')).toBeTruthy();
    expect(within(kilimani).getByText('head@kilimani.ac.ke')).toBeTruthy();
    expect(within(kilimani).getByText('412')).toBeTruthy();
    expect(within(kilimani).getByText('23')).toBeTruthy();
    expect(within(kilimani).getByText('380')).toBeTruthy();
    expect(within(kilimani).getByText('1 Nov 2026')).toBeTruthy();
    expect(within(kilimani).getByText('Active')).toBeTruthy();
    const lavington = await rowOf('Lavington Primary');
    expect(within(lavington).getByText('Suspended')).toBeTruthy();
    expect(within(lavington).getByText('Unpaid invoice')).toBeTruthy();
    expect(within(lavington).getByText('Never')).toBeTruthy();
    // a status Schools has that the console doesn't know: shown as it comes
    expect(within(await rowOf('Ruiru Academy')).getByText('Archived')).toBeTruthy();

    expect(stat('Schools')).toBe('3');
    expect(stat('Active')).toBe('1');
    expect(stat('Suspended')).toBe('1');
    expect(stat('Students')).toBe('517');
  });

  it("shows each school's slug and short ID, and copies the full ID", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<SchoolsPage />);
    const kilimani = await rowOf('Kilimani Secondary');
    expect(within(kilimani).getByText('kilimani-secondary · 6f1c2b9e')).toBeTruthy();
    fireEvent.click(within(kilimani).getByRole('button', { name: "Copy Kilimani Secondary's ID" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('6f1c2b9e-1d2a-4c3b-9e8f-0a1b2c3d4e5f'));
  });

  it('filters by status, with a tab for any other status, and searches by name, slug or ID', async () => {
    render(<SchoolsPage />);
    await rowOf('Kilimani Secondary');
    fireEvent.click(screen.getByRole('tab', { name: 'Suspended (1)' }));
    expect(inTable().queryByText('Kilimani Secondary')).toBeNull();
    expect(inTable().getByText('Lavington Primary')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Archived (1)' }));
    expect(inTable().getByText('Ruiru Academy')).toBeTruthy();
    expect(inTable().queryByText('Lavington Primary')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));

    const search = screen.getByPlaceholderText('Search by name, slug or ID');
    fireEvent.change(search, { target: { value: 'lavington' } });
    expect(inTable().getByText('Lavington Primary')).toBeTruthy();
    expect(inTable().queryByText('Kilimani Secondary')).toBeNull();
    fireEvent.change(search, { target: { value: 'kilimani-sec' } });
    expect(inTable().getByText('Kilimani Secondary')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'C0FFEE' } });
    expect(inTable().getByText('Ruiru Academy')).toBeTruthy();
    expect(inTable().queryByText('Kilimani Secondary')).toBeNull();
    fireEvent.change(search, { target: { value: 'nothing like it' } });
    expect(screen.getByText('No schools match.')).toBeTruthy();
  });

  it('says so when there are no schools yet', async () => {
    api.schools = [];
    render(<SchoolsPage />);
    expect(await screen.findByText('No schools on Figbloom Schools yet.')).toBeTruthy();
  });

  it("says Figbloom Schools isn't connected yet (503), with no retry", async () => {
    api.listErrors = [new ApiError("Figbloom Schools isn't connected yet.", 503, 'schools_not_connected')];
    render(<SchoolsPage />);
    expect(await screen.findByText("Figbloom Schools isn't connected yet")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it("says Figbloom Schools didn't answer (502), and tries again", async () => {
    api.listErrors = [new ApiError("Figbloom Schools didn't answer in time. Try again.", 502, 'schools_unavailable')];
    render(<SchoolsPage />);
    expect(await screen.findByText("Figbloom Schools didn't answer, try again")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await rowOf('Kilimani Secondary')).toBeTruthy();
    expect(api.listCalls).toBe(2);
  });

  it('shows any other error with a retry', async () => {
    api.listErrors = [new ApiError('Your console role can\'t see schools.', 403, 'forbidden')];
    render(<SchoolsPage />);
    expect(await screen.findByText('Could not load the schools')).toBeTruthy();
    expect(screen.getByText("Your console role can't see schools.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('the schools page: suspending and reactivating', () => {
  it('suspends only with a reason, and shows the school as suspended', async () => {
    render(<SchoolsPage />);
    fireEvent.click(within(await rowOf('Kilimani Secondary')).getByText('Suspend'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Suspend Kilimani Secondary?')).toBeTruthy();
    const button = within(dialog).getByRole('button', { name: 'Suspend' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Why\?/), { target: { value: '   ' } });
    expect(button.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Why\?/), { target: { value: 'Unpaid invoice' } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(api.changes).toEqual([['6f1c2b9e-1d2a-4c3b-9e8f-0a1b2c3d4e5f', 'suspended', 'Unpaid invoice']]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const kilimani = await rowOf('Kilimani Secondary');
    expect(within(kilimani).getByText('Suspended')).toBeTruthy();
    expect(within(kilimani).getByText('Unpaid invoice')).toBeTruthy();
    expect(within(kilimani).getByText('Reactivate')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith('Kilimani Secondary: suspended.');
  });

  it('reactivates without needing a reason', async () => {
    render(<SchoolsPage />);
    fireEvent.click(within(await rowOf('Lavington Primary')).getByText('Reactivate'));
    const dialog = await screen.findByRole('dialog');
    const button = within(dialog).getByRole('button', { name: 'Reactivate' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(api.changes).toEqual([['a2b3c4d5-0000-4000-8000-000000000001', 'active', '']]));
    await waitFor(async () => expect(within(await rowOf('Lavington Primary')).getByText('Active')).toBeTruthy());
  });

  it("shows Schools' refusal and keeps the dialog open", async () => {
    api.changeError = new ApiError('The school is already suspended', 409, 'already_in_status');
    render(<SchoolsPage />);
    fireEvent.click(within(await rowOf('Kilimani Secondary')).getByText('Suspend'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Why\?/), { target: { value: 'Unpaid' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The school is already suspended'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('offers nothing for a status the console does not set', async () => {
    render(<SchoolsPage />);
    const ruiru = await rowOf('Ruiru Academy');
    expect(within(ruiru).queryByText('Suspend')).toBeNull();
    expect(within(ruiru).queryByText('Reactivate')).toBeNull();
  });

  it.each(['owner', 'admin', 'support'] as const)('%s can suspend and reactivate', async (role) => {
    api.role = role;
    render(<SchoolsPage />);
    expect(within(await rowOf('Kilimani Secondary')).getByText('Suspend')).toBeTruthy();
    expect(within(await rowOf('Lavington Primary')).getByText('Reactivate')).toBeTruthy();
  });

  it('a viewer sees every school but no actions', async () => {
    api.role = 'viewer';
    render(<SchoolsPage />);
    await rowOf('Kilimani Secondary');
    expect(inTable().getByText('Lavington Primary')).toBeTruthy();
    expect(screen.queryByText('Suspend')).toBeNull();
    expect(screen.queryByText('Reactivate')).toBeNull();
  });
});

describe('the schools page: which statuses can be suspended', () => {
  beforeEach(() => {
    api.schools = ['active', 'trial', 'overdue', 'onboarding', 'setup_stalled', 'suspended'].map((st, i) =>
      school(`School ${st}`, `0000000${i}-0000-4000-8000-000000000000`, st)
    );
  });

  it('Suspend for active, trial and overdue; Reactivate for suspended; nothing for onboarding or setup_stalled', async () => {
    render(<SchoolsPage />);
    const actions = async (st: string) => {
      const row = await rowOf(`School ${st}`);
      return ['Suspend', 'Reactivate'].filter((a) => within(row).queryByText(a));
    };
    expect(await actions('active')).toEqual(['Suspend']);
    expect(await actions('trial')).toEqual(['Suspend']);
    expect(await actions('overdue')).toEqual(['Suspend']);
    expect(await actions('onboarding')).toEqual([]);
    expect(await actions('setup_stalled')).toEqual([]);
    expect(await actions('suspended')).toEqual(['Reactivate']);
  });

  it("shows Schools' 422 status_not_settable cleanly, until Schools accepts it", async () => {
    api.changeError = new ApiError('Status trial cannot be changed to suspended', 422, 'status_not_settable');
    render(<SchoolsPage />);
    fireEvent.click(within(await rowOf('School trial')).getByText('Suspend'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Why\?/), { target: { value: 'Trial abuse' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Figbloom Schools doesn't allow School trial to be suspended while it is trial. (Status trial cannot be changed to suspended)"
      )
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('the schools page: analytics', () => {
  it('shows the figures with a sub-line, the charts with labels and values, the top schools and what needs attention', async () => {
    render(<SchoolsPage />);
    await rowOf('Kilimani Secondary');
    expect(screen.getByText('23 teachers', { exact: false }).textContent).toBe('23 teachers · 380 parents');
    for (const title of ['New schools per week', 'Schools by status', 'Last sign-in']) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }
    const byStatus = within(screen.getByRole('list', { name: 'Schools by status' })).getAllByRole('listitem');
    expect(byStatus.map((li) => li.textContent)).toEqual(['Active1', 'Archived1', 'Suspended1']);
    const activity = within(screen.getByRole('list', { name: 'Last sign-in' })).getAllByRole('listitem');
    expect(activity.map((li) => li.textContent?.replace(/\d+$/, ''))).toEqual([
      'Signed in within 7 days', 'Within 30 days', 'More than 30 days ago', 'Never signed in',
    ]);
    const top = within(screen.getByRole('list', { name: 'Top schools by students' })).getAllByRole('listitem');
    expect(top.map((li) => li.textContent)).toEqual(['1.Kilimani Secondary412', '2.Lavington Primary100', '3.Ruiru Academy5']);
    // Ruiru has no admin and nobody ever signed in; Lavington is suspended, so left out
    const attention = within(screen.getByRole('list', { name: 'Needs attention' })).getAllByRole('listitem');
    expect(attention.map((li) => li.textContent)).toEqual(['Ruiru AcademyNo admin · Nobody has ever signed in']);
  });
});
