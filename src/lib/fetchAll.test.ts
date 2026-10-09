import { describe, expect, it } from 'vitest';
import { chunks, fetchAll } from './fetchAll';

/** A fake table of `total` rows that, like the API, returns the requested range capped at `cap` rows. */
const table = (total: number, cap = 1000) => {
  const rows = Array.from({ length: total }, (_, i) => ({ n: i }));
  const requests: [number, number][] = [];
  const page = (from: number, to: number) => {
    requests.push([from, to]);
    return Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + cap)), error: null });
  };
  return { rows, requests, page };
};

describe('fetchAll', () => {
  it('reads every row of a table larger than one page', async () => {
    const t = table(2500);
    const rows = await fetchAll(t.page);
    expect(rows).toHaveLength(2500);
    expect(rows.map((r) => r.n)).toEqual(t.rows.map((r) => r.n));
    expect(t.requests).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('asks once more when the last page is exactly full, then stops', async () => {
    const t = table(2000);
    expect(await fetchAll(t.page)).toHaveLength(2000);
    expect(t.requests).toHaveLength(3);
  });

  it('handles an empty table and a null result', async () => {
    expect(await fetchAll(table(0).page)).toEqual([]);
    expect(await fetchAll(() => Promise.resolve({ data: null, error: null }))).toEqual([]);
  });

  it('stops at the first error', async () => {
    const failure = { message: 'permission denied' };
    await expect(fetchAll(() => Promise.resolve({ data: null, error: failure }))).rejects.toBe(failure);
  });
});

describe('chunks', () => {
  it('splits into pieces of at most the given size', () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 3)).toEqual([]);
  });

  it('rejects a size below 1', () => {
    expect(() => chunks([1], 0)).toThrow();
  });
});
