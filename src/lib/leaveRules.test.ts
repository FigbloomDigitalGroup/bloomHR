import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
import { describeFree } from './leaveRules';

describe('describeFree', () => {
  it('splits full-pay and half-pay days when the leave type has both', () => {
    expect(describeFree({ available: 20, fullPayLeft: 5, halfPayLeft: 15 })).toBe('5 full-pay + 15 half-pay days free to book');
  });

  it('otherwise says how many days are free, or nothing when there is no limit', () => {
    expect(describeFree({ available: 1, fullPayLeft: null, halfPayLeft: null })).toBe('1 day free to book');
    expect(describeFree({ available: 3.5, fullPayLeft: null, halfPayLeft: null })).toBe('3.5 days free to book');
    expect(describeFree({ available: null, fullPayLeft: null, halfPayLeft: null })).toBeNull();
  });
});
