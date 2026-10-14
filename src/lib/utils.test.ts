import { describe, expect, it } from 'vitest';
import { cn, groupBy } from './utils';

describe('cn', () => {
  it('joins class names and drops falsy values', () => {
    expect(cn('a', undefined, null, 'c')).toBe('a c');
  });

  it('lets later Tailwind classes override conflicting earlier ones', () => {
    expect(cn('p-2 text-sm', 'p-4')).toBe('text-sm p-4');
  });
});

describe('groupBy', () => {
  it('groups rows by key, keeping their order', () => {
    const rows = [{ e: 'A', n: 1 }, { e: 'B', n: 2 }, { e: 'A', n: 3 }];
    const groups = groupBy(rows, (r) => r.e);
    expect(groups.get('A')).toEqual([{ e: 'A', n: 1 }, { e: 'A', n: 3 }]);
    expect(groups.get('B')).toEqual([{ e: 'B', n: 2 }]);
    expect(groups.get('C')).toBeUndefined();
  });
});
