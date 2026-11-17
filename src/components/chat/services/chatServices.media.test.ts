import { beforeEach, describe, expect, it, vi } from 'vitest';

// The chat service against a stand-in for Supabase: what it uploads where, and what it stores for replies,
// files and reactions.
type Call = { table: string; ops: { op: string; args: unknown[] }[] };

const mock = vi.hoisted(() => ({
  calls: [] as { table: string; ops: { op: string; args: unknown[] }[] }[],
  uploads: [] as { bucket: string; path: string; options: unknown }[],
  removed: [] as { bucket: string; paths: string[] }[],
  failUploadOf: '' as string,
  insertError: null as { message: string } | null,
  deleted: [{ id: 'm1' }] as { id: string }[],
}));

vi.mock('../../../lib/supabase', () => {
  const from = (table: string) => {
    const call: Call = { table, ops: [] };
    mock.calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'order', 'limit', 'insert', 'update', 'delete', 'in', 'maybeSingle']) {
      chain[op] = (...args: unknown[]) => {
        call.ops.push({ op, args });
        return chain;
      };
    }
    const result = () => {
      const ops = call.ops.map((o) => o.op);
      if (table === 'user_profiles') return { data: { tenant_id: 'tenant-1' }, error: null };
      if (table === 'employees') return { data: { 'First Name': 'Anna', 'Last Name': 'W' }, error: null };
      if (table === 'messages' && ops.includes('insert')) {
        if (mock.insertError) return { data: null, error: mock.insertError };
        const row = call.ops.find((o) => o.op === 'insert')?.args[0] as Record<string, unknown>;
        return { data: { id: 'msg-new', created_at: '2026-10-27T10:00:00Z', ...row }, error: null };
      }
      if (table === 'messages' && ops.includes('delete')) return { data: mock.deleted, error: null };
      if (table === 'message_reactions' && ops.includes('insert')) {
        const row = call.ops.find((o) => o.op === 'insert')?.args[0] as Record<string, unknown>;
        return { data: { id: 'r-new', ...row }, error: null };
      }
      if (table === 'message_reactions') return { data: [{ id: 'r1', message_id: 'm1', user_id: 'u1', emoji: '👍' }], error: null };
      return { data: null, error: null };
    };
    chain.single = () => Promise.resolve(result());
    chain.maybeSingle = () => Promise.resolve(result());
    chain.then = (resolve: (v: unknown) => void) => resolve(result());
    return chain;
  };
  return {
    supabase: {
      from,
      rpc: () => Promise.resolve({ data: null, error: null }),
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-me', email: 'anna@co.com', user_metadata: {} } } }) },
      storage: {
        from: (bucket: string) => ({
          upload: (path: string, _file: File, options: unknown) => {
            mock.uploads.push({ bucket, path, options });
            return Promise.resolve({ error: path.endsWith('.pdf') && mock.failUploadOf ? { message: mock.failUploadOf } : null });
          },
          remove: (paths: string[]) => {
            mock.removed.push({ bucket, paths });
            return Promise.resolve({ error: null });
          },
        }),
      },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
      removeChannel: () => {},
    },
  };
});
vi.mock('./databaseService', () => ({ databaseService: {} }));

import { chatService } from './chatServices';

const CHAT = '11111111-2222-3333-4444-555555555555';
const file = (name: string, type: string, size = 100) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

beforeEach(() => {
  mock.calls = [];
  mock.uploads = [];
  mock.removed = [];
  mock.failUploadOf = '';
  mock.insertError = null;
  mock.deleted = [{ id: 'm1' }];
});

