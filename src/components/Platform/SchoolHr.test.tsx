import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SchoolHr } from '../../lib/platformSchoolHr';

const api = vi.hoisted(() => ({
  schools: [] as SchoolHr[],
  enabled: [] as string[],
  fail: false,
  invites: [] as { id: string; email: string; name?: string }[],
  inviteAnswer: null as null | { outcome: string; member_role?: string | null },
  inviteError: null as null | string,
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toast }));
vi.mock('../../lib/platformSchoolHr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformSchoolHr')>()),
  listSchoolHr: () => (api.fail ? Promise.reject(new Error('down')) : Promise.resolve({ schools: api.schools, truncated: false })),
  enableSchoolHr: (id: string) => {
    api.enabled.push(id);
    const s = api.schools.find((x) => x.platform_tenant_id === id)!;
    return Promise.resolve({ ...s, hr: { state: 'enabling', module_status: 'active', hr_tenant_id: null } });
  },
}));

vi.mock('../../lib/platformHrAdmin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformHrAdmin')>()),
  inviteHrAdmin: (id: string, email: string, name?: string) => {
    api.invites.push({ id, email, name });
    if (api.inviteError) return Promise.reject(new Error(api.inviteError));
    const a = api.inviteAnswer ?? { outcome: 'queued' };
    return Promise.resolve({ outcome: a.outcome, email: email.trim().toLowerCase(), company: { id: 'hr-1', name: 'x' }, member_role: a.member_role ?? null });
  },
}));

import { HrPayrollCell, SchoolHrCell } from './SchoolHr';
import { useSchoolHr } from './useSchoolHr';

const school = (id: string, state: SchoolHr['hr']['state']): SchoolHr => ({
  platform_tenant_id: id, name: `School ${id}`, schools_tenant_id: `local-${id}`, schools_slug: null,
  hr: { state, module_status: null, hr_tenant_id: state === 'on' ? 'hr-1' : null },
});

function Harness({ canEnable, requested = {} }: { canEnable: boolean; requested?: Record<string, string> }) {
  const data = useSchoolHr(true);
  return (
    <ul>
      {['a', 'b', 'c', 'missing'].map((id) => (
        <li key={id} data-testid={id}>
          <SchoolHrCell school={data.bySchoolsId.get(`local-${id}`)} data={data} canEnable={canEnable} labelled requestedAt={requested[id] ?? null} />
        </li>
      ))}
    </ul>
  );
}

afterEach(() => {
  cleanup();
  api.enabled = [];
  api.fail = false;
  api.invites = [];
  api.inviteAnswer = null;
  api.inviteError = null;
});

