import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ existing: [] as unknown[], inserted: [] as unknown[] }));
vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ ilike: () => ({ limit: () => Promise.resolve({ data: db.existing }) }) }),
      insert: (row: unknown) => {
        db.inserted.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

import { STARTER_DEPARTMENTS, ensureBranchListed, optionsWithStarters } from './employeeOptions';

describe('optionsWithStarters', () => {
  it("puts the company's own values first, then starters it doesn't have, without blanks or repeats", () => {
    expect(optionsWithStarters(['Farm Ops', '', null, 'finance', 'Farm Ops'], ['Finance', 'IT'])).toEqual(['Farm Ops', 'finance', 'IT']);
  });
  it('gives a new company the starter departments', () => {
    expect(optionsWithStarters([], STARTER_DEPARTMENTS)).toEqual(STARTER_DEPARTMENTS);
  });
});

describe('ensureBranchListed', () => {
  it('adds a new branch, with its town, to the branch list', async () => {
    db.existing = [];
    db.inserted = [];
    await ensureBranchListed(' Eldoret ', 'Eldoret Town');
    expect(db.inserted).toEqual([{ 'Branch Office': 'Eldoret', Town: 'Eldoret Town' }]);
  });
  it('leaves a branch that is already listed, and ignores empty ones', async () => {
    db.existing = [{ id: 1 }];
    db.inserted = [];
    await ensureBranchListed('Nairobi', null);
    await ensureBranchListed('', null);
    expect(db.inserted).toEqual([]);
  });
});
