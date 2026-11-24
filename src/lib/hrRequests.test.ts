import { describe, expect, it } from 'vitest';
import { attentionLabel, hrRequestPending, requestedWhen } from './hrRequests';

describe('HR requests from Fleet and Property', () => {
  it('is pending while asked for and HR is off, unknown or has no platform account; not once enabling or on', () => {
    const at = '2026-11-20T09:00:00Z';
    expect(hrRequestPending({ hr_requested_at: at, hr: { state: 'off' } })).toBe(true);
    expect(hrRequestPending({ hr_requested_at: at, hr: { state: 'unknown' } })).toBe(true);
    expect(hrRequestPending({ hr_requested_at: at, hr: null })).toBe(true);
    expect(hrRequestPending({ hr_requested_at: at, hr: { state: 'enabling' } })).toBe(false);
    expect(hrRequestPending({ hr_requested_at: at, hr: { state: 'on' } })).toBe(false);
    // older product versions don't send it
    expect(hrRequestPending({ hr: { state: 'off' } })).toBe(false);
    expect(hrRequestPending({ hr_requested_at: null, hr: { state: 'off' } })).toBe(false);
    expect(hrRequestPending({ hr_requested_at: 'garbage', hr: { state: 'off' } })).toBe(false);
  });

  it('says when, shortly', () => {
    const now = new Date(2026, 10, 24, 15, 0);
    expect(requestedWhen(new Date(2026, 10, 24, 8, 0).toISOString(), now)).toBe('today');
    expect(requestedWhen(new Date(2026, 10, 23, 23, 0).toISOString(), now)).toBe('yesterday');
    expect(requestedWhen(new Date(2026, 10, 20, 12, 0).toISOString(), now)).toBe('4 days ago');
    expect(requestedWhen(new Date(2026, 10, 2, 12, 0).toISOString(), now)).toMatch(/^2 Nov$/);
    expect(requestedWhen(new Date(2025, 11, 30, 12, 0).toISOString(), now)).toMatch(/30 Dec 2025/);
    expect(requestedWhen('nope', now)).toBe('');
  });

  it("words the menu badge", () => {
    expect(attentionLabel(2, 1)).toBe('2 waiting for approval, 1 asking for HR & Payroll');
    expect(attentionLabel(0, 3)).toBe('3 asking for HR & Payroll');
    expect(attentionLabel(1, 0)).toBe('1 waiting for approval');
  });
});
