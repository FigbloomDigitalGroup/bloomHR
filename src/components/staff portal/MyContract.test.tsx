import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ row: null as Record<string, string> | null, error: null as unknown, email: 'staff@acme.co' as string | null }));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: mocks.email ? { email: mocks.email } : null } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: mocks.row, error: mocks.error }) }) }) }),
  },
}));

import MyContract from './MyContract';

beforeEach(() => {
  mocks.row = null;
  mocks.error = null;
  mocks.email = 'staff@acme.co';
});
afterEach(() => cleanup());

describe('MyContract', () => {
  it('shows the employee’s own terms', async () => {
    mocks.row = { 'Employee Type': 'Contract', 'Job Title': 'Sales Rep', Manager: 'Jane Doe', 'Start Date': '2025-01-06', 'Contract Start Date': '2025-01-06', 'Contract End Date': '2999-01-01' };
    render(<MyContract />);
    await screen.findByText('Sales Rep');
    expect(screen.getByText('Contract')).toBeTruthy();
    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.getByText(/^Ends in \d+ days/)).toBeTruthy();
  });

  it('explains when there is no employee record yet', async () => {
    render(<MyContract />);
    await screen.findByText('No employee record yet');
  });

  it('says so when it cannot load', async () => {
    mocks.error = { message: 'boom' };
    render(<MyContract />);
    await screen.findByText('Could not load your contract');
  });
});
