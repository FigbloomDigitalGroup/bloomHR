import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  result: { login_user_id: 'u1', files: ['t/u1/onboarding/cv.pdf'] } as { login_user_id: string | null; files: string[] },
  removed: [] as string[][],
  deletedUsers: [] as string[],
  adminFails: false,
}));
vi.mock('./supabase', () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: db.result, error: null }),
    storage: { from: () => ({ remove: (paths: string[]) => { db.removed.push(paths); return Promise.resolve({ error: null }); } }) },
  },
}));
vi.mock('./adminApi', () => ({
  adminApi: {
    deleteUser: (id: string) => {
      if (db.adminFails) return Promise.reject(new Error('Only administrators can do this'));
      db.deletedUsers.push(id);
      return Promise.resolve({ ok: true });
    },
  },
}));

import { deleteEmployee } from './employeeDelete';

beforeEach(() => {
  db.result = { login_user_id: 'u1', files: ['t/u1/onboarding/cv.pdf'] };
  db.removed = [];
  db.deletedUsers = [];
  db.adminFails = false;
});

describe('deleteEmployee', () => {
  it('removes their files, and their login when asked', async () => {
    expect(await deleteEmployee('e1', true)).toEqual({ loginRemoved: true, loginKept: false });
    expect(db.removed).toEqual([['t/u1/onboarding/cv.pdf']]);
    expect(db.deletedUsers).toEqual(['u1']);
  });

  it('keeps the login when not asked', async () => {
    expect(await deleteEmployee('e1', false)).toEqual({ loginRemoved: false, loginKept: true });
    expect(db.deletedUsers).toEqual([]);
  });

  it('says so when the login could not be removed (the employee is still deleted)', async () => {
    db.adminFails = true;
    expect(await deleteEmployee('e1', true)).toEqual({ loginRemoved: false, loginKept: true, loginProblem: 'Only administrators can do this' });
  });

  it('nothing to do for someone without a login or files', async () => {
    db.result = { login_user_id: null, files: [] };
    expect(await deleteEmployee('e1', true)).toEqual({ loginRemoved: false, loginKept: false });
    expect(db.removed).toEqual([]);
  });
});
