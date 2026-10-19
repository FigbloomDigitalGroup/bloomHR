import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  uploads: [] as string[],
  removed: [] as string[][],
  inserts: [] as Record<string, unknown>[],
  insertError: null as { message: string } | null,
  deleted: [{ id: 'd1' }] as unknown[],
  rpcs: [] as unknown[],
}));

vi.mock('./supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: (path: string) => {
          db.uploads.push(path);
          return Promise.resolve({ error: null });
        },
        remove: (paths: string[]) => {
          db.removed.push(paths);
          return Promise.resolve({ error: null });
        },
      }),
    },
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        db.inserts.push(row);
        return Promise.resolve({ error: db.insertError });
      },
      delete: () => ({ eq: () => ({ select: () => Promise.resolve({ data: db.deleted, error: null }) }) }),
    }),
    rpc: (fn: string, args: unknown) => {
      db.rpcs.push({ fn, args });
      return Promise.resolve({ error: null });
    },
  },
}));
vi.mock('./privateFiles', () => ({
  currentUserAndTenant: () => Promise.resolve({ userId: 'u1', tenantId: 't1' }),
  openPrivateFile: vi.fn(),
}));

import { deleteMyDocument, fileProblem, refereeProblem, rejectDocument, emptyReferee, uploadMyDocument, type EmployeeDocument } from './employeeDocuments';

const file = (name: string, size = 1000) => new File([new Uint8Array(size)], name, { type: 'application/pdf' });

beforeEach(() => {
  db.uploads = [];
  db.removed = [];
  db.inserts = [];
  db.insertError = null;
  db.deleted = [{ id: 'd1' }];
  db.rpcs = [];
});

describe('fileProblem', () => {
  it('takes PDFs, Word documents and photos up to 10 MB', () => {
    for (const n of ['cv.pdf', 'cv.DOCX', 'id.jpg', 'id.jpeg', 'photo.png', 'scan.heic']) expect(fileProblem(file(n)), n).toBeNull();
    expect(fileProblem(file('virus.exe'))).toMatch(/PDF, Word document or photo/);
    expect(fileProblem(file('big.pdf', 10 * 1024 * 1024 + 1))).toMatch(/10 MB/);
    expect(fileProblem(file('empty.pdf', 0))).toMatch(/empty/);
  });
});

describe('uploadMyDocument', () => {
  it('saves the file in the employee’s own folder, then records it', async () => {
    await uploadMyDocument('e1', 'cv', file('My CV.pdf'));
    expect(db.uploads[0]).toMatch(/^t1\/u1\/onboarding\/cv_\d+_[a-z0-9]+\.pdf$/);
    expect(db.inserts[0]).toMatchObject({ employee_id: 'e1', code: 'cv', file_path: db.uploads[0], file_name: 'My CV.pdf', size_bytes: 1000 });
  });

  it('an "other" document needs a title, which is saved with its description', async () => {
    await expect(uploadMyDocument('e1', 'other', file('aid.pdf'))).rejects.toThrow(/title/);
    expect(db.uploads).toHaveLength(0);
    await uploadMyDocument('e1', 'other', file('aid.pdf'), { title: ' First Aid certificate ', description: 'Red Cross' });
    expect(db.inserts[0]).toMatchObject({ code: 'other', title: 'First Aid certificate', description: 'Red Cross' });
  });

  it('removes the uploaded file again if it could not be recorded', async () => {
    db.insertError = { message: 'A document must be uploaded to your own folder' };
    await expect(uploadMyDocument('e1', 'cv', file('cv.pdf'))).rejects.toThrow(/your own folder/);
    expect(db.removed).toEqual([[db.uploads[0]]]);
  });

  it('refuses a file it won’t take before uploading anything', async () => {
    await expect(uploadMyDocument('e1', 'cv', file('cv.exe'))).rejects.toThrow(/PDF/);
    expect(db.uploads).toEqual([]);
  });
});

describe('deleteMyDocument', () => {
  const doc = { id: 'd1', file_path: 't1/u1/onboarding/cv.pdf' } as EmployeeDocument;

  it('removes the record and then the file', async () => {
    await deleteMyDocument(doc);
    expect(db.removed).toEqual([['t1/u1/onboarding/cv.pdf']]);
  });

  it('keeps the file when the record could not be removed (HR accepted it)', async () => {
    db.deleted = [];
    await expect(deleteMyDocument(doc)).rejects.toThrow(/HR has accepted it/);
    expect(db.removed).toEqual([]);
  });
});

describe('reviewing and referees', () => {
  it('a rejection needs a reason', async () => {
    await expect(rejectDocument('d1', '  ')).rejects.toThrow(/Say why/);
    expect(db.rpcs).toEqual([]);
    await rejectDocument('d1', ' Blurry ');
    expect(db.rpcs).toEqual([{ fn: 'review_employee_document', args: { p_document: 'd1', p_decision: 'reject', p_note: 'Blurry' } }]);
  });

  it('a referee needs a name and a phone number or email', () => {
    expect(refereeProblem(emptyReferee())).toMatch(/full name/);
    expect(refereeProblem({ ...emptyReferee(), full_name: 'Mary' })).toMatch(/phone number or email/);
    expect(refereeProblem({ ...emptyReferee(), full_name: 'Mary', email: 'm@co.com' })).toBeNull();
  });
});
