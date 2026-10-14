import { describe, expect, it } from 'vitest';
import {
  addIncoming,
  countsAsUnread,
  findChat,
  sortDirectMessages,
  toUnreadCounts,
  totalUnread,
  withIncomingChannelMessage,
  withIncomingDirectMessage,
} from './unread';

const ME = 'me';
const fromBen = (channel_id: string, extra: Record<string, string> = {}) => ({ channel_id, author_id: 'ben', ...extra });

describe('countsAsUnread', () => {
  it('counts a colleague’s message in a chat I do not have open', () => {
    expect(countsAsUnread(fromBen('c1'), ME, 'c2')).toBe(true);
    expect(countsAsUnread(fromBen('c1'), ME, null)).toBe(true);
  });

  it('never counts my own message, the chat I have open (a direct message by its "dm-" id too), or a row with no channel', () => {
    expect(countsAsUnread({ channel_id: 'c1', author_id: ME }, ME, null)).toBe(false);
    expect(countsAsUnread(fromBen('c1'), ME, 'c1')).toBe(false);
    expect(countsAsUnread(fromBen('d1'), ME, 'dm-d1')).toBe(false);
    expect(countsAsUnread({ author_id: 'ben' }, ME, null)).toBe(false);
  });
});

describe('addIncoming / totalUnread / toUnreadCounts', () => {
  it('adds one to the message’s channel only, starting a channel it has not seen at 1', () => {
    const before = toUnreadCounts([{ channel_id: 'c1', unread: 2 }, { channel_id: 'c2', unread: 0 }]);
    const after = addIncoming(addIncoming(before, fromBen('c1'), ME), fromBen('c3'), ME);
    expect(after).toEqual({ c1: 3, c2: 0, c3: 1 });
    expect(totalUnread(after)).toBe(4);
    expect(before).toEqual({ c1: 2, c2: 0 }); // not changed in place
  });

  it('returns the same object when nothing changes (no re-render)', () => {
    const counts = { c1: 1 };
    expect(addIncoming(counts, { channel_id: 'c1', author_id: ME }, ME)).toBe(counts);
    expect(addIncoming(counts, fromBen('c1'), ME, 'c1')).toBe(counts);
  });

  it('reads missing rows as no counts', () => {
    expect(toUnreadCounts(null)).toEqual({});
  });
});

describe('the Teams sidebar', () => {
  const channels = [
    { id: 'c1', unread_count: 0 },
    { id: 'c2', unread_count: 5 },
  ];
  const dms = [
    { id: 'dm-d1', name: 'Anna', unread_count: 0, hasMessages: true, lastMessage: 'old', lastMessageTime: '2026-10-01T10:00:00Z' },
    { id: 'dm-d2', name: 'Ben', unread_count: 1, hasMessages: true, lastMessage: 'newer', lastMessageTime: '2026-10-02T10:00:00Z' },
    { id: 'dm-d3', name: 'Carl', unread_count: 0, hasMessages: false },
  ];

  it('finds a channel by its id and a direct message by "dm-<id>"', () => {
    expect(findChat(channels, fromBen('c2'))?.id).toBe('c2');
    expect(findChat(dms, fromBen('d1'))?.id).toBe('dm-d1');
    expect(findChat(channels, fromBen('zz'))).toBeUndefined();
  });

  it('raises the badge of the message’s channel only when it counts as unread', () => {
    expect(withIncomingChannelMessage(channels, fromBen('c2'), true)).toEqual([
      { id: 'c1', unread_count: 0 },
      { id: 'c2', unread_count: 6 },
    ]);
    expect(withIncomingChannelMessage(channels, fromBen('c2'), false)).toBe(channels);
    expect(withIncomingChannelMessage(channels, fromBen('zz'), true)).toBe(channels);
  });

  it('shows the new message as the conversation’s latest and moves it to the top', () => {
    const after = withIncomingDirectMessage(dms, fromBen('d1', { content: 'hello', created_at: '2026-10-03T10:00:00Z' }), true);
    expect(after.map((d) => d.id)).toEqual(['dm-d1', 'dm-d2', 'dm-d3']);
    expect(after[0]).toMatchObject({ unread_count: 1, lastMessage: 'hello', lastMessageTime: '2026-10-03T10:00:00Z', hasMessages: true });
    // the open conversation: latest message updated, badge unchanged
    expect(withIncomingDirectMessage(dms, fromBen('d3', { content: 'hi' }), false).find((d) => d.id === 'dm-d3')).toMatchObject({
      unread_count: 0,
      hasMessages: true,
      lastMessage: 'hi',
    });
  });

  it('sorts conversations with messages first, newest first, then by name', () => {
    expect(sortDirectMessages(dms).map((d) => d.id)).toEqual(['dm-d2', 'dm-d1', 'dm-d3']);
  });
});
