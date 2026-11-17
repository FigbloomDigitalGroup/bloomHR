import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SchoolHr } from '../../lib/platformSchoolHr';

const api = vi.hoisted(() => ({
  schools: [] as SchoolHr[],
  enabled: [] as string[],
  fail: false,
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

import { SchoolHrCell } from './SchoolHr';
import { useSchoolHr } from './useSchoolHr';

const school = (id: string, state: SchoolHr['hr']['state']): SchoolHr => ({
  platform_tenant_id: id, name: `School ${id}`, schools_tenant_id: `local-${id}`, schools_slug: null,
  hr: { state, module_status: null, hr_tenant_id: state === 'on' ? 'hr-1' : null },
});

function Harness({ canEnable }: { canEnable: boolean }) {
  const data = useSchoolHr(true);
  return (
    <ul>
      {['a', 'b', 'c', 'missing'].map((id) => (
        <li key={id} data-testid={id}><SchoolHrCell school={data.bySchoolsId.get(`local-${id}`)} data={data} canEnable={canEnable} labelled /></li>
      ))}
    </ul>
  );
}

afterEach(() => {
  cleanup();
  api.enabled = [];
  api.fail = false;
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
});
