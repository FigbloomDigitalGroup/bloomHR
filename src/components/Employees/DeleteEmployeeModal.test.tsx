import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ checkDeleteEmployee: vi.fn(), deleteEmployee: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../lib/employeeDelete', () => api);

import DeleteEmployeeModal from './DeleteEmployeeModal';

const check = { employee_number: 'TEST-001', name: 'Amina Wanjiru', blocked: null, has_login: true, documents: 2, leave_applications: 0 };
const show = (isAdmin = true) => render(<MemoryRouter><DeleteEmployeeModal employeeId="e1" isAdmin={isAdmin} onClose={vi.fn()} /></MemoryRouter>);

beforeEach(() => {
  api.checkDeleteEmployee.mockReset().mockResolvedValue(check);
  api.deleteEmployee.mockReset().mockResolvedValue({ loginRemoved: true, loginKept: false });
});
afterEach(cleanup);

describe('DeleteEmployeeModal', () => {
  it('says what goes with the employee, and deletes only once their number is typed', async () => {
    show();
    expect(await screen.findByText(/2 documents, 0 leave applications/)).toBeTruthy();
    const button = screen.getByRole('button', { name: /Delete employee/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Employee number to confirm'), { target: { value: 'TEST-001' } });
    fireEvent.click(button);
    await waitFor(() => expect(api.deleteEmployee).toHaveBeenCalledWith('e1', true));
  });

  it('lets an administrator keep the login', async () => {
    show();
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('Employee number to confirm'), { target: { value: 'TEST-001' } });
    fireEvent.click(screen.getByRole('button', { name: /Delete employee/ }));
    await waitFor(() => expect(api.deleteEmployee).toHaveBeenCalledWith('e1', false));
  });

  it('HR without admin rights is told the login stays', async () => {
    show(false);
    expect(await screen.findByText(/They have a login, which stays/)).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('explains why someone can’t be deleted, with no delete button', async () => {
    api.checkDeleteEmployee.mockResolvedValue({ ...check, blocked: 'They have payslips in approved payroll months, which must be kept. Terminate them instead.' });
    show();
    expect(await screen.findByText(/Terminate them instead/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Delete employee/ })).toBeNull();
  });
});
