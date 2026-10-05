import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toDirectoryEmployee } from '../../lib/employeeDirectory';

const staff = [
  toDirectoryEmployee({ 'Employee Number': '001', 'First Name': 'Wanjiru', 'Last Name': 'Kamau', 'Job Title': 'Software Engineer', Town: 'Nairobi' }),
  toDirectoryEmployee({ 'Employee Number': '005', 'First Name': 'Mike', 'Last Name': 'Otieno', 'Job Title': 'Accountant', Town: 'Kisumu' }),
  toDirectoryEmployee({ 'Employee Number': '012', 'First Name': 'Michael', 'Last Name': 'Mwangi', 'Job Title': 'HR Manager', Town: 'Nakuru' }),
];

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

vi.mock('../../hooks/useEmployeeDirectory', () => ({
  useEmployeeDirectory: () => ({ employees: staff, loading: false, error: null }),
}));

import EmployeePicker from './EmployeePicker';

beforeEach(() => {
  cleanup();
});

describe('EmployeePicker', () => {
  it('lists matches with ID and job title as you type, and returns the picked employee', async () => {
    const onChange = vi.fn();
    render(<EmployeePicker label="Employee" value="" onChange={onChange} />);

    const input = screen.getByRole('combobox', { name: /employee/i });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'mike' } });

    const option = await screen.findByRole('option');
    expect(option.textContent).toContain('Mike Otieno');
    expect(option.textContent).toContain('005');
    expect(option.textContent).toContain('Accountant');

    fireEvent.mouseDown(option);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ employeeNumber: '005', fullName: 'Mike Otieno' }));
  });

  it('shows the selected person as "Name (ID)"', () => {
    render(<EmployeePicker label="Employee" value="005" onChange={() => {}} />);
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('Mike Otieno (005)');
  });

  it('picks with the keyboard and does not submit the surrounding form', async () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <EmployeePicker label="Employee" value="" onChange={onChange} />
      </form>
    );
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'mi' } });
    await screen.findAllByRole('option');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('says so when nobody matches', async () => {
    render(<EmployeePicker label="Employee" value="" onChange={() => {}} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(await screen.findByText(/No employees match "zzz"/)).toBeTruthy();
  });

  it('can be cleared and can exclude people', async () => {
    const onChange = vi.fn();
    render(<EmployeePicker label="Employee" value="005" onChange={onChange} filter={(e) => e.employeeNumber !== '001'} />);
    fireEvent.click(screen.getByRole('button', { name: /clear selected employee/i }));
    expect(onChange).toHaveBeenCalledWith(null);

    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'wanjiru' } });
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));
  });

  it('only offers the employees a screen was scoped to (allowedNumbers)', async () => {
    render(<EmployeePicker label="Employee" value="" onChange={() => {}} allowedNumbers={['001', '012']} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);

    // Mike (005) is in the directory but outside the allowed list
    fireEvent.change(input, { target: { value: 'mike' } });
    await screen.findByText(/No employees match "mike"/);

    // with no query, only the two allowed people are listed
    fireEvent.change(input, { target: { value: '' } });
    const names = (await screen.findAllByRole('option')).map((o) => o.textContent || '');
    expect(names).toHaveLength(2);
    expect(names.join(' ')).toContain('Wanjiru');
    expect(names.join(' ')).toContain('Michael');
  });

  it('does not let a click on the list reach outside-click handlers (e.g. a modal that closes on outside click)', async () => {
    const outside = vi.fn();
    document.addEventListener('mousedown', outside);
    try {
      render(<EmployeePicker label="Employee" value="" onChange={() => {}} />);
      const input = screen.getByRole('combobox');
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'mike' } });
      const option = await screen.findByRole('option');

      fireEvent.mouseDown(screen.getByRole('listbox')); // e.g. the scrollbar or a gap between rows
      fireEvent.mouseDown(option); // picking closes the list, so this goes second

      expect(outside).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('mousedown', outside);
    }
  });
});
