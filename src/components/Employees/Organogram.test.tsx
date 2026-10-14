import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toDirectoryEmployee } from '../../lib/employeeDirectory';
import type { Department } from '../../lib/orgStructure';

const state = vi.hoisted(() => ({ canOpen: false }));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ loading: false, hasPermission: () => state.canOpen }),
}));
const departments: Department[] = [
  { id: 'exec', name: 'Executive', parent_id: null, head_employee_id: 'a', active: true },
  { id: 'fin', name: 'Finance', parent_id: 'exec', head_employee_id: 'b', active: true },
];
vi.mock('../../hooks/useDepartments', () => ({
  useDepartments: () => ({ departments, loading: false, error: null, reload: vi.fn() }),
}));
const person = (id: string, first: string, title: string, reportsTo: string | null, dept: string | null, status = 'Active') =>
  toDirectoryEmployee({
    id, 'Employee Number': id.toUpperCase(), 'First Name': first, 'Last Name': 'X', 'Job Title': title,
    reports_to_id: reportsTo, department_id: dept, Status: status, 'Profile Image': id === 'a' ? 'https://example.com/a.png' : null,
  });
vi.mock('../../hooks/useEmployeeDirectory', () => ({
  useEmployeeDirectory: () => ({
    employees: [
      person('a', 'Ann', 'CEO', null, 'exec'),
      person('b', 'Ben', 'CFO', 'a', 'fin'),
      person('c', 'Cy', 'Accountant', 'b', 'fin'),
      person('d', 'Dee', 'Driver', null, null),
      person('z', 'Zed', 'Gone', 'a', 'fin', 'Terminated'),
    ],
    loading: false,
    error: null,
  }),
}));

import Organogram from './Organogram';

const show = () => render(<MemoryRouter><Organogram /></MemoryRouter>);
const names = () => screen.getAllByTestId('org-box').map((b) => b.textContent);

beforeEach(() => {
  state.canOpen = false;
  // the chart layout (as on a wide screen)
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
});
afterEach(() => cleanup());

describe('Organogram', () => {
  it('draws who reports to whom, opening the first levels and leaving out people who have left', () => {
    const { container } = show();
    expect(names()).toEqual([
      expect.stringContaining('Ann X'),
      expect.stringContaining('Ben X'),
      expect.stringContaining('Dee X'),
    ]);
    expect(screen.queryByText('Zed X')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.com/a.png');
    // Ben's report opens on a click
    fireEvent.click(screen.getByRole('button', { name: /Show 1 under Ben X/ }));
    expect(screen.getByText('Cy X')).toBeTruthy();
    expect(screen.getByText('Accountant')).toBeTruthy();
  });

  it('search shows a match where it sits', () => {
    show();
    fireEvent.change(screen.getByLabelText('Search the organogram'), { target: { value: 'accountant' } });
    expect(names()).toEqual([
      expect.stringContaining('Ann X'),
      expect.stringContaining('Ben X'),
      expect.stringContaining('Cy X'),
    ]);
  });

  it('views by department, with each department’s people and those without one', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Departments' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    const boxes = names();
    expect(boxes[0]).toContain('Executive');
    expect(boxes[0]).toContain('Head: Ann X');
    expect(boxes.join('|')).toContain('Finance');
    expect(boxes.some((b) => b?.includes('No department'))).toBe(true);
    expect(boxes.some((b) => b?.includes('Dee X'))).toBe(true);
  });

  it('has a collapsible list for phones', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    show();
    expect(screen.getByRole('button', { name: 'List' }).getAttribute('aria-pressed')).toBe('true');
    const tree = screen.getByRole('tree');
    expect(tree).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Hide 1 under Ann X/ }));
    expect(screen.queryByText('Ben X')).toBeNull();
  });

  it('links to the employee record only for people who may open it', () => {
    show();
    expect(screen.queryByRole('link', { name: 'Ann X' })).toBeNull();
    cleanup();
    state.canOpen = true;
    show();
    expect(screen.getByRole('link', { name: 'Ann X' }).getAttribute('href')).toBe('/view-employee/A');
  });

  it('prints with everything open', () => {
    vi.useFakeTimers();
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    vi.runAllTimers();
    expect(print).toHaveBeenCalled();
    expect(screen.getByText('Cy X')).toBeTruthy();
    vi.useRealTimers();
  });
});
