import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { levelOf } from './notificationPreferences';

describe('levelOf (FIG-890)', () => {
  it('reads the level, falling back to the older on/off switch, and everything when nothing is set', () => {
    expect(levelOf({ email: true, email_level: 'important' })).toBe('important');
    expect(levelOf({ email: false, email_level: null })).toBe('off');
    expect(levelOf({ email: true, email_level: null })).toBe('all');
    expect(levelOf({ email_level: 'nonsense' })).toBe('all');
    expect(levelOf(null)).toBe('all');
  });
});
