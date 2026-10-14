import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import JobGroupPicker from './JobGroupPicker';
import { JobGroup, lockedPayFields } from '../../lib/jobGroups';

const FIXED: JobGroup = {
  id: 'g1', code: 'JG5', name: 'Senior officers', active: true, employee_count: 1, effective_from: '2026-01-01',
  basic_salary: 55000, basic_min: null, basic_max: null, house_allowance: 11000, travel_allowance: 5000, other_allowances: 1000,
  next_effective_from: null,
};
const BAND: JobGroup = { ...FIXED, id: 'g2', code: 'BAND', name: 'BAND', basic_salary: null, basic_min: 30000, basic_max: 40000, house_allowance: 2000 };
const RETIRED: JobGroup = { ...FIXED, id: 'g3', code: 'OLD', name: 'OLD', active: false };

let latest: Record<string, unknown> = {};
function Form({ initial }: { initial: Record<string, unknown> }) {
  const [values, setValues] = useState(initial);
  latest = values;
  return <JobGroupPicker groups={[FIXED, BAND, RETIRED]} values={values} onChange={(patch) => setValues((v) => ({ ...v, ...patch }))} />;
}

afterEach(() => cleanup());

describe('Job group picker', () => {
  it('choosing a group fills the basic salary and allowances, and locks them', () => {
    render(<Form initial={{ 'Basic Salary': 1000 }} />);
    expect(screen.queryByRole('option', { name: /OLD/ })).toBeNull();
    fireEvent.change(screen.getByLabelText(/Job Group/), { target: { value: 'g1' } });
    expect(latest).toMatchObject({
      job_group_id: 'g1', 'Job Group': 'JG5', 'Basic Salary': 55000, house_allowance: 11000, travel_allowance: 5000, other_cash_allowances: 1000,
    });
    expect(screen.getByTestId('job-group-amounts').textContent).toMatch(/55,000/);
    expect(lockedPayFields([FIXED], latest)).toEqual(['Basic Salary', 'house_allowance', 'travel_allowance', 'other_cash_allowances']);
  });

  it('a band keeps the salary, moved into the band', () => {
    render(<Form initial={{ 'Basic Salary': 90000 }} />);
    fireEvent.change(screen.getByLabelText(/Job Group/), { target: { value: 'g2' } });
    expect(latest).toMatchObject({ 'Basic Salary': 40000, house_allowance: 2000 });
  });

  it('overriding asks for a reason and keeps the pay as typed; turning it off brings back the group’s pay', () => {
    render(<Form initial={{ job_group_id: 'g1', 'Job Group': 'JG5', 'Basic Salary': 55000 }} />);
    fireEvent.click(screen.getByLabelText(/Set this employee’s pay by hand/));
    expect(latest.pay_overridden).toBe(true);
    expect(screen.getByText('Give a reason')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Reason for the override/), { target: { value: 'Specialist' } });
    expect(latest.pay_override_reason).toBe('Specialist');
    expect(lockedPayFields([FIXED], latest)).toEqual([]);

    fireEvent.click(screen.getByLabelText(/Set this employee’s pay by hand/));
    expect(latest).toMatchObject({ pay_overridden: false, pay_override_reason: null, 'Basic Salary': 55000 });
  });

  it('an overridden employee keeps their pay when moved to another group', () => {
    render(<Form initial={{ job_group_id: 'g1', pay_overridden: true, pay_override_reason: 'x', 'Basic Salary': 99000 }} />);
    fireEvent.change(screen.getByLabelText(/Job Group/), { target: { value: 'g2' } });
    expect(latest).toMatchObject({ job_group_id: 'g2', 'Basic Salary': 99000 });
  });

  it('an employee already on an inactive group keeps it; clearing the group clears the override', () => {
    render(<Form initial={{ job_group_id: 'g3', pay_overridden: true, pay_override_reason: 'x' }} />);
    expect(screen.getByRole('option', { name: /OLD \(inactive\)/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Job Group/), { target: { value: '' } });
    expect(latest).toMatchObject({ job_group_id: null, 'Job Group': null, pay_overridden: false, pay_override_reason: null });
  });
});
