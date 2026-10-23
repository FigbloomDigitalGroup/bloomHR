import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

// The new-mail badge's count (FIG-1205): asked only with a connected mailbox, at most every 2 minutes while the tab
// is visible, reusing the last answer for 2 minutes, and waiting longer after errors.
const db = vi.hoisted(() => ({ count: 1 as number, error: null as unknown, queries: 0 }));
const api = vi.hoisted(() => ({ getUnreadCount: vi.fn() }));
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => {
        db.queries += 1;
        if (table !== 'user_mailboxes') throw new Error(`unexpected table ${table}`);
        return Promise.resolve({ count: db.count, error: db.error });
      },
    }),
  },
}));
vi.mock('../lib/mailboxApi', () => api);

import { notifyMailbox, useMailboxUnread, UNREAD_POLL_MS } from './useMailboxUnread';

let visibility: 'visible' | 'hidden' = 'visible';
const setVisibility = (v: 'visible' | 'hidden') => {
  visibility = v;
  document.dispatchEvent(new Event('visibilitychange'));
};
const MINUTE = 60 * 1000;
const flush = () => act(async () => {
  await vi.advanceTimersByTimeAsync(0);
});
const wait = (ms: number) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms);
});

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  visibility = 'visible';
  db.count = 1;
  db.error = null;
  db.queries = 0;
  api.getUnreadCount.mockReset();
  api.getUnreadCount.mockResolvedValue({ connected: true, unread: 3 });
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useMailboxUnread', () => {
  it('without the module: no database read and no mail server asked, ever', async () => {
    const { result } = renderHook(() => useMailboxUnread(false, 'mary@a.co'));
    await wait(30 * MINUTE);
    expect(result.current).toBe(0);
    expect(db.queries).toBe(0);
    expect(api.getUnreadCount).not.toHaveBeenCalled();
  });

  it('without a connected mailbox: one cheap database check, and /unread is never called', async () => {
    db.count = 0;
    const { result } = renderHook(() => useMailboxUnread(true, 'mary@a.co'));
    await wait(30 * MINUTE);
    setVisibility('hidden');
    setVisibility('visible');
    await wait(10 * MINUTE);
    expect(result.current).toBe(0);
    expect(db.queries).toBe(1);
    expect(api.getUnreadCount).not.toHaveBeenCalled();
  });

  it('with a mailbox: the count now, then every 2 minutes while the tab is visible', async () => {
    const { result } = renderHook(() => useMailboxUnread(true, 'mary@a.co'));
    await flush();
    expect(result.current).toBe(3);
    expect(api.getUnreadCount).toHaveBeenCalledTimes(1);
    api.getUnreadCount.mockResolvedValue({ connected: true, unread: 0 });
    await wait(UNREAD_POLL_MS - 1000);
    expect(api.getUnreadCount).toHaveBeenCalledTimes(1);
    await wait(1000);
    expect(api.getUnreadCount).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(0);

    // hidden: no asking at all
    setVisibility('hidden');
    await wait(20 * MINUTE);
    expect(api.getUnreadCount).toHaveBeenCalledTimes(2);
    // shown again: asks at once (the last answer is old)
    api.getUnreadCount.mockResolvedValue({ connected: true, unread: 5 });
    setVisibility('visible');
    await flush();
    expect(api.getUnreadCount).toHaveBeenCalledTimes(3);
    expect(result.current).toBe(5);
  });

  it('reuses the last answer for 2 minutes: another page or tab does not ask the mail server again', async () => {
    const first = renderHook(() => useMailboxUnread(true, 'mary@a.co'));
    await flush();
    first.unmount();
    await wait(MINUTE);
    const second = renderHook(() => useMailboxUnread(true, 'mary@a.co'));
    await flush();
    expect(second.result.current).toBe(3);
    expect(api.getUnreadCount).toHaveBeenCalledTimes(1);
    // the rest of the 2 minutes, then it asks
    await wait(MINUTE);
    expect(api.getUnreadCount).toHaveBeenCalledTimes(2);
  });

  it('backs off after errors: 4, 8, 16 minutes, up to 30; then back to every 2', async () => {
    api.getUnreadCount.mockRejectedValue(new Error('Too many checks for new mail.'));
    renderHook(() => useMailboxUnread(true, 'mary@a.co'));
    await flush();
    expect(api.getUnreadCount).toHaveBeenCalledTimes(1);
    await wait(4 * MINUTE - 1000);
    expect(api.getUnreadCount).toHaveBeenCalledTimes(1);
    await wait(1000);
    expect(api.getUnreadCount).toHaveBeenCalledTimes(2);
    await wait(8 * MINUTE);
    expect(api.getUnreadCount).toHaveBeenCalledTimes(3);
    await wait(16 * MINUTE);
    expect(api.getUnreadCount).toHaveBeenCalledTimes(4);
    await wait(30 * MINUTE);
    expect(api.getUnreadCount).toHaveBeenCalledTimes(5);
    api.getUnreadCount.mockResolvedValue({ connected: true, unread: 1 });
    await wait(30 * MINUTE);
    expect(api.getUnreadCount).toHaveBeenCalledTimes(6);
    await wait(UNREAD_POLL_MS);
    expect(api.getUnreadCount).toHaveBeenCalledTimes(7);
  });

  it('the mailbox screen updates the count and the connection; disconnected stops the asking', async () => {
    const { result } = renderHook(() => useMailboxUnread(true, 'mary@a.co'));
    await flush();
    act(() => notifyMailbox({ unread: 9 }));
    expect(result.current).toBe(9);
    act(() => notifyMailbox({ connected: false }));
    await flush();
    expect(result.current).toBe(0);
    const calls = api.getUnreadCount.mock.calls.length;
    await wait(30 * MINUTE);
    expect(api.getUnreadCount).toHaveBeenCalledTimes(calls);
    // the server says there is no mailbox any more: stops too
    api.getUnreadCount.mockResolvedValue({ connected: false, unread: 0 });
    act(() => notifyMailbox({ connected: true }));
    await wait(5 * MINUTE);
    const after = api.getUnreadCount.mock.calls.length;
    await wait(30 * MINUTE);
    expect(api.getUnreadCount).toHaveBeenCalledTimes(after);
    expect(result.current).toBe(0);
  });
});
