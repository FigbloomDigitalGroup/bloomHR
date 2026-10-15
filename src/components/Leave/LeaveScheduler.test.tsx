import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// Leave rows come back with a lower-case `status` column (sometimes empty) and the scheduler drew bar.Status, so any
// month with a leave crashed the page ("Cannot read properties of undefined (reading 'slice')").
const today = new Date();
const day = (d: number) => new Date(today.getFullYear(), today.getMonth(), d).toISOString().slice(0, 10);
const employees = [{ id: '1', 'Employee Number': 'E1', 'First Name': 'Amina', 'Last Name': 'Wanjiru', Town: 'Nairobi' }];
const leaves = [
  { id: 1, 'Employee Number': 'E1', 'Start Date': day(3), 'End Date': day(5), 'Leave Type': 'Annual', status: 'Approved' },
  { id: 2, 'Employee Number': 'E1', 'Start Date': day(10), 'End Date': day(11), 'Leave Type': 'Sick', status: null },
  { id: 3, 'Employee Number': 'E1', 'Start Date': null, 'End Date': null, 'Leave Type': 'Broken', status: 'pending' },
];

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/fetchAll', () => {
  let call = 0;
  return { fetchAll: vi.fn(async () => (call++ % 2 === 0 ? employees : leaves)) };
});

import LeaveScheduler from './LeaveScheduler';

afterEach(cleanup);

describe('LeaveScheduler', () => {
  it('draws leaves whose status column is lower case or empty, and skips ones without dates', async () => {
    render(<LeaveScheduler />);
    expect(await screen.findByText('app')).toBeTruthy();
    expect(screen.getByText('pen')).toBeTruthy();
    expect(screen.queryByTitle(/Broken/)).toBeNull();
  });
});
