import { beforeEach, describe, expect, it, vi } from 'vitest';

const results: Record<string, { data: unknown; error: unknown }> = {};
const calls: string[] = [];

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      calls.push(table);
      const chain = { select: () => chain, order: () => chain, limit: () => Promise.resolve(results[table]) };
      return chain;
    },
  },
}));

import { clearEmployeeDirectoryCache, describeLoadError, loadEmployeeDirectory } from './employeeDirectory';

const row = { 'Employee Number': '005', 'First Name': 'Mike', 'Last Name': 'Otieno', 'Job Title': 'Accountant' };

beforeEach(() => {
  calls.length = 0;
  clearEmployeeDirectoryCache();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('loadEmployeeDirectory', () => {
  it('reads employee_directory when it works', async () => {
    results.employee_directory = { data: [row], error: null };
    const list = await loadEmployeeDirectory();
    expect(list.map((e) => e.fullName)).toEqual(['Mike Otieno']);
    expect(calls).toEqual(['employee_directory']);
  });

  it('falls back to the employees table when the directory cannot be read', async () => {
    results.employee_directory = { data: null, error: { message: 'relation "employee_directory" does not exist', code: '42P01' } };
    results.employees = { data: [row], error: null };
    const list = await loadEmployeeDirectory();
    expect(list).toHaveLength(1);
    expect(calls).toEqual(['employee_directory', 'employees']);
  });

  it('reports the real error when both fail, and does not cache the failure', async () => {
    results.employee_directory = { data: null, error: { message: 'permission denied', code: '42501' } };
    results.employees = { data: null, error: { message: 'permission denied for table employees', code: '42501' } };
    await expect(loadEmployeeDirectory()).rejects.toMatchObject({ code: '42501' });

    results.employee_directory = { data: [row], error: null };
    await expect(loadEmployeeDirectory()).resolves.toHaveLength(1);
  });
});

describe('describeLoadError', () => {
  it('uses the message of database error objects, which are not Error instances', () => {
    expect(describeLoadError({ message: 'permission denied', code: '42501', hint: 'check RLS' })).toBe(
      'permission denied - check RLS - (42501)'
    );
    expect(describeLoadError(new Error('boom'))).toBe('boom');
    expect(describeLoadError(null)).toBe('Unknown error');
  });
});
