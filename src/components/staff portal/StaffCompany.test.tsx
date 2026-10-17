import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const fx = vi.hoisted(() => {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return { ym };
});

const state = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  rpc: {} as Record<string, unknown>,
  eqCalls: [] as [string, string, unknown][],
  rpcCalls: [] as string[],
}));

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../lib/fetchAll', () => ({ fetchAllResult: vi.fn().mockResolvedValue({ data: [], error: null }) }));
// an HR-like permission, to show the staff screens stay read-only whatever the role
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ loading: false, hasPermission: () => true }) }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const result = Promise.resolve({ data: state.tables[table] || [], error: null });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = Object.assign(result, {
        select: () => b,
        order: () => b,
        range: () => result,
        eq: (col: string, val: unknown) => {
          state.eqCalls.push([table, col, val]);
          return b;
        },
      });
      return b;
    },
    rpc: (name: string) => {
      state.rpcCalls.push(name);
      return Promise.resolve({ data: state.rpc[name] ?? null, error: null });
    },
  },
}));

import StaffCompany from './StaffCompany';
import MyApprovalChain from './MyApprovalChain';
import type { CompanySection } from '../../lib/staffCompany';

const CHAIN = {
  kind: 'leave',
  has_employee_record: true,
  steps: [
    { position: 2, label: 'Line manager', approver_type: 'reports_to', who: 'Max Manager' },
    { position: 3, label: 'HR', approver_type: 'role', approver_role: 'HR', who: 'HR' },
  ],
  skipped: [{ position: 1, label: 'Leave approver', approver_type: 'leave_approver', reason: 'no approver' }],
  also_told: ['HR'],
  admin_fallback: false,
};

const show = (section: CompanySection, onSectionChange = vi.fn()) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <StaffCompany section={section} onSectionChange={onSectionChange} employeeNumber="E-ME" />
      </MemoryRouter>
    </QueryClientProvider>
  );

beforeEach(() => {
  state.tables = {};
  state.rpc = { my_approval_chain: CHAIN };
  state.eqCalls = [];
  state.rpcCalls = [];
});
afterEach(cleanup);

describe('Who approves my leave', () => {
  it('shows the chain in order, the steps passed over and who is also told', async () => {
    render(<MyApprovalChain />);
    expect(await screen.findByText('Your leave goes to Max Manager (line manager), then HR.')).toBeTruthy();
    expect(screen.getByText('Max Manager (line manager)')).toBeTruthy();
    expect(screen.getByText('Leave approver: skipped, because you have nobody set here')).toBeTruthy();
    expect(screen.getByText('HR is also told when it is decided.')).toBeTruthy();
  });

  it('is one line on the leave form', async () => {
    render(<MyApprovalChain compact />);
    const note = await screen.findByTestId('leave-approval-chain');
    expect(note.textContent).toContain('Your leave goes to Max Manager (line manager), then HR.');
    expect(note.textContent).toContain('HR is also told');
  });

  it('says when it falls back to an admin', async () => {
    state.rpc.my_approval_chain = {
      ...CHAIN,
      steps: [{ position: 2, label: 'Admin', approver_type: 'role', approver_role: 'ADMIN', who: 'ADMIN' }],
      also_told: [],
      admin_fallback: true,
    };
    render(<MyApprovalChain />);
    expect(await screen.findByText('Your leave goes to an admin.')).toBeTruthy();
    expect(screen.getByText(/so an admin does/)).toBeTruthy();
  });
});

describe('Company area', () => {
  it('calendar: read-only, with holidays and only my own approved and pending leave', async () => {
    state.tables = {
      holidays: [{ name: 'Founders Day', date: `${fx.ym}-03`, recurring: false }],
      leave_application: [
        { 'Leave Type': 'Annual Leave', 'Start Date': `${fx.ym}-10`, 'End Date': `${fx.ym}-11`, status: 'approved' },
        { 'Leave Type': 'Sick Leave', 'Start Date': `${fx.ym}-20`, 'End Date': `${fx.ym}-20`, status: 'pending' },
        { 'Leave Type': 'Study Leave', 'Start Date': `${fx.ym}-22`, 'End Date': `${fx.ym}-22`, status: 'rejected' },
      ],
      company_events: [{ id: 'e1', title: 'Town hall', date: `${fx.ym}-15`, description: null }],
    };
    show('company-calendar');
    const list = screen.getByTestId('calendar-phone-list');
    expect(await within(list).findAllByText('My Annual Leave')).toHaveLength(2);
    expect(within(list).getByText('My Sick Leave (pending)')).toBeTruthy();
    expect(within(list).queryByText(/Study Leave/)).toBeNull();
    expect(within(list).getByText('Founders Day')).toBeTruthy();
    expect(within(list).getByText('Town hall')).toBeTruthy();
    // only the signed-in employee's leave is asked for, and nothing can be added or removed
    expect(state.eqCalls).toContainEqual(['leave_application', '"Employee Number"', 'E-ME']);
    expect(screen.queryByRole('button', { name: /New Event/ })).toBeNull();
    expect(within(list).getByText('Town hall').closest('button')?.hasAttribute('disabled')).toBe(true);
  });

  it('organogram: from the safe company directory, with no links to records or settings', async () => {
    state.rpc.company_directory = [
      { id: 'a', employee_number: 'E1', first_name: 'Ann', last_name: 'Boss', job_title: 'CEO', department_id: null, department: null, reports_to_id: null, photo: null },
      { id: 'b', employee_number: 'E2', first_name: 'Ben', last_name: 'Me', job_title: 'Clerk', department_id: null, department: null, reports_to_id: 'a', photo: null },
    ];
    show('company-organogram');
    expect(await screen.findByText('Ann Boss')).toBeTruthy();
    expect(screen.getByText('Ben Me')).toBeTruthy();
    expect(state.rpcCalls).toContain('company_directory');
    // no link to an employee's record, nor to the Departments settings page (even with an HR-like permission)
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('departments: nested, with heads and headcounts', async () => {
    state.tables = {
      departments: [
        { id: 'ops', name: 'Operations', parent_id: null, head_employee_id: 'a', active: true },
        { id: 'fleet', name: 'Fleet', parent_id: 'ops', head_employee_id: null, active: true },
      ],
    };
    state.rpc.company_directory = [
      { id: 'a', employee_number: 'E1', first_name: 'Ann', last_name: 'Boss', job_title: 'COO', department_id: 'ops', department: 'Operations', reports_to_id: null, photo: null },
      { id: 'b', employee_number: 'E2', first_name: 'Ben', last_name: 'Driver', job_title: 'Driver', department_id: 'fleet', department: 'Fleet', reports_to_id: 'a', photo: null },
      { id: 'c', employee_number: 'E3', first_name: 'Cy', last_name: 'Driver', job_title: 'Driver', department_id: 'fleet', department: 'Fleet', reports_to_id: 'a', photo: null },
    ];
    show('company-departments');
    await waitFor(() => expect(screen.getAllByTestId('department-row')).toHaveLength(2));
    const [ops, fleet] = screen.getAllByTestId('department-row');
    expect(ops.textContent).toContain('Operations');
    expect(ops.textContent).toContain('Head: Ann Boss, COO');
    expect(ops.textContent).toContain('1 person');
    expect(fleet.textContent).toContain('No head set');
    expect(fleet.textContent).toContain('2 people');
  });

  it('switches pages from its tabs', async () => {
    const onChange = vi.fn();
    show('company-approvers', onChange);
    expect(await screen.findByText('Your leave goes to Max Manager (line manager), then HR.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Organogram' }));
    expect(onChange).toHaveBeenCalledWith('company-organogram');
  });
});