describe('HR & Payroll per school', () => {
  it('shows Off, Enabling and On, and — for a school the platform does not have', async () => {
    api.schools = [school('a', 'off'), school('b', 'enabling'), school('c', 'on')];
    render(<Harness canEnable={false} />);
    expect(await screen.findByText('HR & Payroll: Off')).toBeTruthy();
    expect(screen.getByText('HR & Payroll: Enabling')).toBeTruthy();
    expect(screen.getByText('HR & Payroll: On')).toBeTruthy();
    expect(screen.getByTestId('missing').textContent).toBe('HR & Payroll: —');
    expect(screen.queryByRole('button', { name: /Enable HR/ })).toBeNull();
  });

  it('Enable (for roles that approve companies) asks first, then switches the school on', async () => {
    api.schools = [school('a', 'off'), school('c', 'on')];
    render(<Harness canEnable />);
    const enable = await screen.findByRole('button', { name: 'Enable HR & Payroll for School a' });
    expect(screen.queryByRole('button', { name: 'Enable HR & Payroll for School c' })).toBeNull();
    fireEvent.click(enable);
    expect(await screen.findByText('Switch HR & Payroll on for School a?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(api.enabled).toEqual(['a']));
    expect(await screen.findByText('HR & Payroll: Enabling')).toBeTruthy();
    expect(toast.success).toHaveBeenCalled();
  });

  it('when the platform can\'t be asked, every school shows —', async () => {
    api.fail = true;
    render(<Harness canEnable />);
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('HR & Payroll: —'));
  });

  it('"Requested …" beside Off (or —, not on the platform yet) once the state is known; not when Enabling or On', async () => {
    api.schools = [school('a', 'off'), school('b', 'enabling'), school('c', 'on')];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    render(<Harness canEnable={false} requested={{ a: yesterday, b: yesterday, c: yesterday, missing: yesterday }} />);
    // while loading: nothing yet (it may already be on)
    expect(screen.queryByText(/^Requested/)).toBeNull();
    await screen.findByText('HR & Payroll: Off');
    expect(screen.getByTestId('a').textContent).toBe('HR & Payroll: OffRequested yesterday');
    expect(screen.getByTestId('b').textContent).toBe('HR & Payroll: Enabling');
    expect(screen.getByTestId('c').textContent).toBe('HR & Payroll: On');
    expect(screen.getByTestId('missing').textContent).toBe('HR & Payroll: —Requested yesterday');
  });
});

describe('Invite admin (HR & Payroll on)', () => {
  const cell = (props: Partial<Parameters<typeof HrPayrollCell>[0]> = {}) => render(
    <HrPayrollCell name="Swift Haulage" state="on" canEnable platformTenantId="pt-1" enable={() => Promise.resolve('on')}
      explain="" invitees="" {...props} />
  );
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'Invite an HR admin for Swift Haulage' }));
  const fill = (email: string, name = '') => {
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
    if (name) fireEvent.change(screen.getByLabelText('Name (optional)'), { target: { value: name } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
  };

  it('is offered only when On, to roles that approve companies, with a platform ID', () => {
    cell({ state: 'off' });
    expect(screen.queryByRole('button', { name: /Invite an HR admin/ })).toBeNull();
    cleanup();
    cell({ state: 'enabling' });
    expect(screen.queryByRole('button', { name: /Invite an HR admin/ })).toBeNull();
    cleanup();
    cell({ canEnable: false });
    expect(screen.queryByRole('button', { name: /Invite an HR admin/ })).toBeNull();
    cleanup();
    cell({ platformTenantId: null });
    expect(screen.queryByRole('button', { name: /Invite an HR admin/ })).toBeNull();
    cleanup();
    cell();
    expect(screen.getByRole('button', { name: 'Invite an HR admin for Swift Haulage' }).textContent).toBe('Invite admin');
  });

  it('a school that is On on the Schools page offers it too, for its platform ID', async () => {
    api.schools = [school('c', 'on')];
    render(<Harness canEnable />);
    fireEvent.click(await screen.findByRole('button', { name: 'Invite an HR admin for School c' }));
    fill('head@school.ac.ke');
    await screen.findByRole('status');
    expect(api.invites).toEqual([{ id: 'c', email: 'head@school.ac.ke', name: '' }]);
  });

  it('sends the email and name, and says it was sent', async () => {
    cell();
    open();
    expect(screen.getByText('Invite an HR admin for Swift Haulage')).toBeTruthy();
    fill(' New.Admin@Swift.co.ke ', 'Jane Owner');
    expect((await screen.findByRole('status')).textContent).toBe('Invitation sent to new.admin@swift.co.ke. Figbloom HR emails it within a few minutes.');
    expect(api.invites).toEqual([{ id: 'pt-1', email: 'New.Admin@Swift.co.ke', name: 'Jane Owner' }]);
    // cleared for another
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
  });

  it('says when they are already invited, or already an admin', async () => {
    cell();
    open();
    api.inviteAnswer = { outcome: 'already_invited' };
    fill('a@swift.co.ke');
    expect((await screen.findByRole('status')).textContent).toBe('a@swift.co.ke is already invited. Nothing was sent again.');
    api.inviteAnswer = { outcome: 'already_member', member_role: 'ADMIN' };
    fill('b@swift.co.ke');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('b@swift.co.ke is already an admin of this HR company.'));
    api.inviteAnswer = { outcome: 'already_member', member_role: 'STAFF' };
    fill('c@swift.co.ke');
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('already has a login in this HR company (staff)'));
  });

  it("refuses a malformed address without asking, and shows the server's refusal", async () => {
    cell();
    open();
    fill('not-an-email');
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a valid email address.');
    expect(api.invites).toEqual([]);
    api.inviteError = 'Figbloom HR has no company for this customer yet.';
    fill('a@swift.co.ke');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Figbloom HR has no company for this customer yet.'));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
