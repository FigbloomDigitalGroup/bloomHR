import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../lib/supabase', () => ({ supabase: {} }));

import { useFormDraft } from './useFormDraft';
import { readFormDraft } from '../lib/formDraft';

const saved = { name: 'Amina', nssf: '' };

beforeEach(() => sessionStorage.clear());

describe('useFormDraft', () => {
  it('keeps edits as they are typed and brings them back after a reload', () => {
    const apply = vi.fn();
    const first = renderHook(({ current }) => useFormDraft('bio:E1', current, saved, apply), { initialProps: { current: saved } });
    expect(readFormDraft('bio:E1')).toBeNull();
    first.rerender({ current: { name: 'Amina', nssf: '12345' } });
    expect(readFormDraft('bio:E1')?.data).toEqual({ name: 'Amina', nssf: '12345' });
    first.unmount();

    const restore = vi.fn();
    const again = renderHook(() => useFormDraft('bio:E1', saved, saved, restore));
    expect(restore).toHaveBeenCalledWith({ name: 'Amina', nssf: '12345' });
    expect(again.result.current.restoredAt).not.toBeNull();
  });

  it('nothing is kept while the form is as saved', () => {
    const { rerender } = renderHook(({ current }) => useFormDraft('bio:E1', current, saved, vi.fn()), { initialProps: { current: saved } });
    rerender({ current: { name: 'Ami', nssf: '' } });
    expect(readFormDraft('bio:E1')).not.toBeNull();
    rerender({ current: saved });
    expect(readFormDraft('bio:E1')).toBeNull();
  });

  it('discard goes back to what was saved; clear forgets the draft after a save', () => {
    const apply = vi.fn();
    const { result, rerender } = renderHook(({ current }) => useFormDraft('bio:E1', current, saved, apply), { initialProps: { current: saved } });
    rerender({ current: { name: 'Ami', nssf: '' } });
    act(() => result.current.discard());
    expect(apply).toHaveBeenLastCalledWith(saved);
    rerender({ current: { name: 'Ami', nssf: '' } });
    act(() => result.current.clear());
    expect(readFormDraft('bio:E1')).toBeNull();
  });

  it('a draft that matches what was saved is not "restored"', () => {
    sessionStorage.setItem('formDraft:bio:E1', JSON.stringify({ at: 1, data: saved }));
    const apply = vi.fn();
    const { result } = renderHook(() => useFormDraft('bio:E1', saved, saved, apply));
    expect(apply).not.toHaveBeenCalled();
    expect(result.current.restoredAt).toBeNull();
  });

  it('does nothing until the record is loaded', () => {
    const apply = vi.fn();
    renderHook(() => useFormDraft(null, { name: 'x', nssf: '' }, saved, apply));
    expect(sessionStorage.length).toBe(0);
  });
});
