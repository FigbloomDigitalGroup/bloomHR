import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { table: string; ops: { op: string; args: unknown[] }[] };

const mock = vi.hoisted(() => ({
  calls: [] as { table: string; ops: { op: string; args: unknown[] }[] }[],
  rpcs: [] as { name: string; args: unknown }[],
  members: [
    { user_id: 'user-ben', email: 'Ben@Co.com' },
    { user_id: 'user-me', email: 'me@co.com' },
  ] as { user_id: string; email: string }[],
  myDms: [] as { channel_id: string; other_user_id: string; other_email: string }[],
  startError: null as { message: string } | null,
  insertError: null as { message: string } | null,
  employee: null as Record<string, unknown> | null,
  authUser: { email: 'admin@co.com', user_metadata: {} } as { email: string; user_metadata: Record<string, unknown> },
}));

vi.mock('../../../lib/supabase', () => {
  const from = (table: string) => {
    const call: Call = { table, ops: [] };
    mock.calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'order', 'limit', 'gt', 'or', 'insert', 'upsert', 'update', 'in']) {
      chain[op] = (...args: unknown[]) => {
        call.ops.push({ op, args });
        return chain;
      };
    }
    const result = () => {
      const ops = call.ops.map((o) => o.op);
      if (table === 'employees') return { data: mock.employee, error: null };
      if (table === 'messages' && ops.includes('insert')) {
        return mock.insertError
          ? { data: null, error: mock.insertError }
          : { data: { id: 'msg-1', content: 'hi', created_at: '2026-10-06T10:00:00Z', author_id: 'user-me' }, error: null };
      }
      return { data: [], error: null, count: 0 };
    };
    chain.single = () => {
      call.ops.push({ op: 'single', args: [] });
      return Promise.resolve(result());
    };
    chain.then = (resolve: (v: unknown) => void) => resolve(result());
    return chain;
  };
  return {
    supabase: {
      from,
      rpc: (name: string, args?: unknown) => {
        mock.rpcs.push({ name, args });
        if (name === 'company_members') return Promise.resolve({ data: mock.members, error: null });
        if (name === 'my_direct_messages') return Promise.resolve({ data: mock.myDms, error: null });
        if (name === 'start_direct_message') {
          return Promise.resolve(mock.startError ? { data: null, error: mock.startError } : { data: '11111111-2222-3333-4444-555555555555', error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      auth: { getUser: () => Promise.resolve({ data: { user: mock.authUser } }) },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
      removeChannel: () => {},
    },
  };
});
vi.mock('../services/databaseService', () => ({ databaseService: {} }));
vi.mock('./databaseService', () => ({ databaseService: {} }));

import { chatService } from './chatServices';

const DM = 'dm-11111111-2222-3333-4444-555555555555';
const UUID = '11111111-2222-3333-4444-555555555555';

beforeEach(() => {
  mock.calls = [];
  mock.rpcs = [];
  mock.myDms = [];
  mock.startError = null;
  mock.insertError = null;
  mock.employee = null;
  mock.authUser = { email: 'admin@co.com', user_metadata: {} };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

const callsTo = (table: string, op: string) => mock.calls.filter((c) => c.table === table && c.ops.some((o) => o.op === op));

describe('starting a direct message', () => {
  it('finds the colleague by email (any letter case) and returns the stored conversation under a dm- id', async () => {
    const id = await chatService.startDirectMessage('ben@co.com');
    expect(id).toBe(DM);
    expect(mock.rpcs.find((r) => r.name === 'start_direct_message')?.args).toEqual({ p_other: 'user-ben' });
  });

  it('says plainly when the colleague has not joined, and starts nothing', async () => {
    await expect(chatService.startDirectMessage('nobody@co.com')).rejects.toThrow(/haven't joined yet/);
    expect(mock.rpcs.some((r) => r.name === 'start_direct_message')).toBe(false);
  });

  it('passes on the database’s refusal', async () => {
    mock.startError = { message: 'That person is not in your company' };
    await expect(chatService.startDirectMessage('ben@co.com')).rejects.toThrow('That person is not in your company');
  });
});

describe('my conversations', () => {
  it('are listed with the other person’s email, ready for the sidebar', async () => {
    mock.myDms = [{ channel_id: UUID, other_user_id: 'user-ben', other_email: 'Ben@Co.com' }];
    const channels = await chatService.getUserChannels('user-me');
    const dm = channels.find((c) => c.id === DM) as unknown as { partnerEmail: string; isPrivate: boolean };
    expect(dm).toBeTruthy();
    expect(dm.partnerEmail).toBe('ben@co.com');
    expect(dm.isPrivate).toBe(true);
  });
});

describe('messages in a direct message', () => {
  it('are read from the stored conversation (the id without the dm- prefix)', async () => {
    await chatService.getChannelMessages(DM);
    const read = callsTo('messages', 'select')[0];
    expect(read.ops.find((o) => o.op === 'eq')?.args).toEqual(['channel_id', UUID]);
  });

  it('are really stored when sent, as the sender, in that conversation', async () => {
    const message = await chatService.sendMessage(DM, 'user-me', 'hi');
    const insert = callsTo('messages', 'insert')[0].ops.find((o) => o.op === 'insert')!.args[0] as Record<string, unknown>;
    expect(insert.channel_id).toBe(UUID);
    expect(insert.author_id).toBe('user-me');
    expect(insert.content).toBe('hi');
    expect(message?.id).toBe('msg-1'); // a stored row, not a local "dm-msg-" placeholder
  });

  it('are never faked: when storing fails the sender is told', async () => {
    mock.insertError = { message: 'new row violates row-level security policy' };
    await expect(chatService.sendMessage(DM, 'user-me', 'hi')).rejects.toThrow(/row-level security/);
  });

  it('show the sender by name, not "User", even for an administrator with no employee record', async () => {
    mock.authUser = { email: 'mikekirutic@gmail.com', user_metadata: {} };
    await chatService.sendMessage(DM, 'user-me', 'hi');
    const insert = callsTo('messages', 'insert')[0].ops.find((o) => o.op === 'insert')!.args[0] as Record<string, unknown>;
    expect(insert.author_name).toBe('mikekirutic');
    expect(insert.author_initials).toBe('M');
  });

  it('use the name from the employee record when there is one', async () => {
    mock.employee = { 'First Name': 'Michael', 'Last Name': 'Kiruti' };
    await chatService.sendMessage(DM, 'user-me', 'hi');
    const insert = callsTo('messages', 'insert')[0].ops.find((o) => o.op === 'insert')!.args[0] as Record<string, unknown>;
    expect(insert.author_name).toBe('Michael Kiruti');
    expect(insert.author_initials).toBe('MK');
  });

  it('are marked read against the stored conversation', async () => {
    await chatService.markMessagesAsRead(DM, 'user-me');
    const upsert = callsTo('user_channel_states', 'upsert')[0].ops.find((o) => o.op === 'upsert')!.args[0] as Record<string, unknown>;
    expect(upsert.channel_id).toBe(UUID);
    expect(upsert.user_id).toBe('user-me');
  });
});

describe('ordinary channels are unchanged', () => {
  it('still use their own id, and still fall back to a local message if storing fails', async () => {
    mock.insertError = { message: 'boom' };
    const message = await chatService.sendMessage('chan-1', 'user-me', 'hello');
    expect(message?.id).toMatch(/^mock-/);
    const insert = callsTo('messages', 'insert')[0].ops.find((o) => o.op === 'insert')!.args[0] as Record<string, unknown>;
    expect(insert.channel_id).toBe('chan-1');
  });
});

describe('inviting people to a channel', () => {
  it('asks the database to add them, and says how many were added', async () => {
    const added = await chatService.addChannelMembers('chan-1', ['user-ben']);
    expect(mock.rpcs.find((r) => r.name === 'add_channel_members')?.args).toEqual({ p_channel: 'chan-1', p_users: ['user-ben'] });
    expect(added).toBe(0); // the mock returns no count
  });

  it('does nothing when no one was chosen', async () => {
    expect(await chatService.addChannelMembers('chan-1', [])).toBe(0);
    expect(mock.rpcs.some((r) => r.name === 'add_channel_members')).toBe(false);
  });

  it('lists who can be invited: the colleagues who joined, and the directory', async () => {
    const options = await chatService.getInviteOptions();
    expect(options.members.map((m) => m.user_id)).toEqual(['user-ben', 'user-me']);
    expect(callsTo('employee_directory', 'select')).toHaveLength(1);
  });
});
