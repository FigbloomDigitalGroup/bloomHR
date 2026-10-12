import { beforeEach, describe, expect, it, vi } from 'vitest';

// a record of every database call, and what each one answers
const db = vi.hoisted(() => ({
  calls: [] as { table: string; op: string; args: unknown[] }[],
  rpcs: [] as { fn: string; args: unknown }[],
  updated: [{ 'Employee Number': 'E1' }] as unknown[],
  rpcError: null as { message: string } | null,
  drafts: [] as { id: string }[],
}));

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      const record = (op: string) => (...args: unknown[]) => {
        db.calls.push({ table, op, args });
        return b;
      };
      for (const op of ['select', 'update', 'eq', 'in', 'order']) b[op] = record(op);
      b.upsert = (...args: unknown[]) => {
        db.calls.push({ table, op: 'upsert', args });
        return Promise.resolve({ error: null });
      };
      // awaiting the builder: an update returns the updated rows, a select the drafts
      b.then = (resolve: (v: unknown) => void) =>
        resolve(db.calls.some((c) => c.table === table && c.op === 'update') ? { data: db.updated, error: null } : { data: db.drafts, error: null });
      return b;
    },
    rpc: (fn: string, args: unknown) => {
      db.rpcs.push({ fn, args });
      return Promise.resolve({ data: null, error: db.rpcError });
    },
  },
}));

const invite = vi.hoisted(() => ({ outcome: { status: 'sent', email: 'a@co.com' } as Record<string, unknown> }));
vi.mock('./employeeInvite', () => ({ inviteEmployee: () => Promise.resolve(invite.outcome) }));

import { emptyContact, inviteToOnboard, requestOnboardingChanges, saveMyOnboarding, startOnboardingByEmail, statusLabel } from './onboarding';

beforeEach(() => {
  db.calls = [];
  db.rpcs = [];
  db.updated = [{ 'Employee Number': 'E1' }];
  db.rpcError = null;
  db.drafts = [];
  invite.outcome = { status: 'sent', email: 'a@co.com' };
});

describe('saveMyOnboarding', () => {
  it('sends only the employee’s own fields, trimmed, with blanks as nothing', async () => {
    await saveMyOnboarding('E1', { 'Tax PIN': ' A012345678B ', 'Middle Name': '  ', 'Basic Salary': 999999, onboarding_status: 'approved', is_pwd: false }, emptyContact(), emptyContact());
    const update = db.calls.find((c) => c.op === 'update')!;
    expect(update.args[0]).toEqual({ 'Tax PIN': 'A012345678B', 'Middle Name': null, is_pwd: false });
  });

  it('saves the emergency contact and next of kin once they have a name and phone, one per employee', async () => {
    const kin = { ...emptyContact(), full_name: 'Juma', relationship: 'Brother', phone_number: '0712345678' };
    await saveMyOnboarding('E1', {}, emptyContact(), kin);
    const upserts = db.calls.filter((c) => c.op === 'upsert');
    expect(upserts.map((u) => u.table)).toEqual(['next_of_kin']);
    expect(upserts[0].args[0]).toMatchObject({ 'Employee Number': 'E1', full_name: 'Juma', alternative_phone: null });
    expect(upserts[0].args[1]).toEqual({ onConflict: 'tenant_id,Employee Number' });
  });

  it('says so when the record was not saved (login not linked to it)', async () => {
    db.updated = [];
    await expect(saveMyOnboarding('E1', {}, emptyContact(), emptyContact())).rejects.toThrow(/not linked/);
  });
});

describe('inviteToOnboard', () => {
  it('emails the invitation and marks the record invited', async () => {
    expect(await inviteToOnboard('id-1', 'a@co.com')).toEqual({ status: 'sent', email: 'a@co.com' });
    expect(db.rpcs).toEqual([{ fn: 'start_onboarding', args: { p_employee: 'id-1' } }]);
  });

  it('leaves the record a draft when no invitation could be made', async () => {
    invite.outcome = { status: 'failed', email: 'a@co.com', reason: 'nope' };
    expect((await inviteToOnboard('id-1', 'a@co.com')).status).toBe('failed');
    expect(db.rpcs).toEqual([]);
  });

  it('reports the database’s reason if the record could not be marked', async () => {
    db.rpcError = { message: 'This record is already approved' };
    expect(await inviteToOnboard('id-1', 'a@co.com')).toEqual({ status: 'failed', email: 'a@co.com', reason: 'This record is already approved' });
  });
});

describe('startOnboardingByEmail', () => {
  it('marks each draft found by work email as invited', async () => {
    db.drafts = [{ id: 'd1' }, { id: 'd2' }];
    expect(await startOnboardingByEmail(['a@co.com', 'b@co.com'])).toBe(0);
    expect(db.rpcs.map((r) => r.args)).toEqual([{ p_employee: 'd1' }, { p_employee: 'd2' }]);
    expect(db.calls).toContainEqual({ table: 'employees', op: 'eq', args: ['onboarding_status', 'draft'] });
  });

  it('does nothing for an empty list', async () => {
    expect(await startOnboardingByEmail([])).toBe(0);
    expect(db.calls).toEqual([]);
  });
});

describe('requestOnboardingChanges', () => {
  it('needs a comment, and does not call the database without one', async () => {
    await expect(requestOnboardingChanges('id-1', '   ')).rejects.toThrow(/Say what needs changing/);
    expect(db.rpcs).toEqual([]);
    await requestOnboardingChanges('id-1', ' Upload a clearer ID ');
    expect(db.rpcs).toEqual([{ fn: 'review_onboarding', args: { p_employee: 'id-1', p_decision: 'request_changes', p_comment: 'Upload a clearer ID' } }]);
  });
});

describe('statusLabel', () => {
  it('names each step, and treats an unknown one as not invited', () => {
    expect(statusLabel('submitted')).toBe('Waiting for review');
    expect(statusLabel('changes_requested')).toBe('Changes requested');
    expect(statusLabel(undefined)).toBe('Not invited');
  });
});