describe('uploading files', () => {
  it('puts each file in the chat’s own folder of the private bucket, under a random name', async () => {
    const sent = await chatService.uploadAttachments(`dm-${CHAT}`, [file('My Photo.PNG', 'image/png', 2048)]);
    expect(mock.uploads).toHaveLength(1);
    expect(mock.uploads[0].bucket).toBe('chat-attachments');
    expect(mock.uploads[0].path).toMatch(new RegExp(`^tenant-1/${CHAT}/[0-9a-f-]{36}\\.png$`));
    expect(mock.uploads[0].options).toEqual({ contentType: 'image/png' });
    expect(sent).toEqual([{ path: mock.uploads[0].path, name: 'My Photo.PNG', type: 'image/png', size: 2048 }]);
  });

  it('refuses a file over 25 MB before uploading anything', async () => {
    await expect(chatService.uploadAttachments(CHAT, [file('big.pdf', 'application/pdf', 26 * 1024 * 1024)])).rejects.toThrow(/25 MB/);
    expect(mock.uploads).toEqual([]);
  });

  it('takes back the files already uploaded when one fails', async () => {
    mock.failUploadOf = 'storage is full';
    await expect(chatService.uploadAttachments(CHAT, [file('a.png', 'image/png'), file('b.pdf', 'application/pdf')])).rejects.toThrow(
      /b.pdf could not be uploaded/
    );
    expect(mock.removed).toEqual([{ bucket: 'chat-attachments', paths: [mock.uploads[0].path] }]);
  });
});

describe('sending', () => {
  it('stores the reply and the files with the message', async () => {
    const attachments = [{ path: `tenant-1/${CHAT}/x.png`, name: 'x.png', type: 'image/png', size: 1 }];
    const message = await chatService.sendMessage(CHAT, 'user-me', '', { replyTo: 'm1', attachments });
    const insert = mock.calls.find((c) => c.table === 'messages')?.ops.find((o) => o.op === 'insert')?.args[0] as Record<string, unknown>;
    expect(insert).toMatchObject({ channel_id: CHAT, reply_to: 'm1', attachments, content: '' });
    expect(message).toMatchObject({ id: 'msg-new', replyTo: 'm1', attachments });
  });

  it('never pretends a reply or a file was sent when saving failed', async () => {
    mock.insertError = { message: 'denied' };
    await expect(chatService.sendMessage(CHAT, 'user-me', 'yes', { replyTo: 'm1' })).rejects.toThrow('denied');
  });
});

describe('reactions', () => {
  it('adds my reaction, or removes it when I already have it', async () => {
    expect(await chatService.toggleReaction('m1', '👍', 'user-me')).toEqual({
      added: { id: 'r-new', messageId: 'm1', userId: 'user-me', emoji: '👍' },
    });
    expect(await chatService.toggleReaction('m1', '👍', 'user-me', { id: 'r-new', messageId: 'm1', userId: 'user-me', emoji: '👍' })).toEqual({
      removedId: 'r-new',
    });
    const remove = mock.calls[mock.calls.length - 1];
    expect(remove.ops.map((o) => o.op)).toEqual(['delete', 'eq']);
  });

  it('loads the reactions of real messages only, in batches', async () => {
    const ids = ['welcome-x', ...Array.from({ length: 150 }, (_, i) => `m${i}`)];
    const rows = await chatService.getReactions(ids);
    const queries = mock.calls.filter((c) => c.table === 'message_reactions');
    expect(queries).toHaveLength(2);
    expect((queries[0].ops.find((o) => o.op === 'in')?.args[1] as string[]).includes('welcome-x')).toBe(false);
    expect(rows[0]).toEqual({ id: 'r1', messageId: 'm1', userId: 'u1', emoji: '👍' });
  });
});

describe('deleting', () => {
  it('deletes my message and then its files', async () => {
    await chatService.deleteMessage({
      id: 'm1',
      content: '',
      timestamp: '',
      author: { id: 'user-me', name: 'Me', avatar: '', initials: 'M', email: '', status: 'online' },
      attachments: [{ path: `tenant-1/${CHAT}/x.png`, name: 'x.png', type: 'image/png', size: 1 }],
    });
    expect(mock.removed).toEqual([{ bucket: 'chat-attachments', paths: [`tenant-1/${CHAT}/x.png`] }]);
  });

  it('says so when the message was not mine (nothing was deleted)', async () => {
    mock.deleted = [];
    await expect(
      chatService.deleteMessage({ id: 'm1', content: 'x', timestamp: '', author: { id: 'b', name: 'B', avatar: '', initials: 'B', email: '', status: 'online' } })
    ).rejects.toThrow(/your own/);
    expect(mock.removed).toEqual([]);
  });
});
