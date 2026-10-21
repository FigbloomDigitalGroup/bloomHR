import { beforeEach, describe, expect, it } from 'vitest';
import { IDLE_TIMEOUT_MS, IDLE_WARNING_MS, idleState, lastActivity, markActivity } from './idleLogout';

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
