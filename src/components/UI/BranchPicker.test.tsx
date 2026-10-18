import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Branch } from '../../lib/branches';

const branch = (id: string, name: string, country: string, extra: Partial<Branch> = {}): Branch => ({
  id, name, country, currency: 'KES', city: null, address: null, active: true, is_default: false, ...extra,
});

const state = vi.hoisted(() => ({ branches: [] as Branch[] }));
vi.mock('../../hooks/useBranches', () => ({
  useBranches: () => ({ branches: state.branches, loading: false, error: null, reload: vi.fn() }),
}));

import BranchPicker from './BranchPicker';

state.branches = [
  branch('kla', 'Kampala', 'Uganda'),
  branch('hq', 'Nairobi HQ', 'Kenya', { is_default: true }),
  branch('dar', 'Dar es Salaam', 'Tanzania'),
  branch('old', 'Old office', 'Kenya', { active: false }),
];

afterEach(cleanup);

describe('BranchPicker (the employee add and edit forms)', () => {
  it('offers the active branches with their country, the default first, and "Default" for none', () => {
    render(<BranchPicker value={null} onChange={vi.fn()} />);
    const options = within(screen.getByLabelText('Branch')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Default (Nairobi HQ, Kenya)', 'Nairobi HQ (Kenya)', 'Dar es Salaam (Tanzania)', 'Kampala (Uganda)']);
  });

  it('keeps a deactivated branch the employee is still in', () => {
    render(<BranchPicker value="old" onChange={vi.fn()} />);
    expect(within(screen.getByLabelText('Branch')).getByRole('option', { name: 'Old office (Kenya) (inactive)' })).toBeTruthy();
  });

  it('gives the chosen branch, or null for the default', () => {
    const onChange = vi.fn();
    render(<BranchPicker value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'dar' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'dar', name: 'Dar es Salaam', country: 'Tanzania' }));
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
