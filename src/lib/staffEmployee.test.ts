import { describe, expect, it, vi } from 'vitest';
import { assertEmployeeForStaffLogin } from './staffEmployee';

// Only `.eq` is provided on purpose: if the check ever goes back to `.ilike`
// (wildcard matching) these tests fail with "ilike is not a function".
const fakeClient = (result: { data: unknown; error: unknown }) => {
  const eq = vi.fn(() => ({ maybeSingle: () => Promise.resolve(result) }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as never, from, select, eq };
};

describe('assertEmployeeForStaffLogin', () => {
  it('does not query for non-STAFF roles', async () => {
    const { client, from } = fakeClient({ data: null, error: null });
    for (const role of ['ADMIN', 'HR', 'MANAGER', 'OPERATIONS', 'CHECKER', 'REGIONAL']) {
      await expect(assertEmployeeForStaffLogin(client, role, 'a@b.co')).resolves.toBeUndefined();
    }
    expect(from).not.toHaveBeenCalled();
  });

  it('passes when a STAFF email matches an employee, using an exact Work Email match', async () => {
    const { client, from, eq } = fakeClient({ data: { 'Employee Number': 'EMP-1' }, error: null });
    await expect(assertEmployeeForStaffLogin(client, 'STAFF', 'jane_doe@x.co')).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith('employees');
    expect(eq).toHaveBeenCalledWith('"Work Email"', 'jane_doe@x.co');
  });

  it('rejects a STAFF login when no employee has that Work Email', async () => {
    const { client } = fakeClient({ data: null, error: null });
    await expect(assertEmployeeForStaffLogin(client, 'STAFF', 'ghost@x.co')).rejects.toThrow(
      /No employee has the Work Email ghost@x\.co/
    );
  });

  it('propagates database errors instead of treating them as "no employee"', async () => {
    const dbError = new Error('connection lost');
    const { client } = fakeClient({ data: null, error: dbError });
    await expect(assertEmployeeForStaffLogin(client, 'STAFF', 'a@b.co')).rejects.toBe(dbError);
  });
});
