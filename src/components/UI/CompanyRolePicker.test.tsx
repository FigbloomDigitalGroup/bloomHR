import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const perms = vi.hoisted(() => ({ role: 'HR', permissions: ['invite-people', 'task-projects', 'employees'] as string[] }));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ userRole: perms.role, permissions: perms.permissions }),
}));
const db = vi.hoisted(() => ({
  roles: [
    { id: 'r-admin', role_key: 'ADMIN', name: 'Administrator', description: null, base_role: 'ADMIN', is_system: true, active: true },
    { id: 'r-hr', role_key: 'HR', name: 'Human Resources', description: null, base_role: 'HR', is_system: true, active: true },
    { id: 'r-mgr', role_key: 'MANAGER', name: 'Manager', description: null, base_role: 'MANAGER', is_system: true, active: true },
    { id: 'r-staff', role_key: 'STAFF', name: 'Staff', description: null, base_role: 'STAFF', is_system: true, active: true },
    { id: 'r-lead', role_key: 'CR_lead', name: 'Team lead', description: null, base_role: 'STAFF', is_system: false, active: true },
    { id: 'r-clerk', role_key: 'CR_clerk', name: 'Payroll clerk', description: null, base_role: 'MANAGER', is_system: false, active: true },
    { id: 'r-big', role_key: 'CR_big', name: 'Senior staff', description: null, base_role: 'STAFF', is_system: false, active: true },
    { id: 'r-off', role_key: 'CR_off', name: 'Retired', description: null, base_role: 'STAFF', is_system: false, active: false },
  ],
  modules: [
    { role_name: 'CR_lead', permissions: ['task-projects'] },
    { role_name: 'CR_clerk', permissions: ['payroll'] },
    { role_name: 'CR_big', permissions: ['task-projects', 'leaves'] },
  ],
}));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const data = table === 'company_roles' ? db.roles : db.modules;
      const result = Promise.resolve({ data, error: null });
      const chain = { select: () => chain, order: () => result, then: result.then.bind(result) };
      return chain;
    },
  },
}));

import CompanyRolePicker, { STAFF_PICK } from './CompanyRolePicker';

afterEach(() => {
  cleanup();
  perms.role = 'HR';
  perms.permissions = ['invite-people', 'task-projects', 'employees'];
});

const select = () => screen.getByLabelText('Role in the app') as HTMLSelectElement;
const options = () => [...select().options].map((o) => o.textContent);

describe('CompanyRolePicker', () => {
  it('someone with Invite people is offered Staff and the Staff-based roles whose modules they hold', async () => {
    render(<CompanyRolePicker value={STAFF_PICK} onChange={() => {}} />);
    await waitFor(() => expect(options()).toEqual(['Staff', 'Team lead (based on Staff)']));
  });

  it('an administrator is offered every role that is switched on', async () => {
    perms.role = 'ADMIN';
    render(<CompanyRolePicker value={STAFF_PICK} onChange={() => {}} />);
    await waitFor(() => expect(options()).toHaveLength(7));
    expect(options()).not.toContain('Retired (based on Staff)');
    expect(options()).toContain('Payroll clerk (based on Manager)');
  });

  it('picking a company role gives its base role and its id', async () => {
    const onChange = vi.fn();
    render(<CompanyRolePicker value={STAFF_PICK} onChange={onChange} />);
    await waitFor(() => expect(options()).toContain('Team lead (based on Staff)'));
    fireEvent.change(select(), { target: { value: 'CR_lead' } });
    expect(onChange).toHaveBeenCalledWith({ role: 'STAFF', companyRoleId: 'r-lead' });
    fireEvent.change(select(), { target: { value: 'STAFF' } });
    expect(onChange).toHaveBeenLastCalledWith({ role: 'STAFF', companyRoleId: null });
  });

  it('shows the picked company role', async () => {
    render(<CompanyRolePicker value={{ role: 'STAFF', companyRoleId: 'r-lead' }} onChange={() => {}} />);
    await waitFor(() => expect(select().value).toBe('CR_lead'));
  });
});
