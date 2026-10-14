import { beforeEach, describe, expect, it, vi } from 'vitest';

// Saving a bulk upload and queueing its invitations (FIG-818): a few hundred per database call, each row's result
// kept, a refused call reported for its rows without stopping the rest.
const db = vi.hoisted(() => ({
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  answer: (_fn: string, _args: Record<string, unknown>): { data: unknown; error: unknown } => ({ data: null, error: null }),
}));

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      db.rpcs.push({ fn, args });
      return Promise.resolve(db.answer(fn, args));
    },
  },
}));

import { describeSaveError, saveEmployeesInBatches, type UploadRow } from './bulkEmployees';
import { progressSummary, queueInvitations } from './inviteQueue';

beforeEach(() => {
  db.rpcs = [];
  db.answer = () => ({ data: null, error: null });
});

const rowsOf = (n: number): UploadRow[] =>
  Array.from({ length: n }, (_, i) => ({ row: i + 2, data: { 'Employee Number': `E-${i}`, 'Work Email': `e${i}@co.com` } }));

describe('saveEmployeesInBatches', () => {
  it('saves 200 rows per call, in order, and reports progress after each', async () => {
    db.answer = (_fn, args) => ({
      data: (args.p_rows as UploadRow[]).map((r) => ({ row_no: r.row, employee_number: r.data['Employee Number'], outcome: 'created', employee_id: 'x', work_email: r.data['Work Email'], error_code: null, error_message: null })),
      error: null,
    });
    const progress: number[] = [];
    const saved = await saveEmployeesInBatches(rowsOf(450), (_s, done) => progress.push(done));
    expect(db.rpcs.map((r) => (r.args.p_rows as unknown[]).length)).toEqual([200, 200, 50]);
    expect(db.rpcs.every((r) => r.fn === 'save_employees_batch')).toBe(true);
    expect(progress).toEqual([200, 400, 450]);
    expect(saved.map((s) => s.row_no)).toEqual(rowsOf(450).map((r) => r.row));
  });

  it('a call the database refuses is reported for each of its rows, and the next batch is still tried', async () => {
    let call = 0;
    db.answer = (_fn, args) =>
      call++ === 0
        ? { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
        : { data: (args.p_rows as UploadRow[]).map((r) => ({ row_no: r.row, outcome: 'created' })), error: null };
    const saved = await saveEmployeesInBatches(rowsOf(3), undefined, 2);
    expect(saved.map((s) => [s.row_no, s.outcome])).toEqual([[2, 'error'], [3, 'error'], [4, 'created']]);
    expect(saved[0]).toMatchObject({ employee_number: 'E-0', error_message: 'not saved: canceling statement due to statement timeout' });
  });
});

describe('describeSaveError', () => {
  it('says which value is already taken', () => {
    expect(describeSaveError('23505', 'duplicate key value violates unique constraint "employees_Work Email_key"')).toBe('another employee already has this work email');
    expect(describeSaveError('23505', 'duplicate key value violates unique constraint "employees_tax_pin_key"')).toBe('another employee already has this KRA PIN');
    expect(describeSaveError('42501', 'new row violates row-level security policy for table "employees"')).toBe('you may not add or change employees');
    expect(describeSaveError('23514', 'KRA PIN "NOPE" should look like A123456789B')).toBe('KRA PIN "NOPE" should look like A123456789B');
    expect(describeSaveError(null, null)).toBe('could not be saved');
  });
});

describe('queueInvitations', () => {
  it('queues in chunks of 500, all in one batch, adding up what each chunk says', async () => {
    db.answer = (_fn, args) => {
      const people = args.p_people as { email: string }[];
      return { data: [{ batch_id: args.p_batch, queued: people.length - 1, skipped: 1, rejected: [] }], error: null };
    };
    const people = Array.from({ length: 1100 }, (_, i) => ({ email: `p${i}@co.com` }));
    const result = await queueInvitations(people, 'batch-1');
    expect(db.rpcs.map((r) => [r.fn, (r.args.p_people as unknown[]).length, r.args.p_batch])).toEqual([
      ['enqueue_invitations', 500, 'batch-1'],
      ['enqueue_invitations', 500, 'batch-1'],
      ['enqueue_invitations', 100, 'batch-1'],
    ]);
    expect(result).toEqual({ batchId: 'batch-1', queued: 1097, skipped: 3, rejected: [] });
    expect((db.rpcs[0].args.p_people as { role: string }[])[0]).toEqual({ email: 'p0@co.com', role: 'STAFF' });
  });

  it('a refused chunk is reported for each person in it; the others are still queued', async () => {
    let call = 0;
    db.answer = () =>
      call++ === 0
        ? { data: null, error: { message: 'Only an administrator or HR can invite people' } }
        : { data: [{ queued: 1, skipped: 0, rejected: [{ email: 'bad', reason: 'not a valid email address' }] }], error: null };
    const result = await queueInvitations([{ email: 'a@co.com' }, { email: 'b@co.com' }, { email: 'bad' }], 'b', 2);
    expect(result.queued).toBe(1);
    expect(result.rejected).toEqual([
      { email: 'a@co.com', reason: 'Only an administrator or HR can invite people' },
      { email: 'b@co.com', reason: 'Only an administrator or HR can invite people' },
      { email: 'bad', reason: 'not a valid email address' },
    ]);
  });

  it('makes a batch id when none is given', async () => {
    db.answer = () => ({ data: [{ queued: 1, skipped: 0, rejected: [] }], error: null });
    const { batchId } = await queueInvitations([{ email: 'a@co.com' }]);
    expect(batchId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('progressSummary', () => {
  it('counts sent, skipped and failed as done, and is finished when nothing waits', () => {
    const base = { total: 10, queued: 3, sending: 2, sent: 4, skipped: 0, failed: 1, failures: [] };
    expect(progressSummary(base)).toEqual({ done: 5, total: 10, waiting: 5, finished: false });
    expect(progressSummary({ ...base, queued: 0, sending: 0, sent: 9 })).toMatchObject({ done: 10, finished: true });
  });
});
