import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';

vi.mock('../lib/supabase', () => ({ supabase: {} }));

const load = vi.hoisted(() => vi.fn());
vi.mock('../lib/employeeDirectory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/employeeDirectory')>();
  return { ...actual, loadEmployeeDirectory: load };
});

import { useEmployeeDirectory } from './useEmployeeDirectory';
import { createQueryClient } from '../lib/queryClient';
import { toDirectoryEmployee } from '../lib/employeeDirectory';

const mike = toDirectoryEmployee({ 'Employee Number': '005', 'First Name': 'Mike', 'Last Name': 'Otieno' });

let client = createQueryClient();
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  load.mockReset();
  client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, gcTime: Infinity, staleTime: 5 * 60 * 1000 } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('useEmployeeDirectory', () => {
  it('starts loading, then returns the staff', async () => {
    load.mockResolvedValue([mike]);
    const { result } = renderHook(() => useEmployeeDirectory(), { wrapper });
    expect(result.current).toMatchObject({ loading: true, employees: [], error: null });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.employees).toEqual([mike]);
  });

  it('makes one request for any number of pickers on screen, and none when one mounts later', async () => {
    load.mockResolvedValue([mike]);
    const a = renderHook(() => useEmployeeDirectory(), { wrapper });
    const b = renderHook(() => useEmployeeDirectory(), { wrapper });
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    await waitFor(() => expect(b.result.current.loading).toBe(false));

    const later = renderHook(() => useEmployeeDirectory(), { wrapper });
    expect(later.result.current.employees).toEqual([mike]); // straight from the cache, no flash of "loading"
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reports the real reason when it cannot load', async () => {
    load.mockRejectedValue({ message: 'permission denied', code: '42501' });
    const { result } = renderHook(() => useEmployeeDirectory(), { wrapper });
    await waitFor(() => expect(result.current.error).toBe('permission denied - (42501)'));
    expect(result.current.employees).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
