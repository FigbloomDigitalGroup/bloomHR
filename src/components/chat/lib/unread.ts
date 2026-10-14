import { directMessageId, realChannelId } from './names';

/**
 * Unread badges, kept up to date from the realtime messages themselves (FIG-817). The counts are loaded once, with
 * my_unread_counts() (one query for all my channels); after that a message arriving is +1 on its channel's badge, rather
 * than every open chat in the company re-counting every channel it has on every message.
 */

/** Unread messages per channel, by the channel's real (database) id. */
export type UnreadCounts = Record<string, number>;

/** The columns of a `messages` row a realtime INSERT carries that the badges need. */
export interface IncomingMessage {
  channel_id?: string | null;
  author_id?: string | null;
  content?: string | null;
  created_at?: string | null;
}

/**
 * Whether a new message adds to my unread count: not my own (same rule as my_unread_counts()), and not in the chat I
 * have open (I am reading it; the open chat marks it read). `openChatId` may be a chat id ("dm-...") or a real id.
 */
export function countsAsUnread(message: IncomingMessage, me: string | null | undefined, openChatId?: string | null): boolean {
  if (!message.channel_id) return false;
  if (me && message.author_id === me) return false;
  return !(openChatId && realChannelId(openChatId) === message.channel_id);
}

/** The counts after a new message: +1 on its channel when it counts as unread, otherwise the same object. */
export function addIncoming(counts: UnreadCounts, message: IncomingMessage, me: string | null | undefined, openChatId?: string | null): UnreadCounts {
  if (!countsAsUnread(message, me, openChatId)) return counts;
  const channel = message.channel_id as string;
  return { ...counts, [channel]: (counts[channel] || 0) + 1 };
}

export const totalUnread = (counts: UnreadCounts): number => Object.values(counts).reduce((sum, n) => sum + (n || 0), 0);

/** my_unread_counts() rows as a lookup. */
export const toUnreadCounts = (rows: { channel_id: string; unread: number }[] | null | undefined): UnreadCounts =>
  Object.fromEntries((rows || []).map((r) => [r.channel_id, Number(r.unread) || 0]));

interface ChatEntry {
  id: string;
  unread_count?: number;
}

interface DirectMessageEntry extends ChatEntry {
  name: string;
  lastMessage?: string;
  lastMessageTime?: string;
  hasMessages?: boolean;
}

/** Whether a new message belongs to one of these chats (a channel by its id, a direct message by "dm-<id>"). */
export function findChat<T extends ChatEntry>(chats: T[], message: IncomingMessage): T | undefined {
  if (!message.channel_id) return undefined;
  const ids = [message.channel_id, directMessageId(message.channel_id)];
  return chats.find((c) => ids.includes(c.id));
}

/** Channels after a new message: its channel's badge goes up by one if it counts as unread. */
export function withIncomingChannelMessage<T extends ChatEntry>(channels: T[], message: IncomingMessage, unread: boolean): T[] {
  const chat = findChat(channels, message);
  if (!chat || !unread) return channels;
  return channels.map((c) => (c === chat ? { ...c, unread_count: (c.unread_count || 0) + 1 } : c));
}

/** Conversations with messages first, then the most recent first, then by name. */
export function sortDirectMessages<T extends DirectMessageEntry>(dms: T[]): T[] {
  return [...dms].sort((a, b) => {
    if (a.hasMessages && !b.hasMessages) return -1;
    if (!a.hasMessages && b.hasMessages) return 1;
    if (a.lastMessageTime && b.lastMessageTime) {
      return new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime();
    }
    return a.name.localeCompare(b.name);
  });
}

/** Direct messages after a new message: its conversation shows it as the latest, moves up, and counts it if unread. */
export function withIncomingDirectMessage<T extends DirectMessageEntry>(dms: T[], message: IncomingMessage, unread: boolean): T[] {
  const chat = findChat(dms, message);
  if (!chat) return dms;
  return sortDirectMessages(
    dms.map((dm) =>
      dm === chat
        ? {
            ...dm,
            unread_count: (dm.unread_count || 0) + (unread ? 1 : 0),
            hasMessages: true,
            lastMessage: message.content ?? dm.lastMessage,
            lastMessageTime: message.created_at ?? dm.lastMessageTime,
          }
        : dm
    )
  );
}
