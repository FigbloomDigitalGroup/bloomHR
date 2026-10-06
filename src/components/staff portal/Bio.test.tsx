import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

type Call = { table: string; ops: { op: string; args: unknown[] }[] };

const db = vi.hoisted(() => ({
  calls: [] as Call[],
  updateRows: [{ 'Employee Number': 'EMP-011' }] as unknown[],
  employee: {
    'Employee Number': 'EMP-011',
    'First Name': 'Michael',
    'Last Name': 'Kiruti',
    'Work Email': 'kiruti@co.com',
    'Personal Email': 'kiruti@gmail.com',
    'Mobile Number': '0712345678',
    'Profile Image': null,
  } as Record<string, unknown>,
  contact: { full_name: 'Jane', relationship: 'Spouse', phone_number: '0722000000', email: null } as Record<string, unknown> | null,
}));

vi.mock('../../lib/supabase', () => {
  const resultFor = (call: Call) => {
    const ops = call.ops.map((o) => o.op);
    if (call.table === 'user_profiles') return { data: { role: 'STAFF' }, error: null };
    if (ops.includes('update')) return { data: db.updateRows, error: null };
    if (call.table === 'employees') return { data: db.employee, error: null };
    if (call.table === 'emergency_contact' && ops.includes('select')) return { data: db.contact, error: null };
    return { data: [], error: null };
  };
  const from = (table: string) => {
    const call: Call = { table, ops: [] };
    db.calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'order', 'not', 'limit', 'single', 'maybeSingle', 'update', 'insert', 'delete', 'upsert', 'in', 'is']) {
      chain[op] = (...args: unknown[]) => {
        call.ops.push({ op, args });
        return chain;
      };
    }
    chain.then = (resolve: (v: unknown) => void) => resolve(resultFor(call));
    return chain;
  };
  return {
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1', email: 'kiruti@co.com' } } }) },
      from,
      storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: 'https://x/y' } }) }) },
    },
  };
});
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import toast from 'react-hot-toast';
import EmployeeBioPage from './Bio';

// the staff portal shows this page at /staff: the address carries NO employee number
const open = () =>
  render(
    <MemoryRouter initialEntries={['/staff']}>
      <Routes>
        <Route path="/staff" element={<EmployeeBioPage />} />
      </Routes>
    </MemoryRouter>
  );

const callsTo = (table: string, op: string) => db.calls.filter((c) => c.table === table && c.ops.some((o) => o.op === op));
const filterValues = (call: Call) => call.ops.filter((o) => o.op === 'eq').map((o) => o.args[1]);

beforeEach(() => {
  db.calls = [];
  db.updateRows = [{ 'Employee Number': 'EMP-011' }];
  vi.mocked(toast.error).mockClear();
});
afterEach(() => cleanup());

const edit = async () => {
  fireEvent.click(await screen.findByText('update details'));
  fireEvent.click((await screen.findAllByText('Save Changes'))[0]);
};

describe('Bio Data in the staff portal (no employee number in the address)', () => {
  it('saves to the employee the page loaded, not to "nobody"', async () => {
    open();
    await edit();
    await waitFor(() => expect(callsTo('employees', 'update').length).toBeGreaterThan(0));
    const update = callsTo('employees', 'update')[0];
    expect(filterValues(update)).toContain('EMP-011'); // before: matched Employee Number = undefined, so nothing was saved
    expect(filterValues(update)).not.toContain(undefined);
  });

  it('loads and saves the emergency contact of that same employee', async () => {
    open();
    await edit();
    await waitFor(() => expect(callsTo('emergency_contact', 'upsert').length).toBeGreaterThan(0));
    const loads = callsTo('emergency_contact', 'select');
    expect(filterValues(loads[0])).toEqual(['EMP-011']);
    const upsert = callsTo('emergency_contact', 'upsert')[0].ops.find((o) => o.op === 'upsert')!.args[0] as Record<string, unknown>;
    expect(upsert['Employee Number']).toBe('EMP-011');
  });

  it('says so, and keeps the form, when the save changes nothing', async () => {
    db.updateRows = [];
    open();
    await edit();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('not saved')));
    expect(screen.getAllByText('Save Changes').length).toBeGreaterThan(0); // still on the form, nothing lost
  });
});
