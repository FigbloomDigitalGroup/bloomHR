import type { Reaction, ReactionRow } from '../types/types';

/**
 * The reactions on one message, one entry per emoji in the order they were first used, with who chose it and whether
 * I did. Built from the stored rows so that a reaction added or taken away (live, by anyone) only changes the rows.
 */
export function summarizeReactions(rows: ReactionRow[], messageId: string, me: string): Reaction[] {
  const byEmoji = new Map<string, Reaction>();
  for (const row of rows) {
    if (row.messageId !== messageId) continue;
    const entry = byEmoji.get(row.emoji) ?? { emoji: row.emoji, count: 0, users: [], mine: false };
    if (entry.users.includes(row.userId)) continue;
    entry.users.push(row.userId);
    entry.count += 1;
    entry.mine = entry.mine || row.userId === me;
    byEmoji.set(row.emoji, entry);
  }
  return [...byEmoji.values()];
}

/** My reaction with this emoji on this message, if I have one (so a second click removes it). */
export const myReaction = (rows: ReactionRow[], messageId: string, emoji: string, me: string): ReactionRow | undefined =>
  rows.find((r) => r.messageId === messageId && r.emoji === emoji && r.userId === me);

/** Adds a row unless it is already there (my own reaction comes back to me over realtime too). */
export const withReaction = (rows: ReactionRow[], row: ReactionRow): ReactionRow[] =>
  rows.some((r) => r.id === row.id || (r.messageId === row.messageId && r.userId === row.userId && r.emoji === row.emoji))
    ? rows
    : [...rows, row];

/** "You, Anna Wanjiru and Ben Otieno": who reacted, for the tooltip on a reaction. */
export function reactorNames(users: string[], me: string, names: Record<string, string>): string {
  const labels = [...users].sort((a, b) => (a === me ? -1 : b === me ? 1 : 0)).map((id) => (id === me ? 'You' : names[id] || 'Someone'));
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
