import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ReturnsReadiness from './ReturnsReadiness';

afterEach(cleanup);

const ready = {
  'Employee Number': 'E1', 'First Name': 'Amina', 'Last Name': 'Wanjiru', 'Tax PIN': 'A012345678Z', kra_residency: 'Resident',
  kra_employee_type: 'Primary Employee', 'ID Number': '28123456', 'Type of Identification': 'National ID', 'SHIF Number': 'CR1234567',
  'NSSF Number': '2012345678', 'Mobile Number': '0712345678',
};

describe('ReturnsReadiness', () => {
  it('says so when everyone on payroll has what the returns need', () => {
    render(<ReturnsReadiness employees={[ready]} />);
    expect(screen.getByText(/Everyone on payroll has what the P10, SHA and NSSF returns need/)).toBeTruthy();
  });

  it('counts the gaps per return and lists who is missing what', () => {
    render(<ReturnsReadiness employees={[ready, { ...ready, 'Employee Number': 'E2', 'First Name': 'Juma', 'NSSF Number': '' }]} />);
    expect(screen.getByText(/P10: ready/)).toBeTruthy();
    fireEvent.click(screen.getByText(/NSSF: 1 missing details/));
    expect(screen.getByText(/NSSF number/)).toBeTruthy();
    expect(screen.getByText('Juma Wanjiru')).toBeTruthy();
  });

  it('shows nothing when nobody is on payroll yet', () => {
    const { container } = render(<ReturnsReadiness employees={[]} />);
    expect(container.textContent).toBe('');
  });
});
