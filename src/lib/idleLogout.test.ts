import { beforeEach, describe, expect, it } from 'vitest';
import { FALLBACK_IDLE_TIMEOUT_MS, IDLE_TIMEOUT_MS, IDLE_WARNING_MS, idleState, lastActivity, markActivity } from './idleLogout';

describe('idleLogout', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the last activity where every tab can read it', () => {
    expect(lastActivity()).toBeNull();
    markActivity(1000);
    expect(lastActivity()).toBe(1000);
    expect(localStorage.getItem('lastActivityAt')).toBe('1000');
  });

  it('warns a minute before the limit and signs out at it', () => {
    const last = 1_000_000;
    expect(idleState(last + IDLE_TIMEOUT_MS - IDLE_WARNING_MS - 1, last)).toBe('active');
    expect(idleState(last + IDLE_TIMEOUT_MS - IDLE_WARNING_MS, last)).toBe('warn');
    expect(idleState(last + IDLE_TIMEOUT_MS, last)).toBe('expired');
  });

  it('activity in another tab counts', () => {
    markActivity(0);
    const now = IDLE_TIMEOUT_MS - 5000;
    markActivity(now - 1000); // the other tab
    expect(idleState(now, lastActivity())).toBe('active');
  });

  it('nothing recorded yet is not idle', () => {
    expect(idleState(Date.now(), null)).toBe('active');
  });
});

describe('the company setting', () => {
  it('is 7 days unless the company chose otherwise; a shorter setting signs out sooner', () => {
    const last = 1_000_000;
    expect(IDLE_TIMEOUT_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(idleState(last + 3 * 24 * 60 * 60 * 1000, last)).toBe('active'); // 3 days away: still signed in
    expect(idleState(last + FALLBACK_IDLE_TIMEOUT_MS, last, 8 * 60 * 60 * 1000)).toBe('active');
    expect(idleState(last + FALLBACK_IDLE_TIMEOUT_MS, last, FALLBACK_IDLE_TIMEOUT_MS)).toBe('expired');
  });
});
