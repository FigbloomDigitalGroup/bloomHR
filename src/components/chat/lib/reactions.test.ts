import { describe, expect, it } from 'vitest';
import { myReaction, reactorNames, summarizeReactions, withReaction } from './reactions';
import type { ReactionRow } from '../types/types';

const row = (id: string, messageId: string, userId: string, emoji: string): ReactionRow => ({ id, messageId, userId, emoji });

describe('summarizeReactions', () => {
  const rows = [
    row('r1', 'm1', 'ben', '👍'),
    row('r2', 'm1', 'me', '👍'),
    row('r3', 'm1', 'ben', '❤️'),
    row('r4', 'm2', 'me', '😄'), // another message
  ];

  it('counts each emoji once per person, in the order first used, and knows which are mine', () => {
    expect(summarizeReactions(rows, 'm1', 'me')).toEqual([
      { emoji: '👍', count: 2, users: ['ben', 'me'], mine: true },
      { emoji: '❤️', count: 1, users: ['ben'], mine: false },
    ]);
  });

  it('ignores a doubled row (my own reaction can come back over realtime)', () => {
    expect(summarizeReactions([...rows, row('r9', 'm1', 'ben', '👍')], 'm1', 'me')[0].count).toBe(2);
  });

  it('has nothing for a message nobody reacted to', () => {
    expect(summarizeReactions(rows, 'm3', 'me')).toEqual([]);
  });
});

describe('myReaction and withReaction', () => {
  it('finds my reaction to take it back, not someone else’s', () => {
    const rows = [row('r1', 'm1', 'ben', '👍'), row('r2', 'm1', 'me', '👍')];
    expect(myReaction(rows, 'm1', '👍', 'me')?.id).toBe('r2');
    expect(myReaction(rows, 'm1', '❤️', 'me')).toBeUndefined();
  });

  it('adds a reaction once, however many times it arrives', () => {
    const once = withReaction([], row('r1', 'm1', 'me', '👍'));
    expect(withReaction(once, row('r1', 'm1', 'me', '👍'))).toBe(once);
    expect(withReaction(once, row('r2', 'm1', 'ben', '👍'))).toHaveLength(2);
  });
});

describe('reactorNames', () => {
  const names = { ben: 'Ben Otieno', anna: 'Anna Wanjiru' };
  it('says who reacted, me first as "You"', () => {
    expect(reactorNames(['ben'], 'me', names)).toBe('Ben Otieno');
    expect(reactorNames(['ben', 'me'], 'me', names)).toBe('You and Ben Otieno');
    expect(reactorNames(['anna', 'ben', 'me'], 'me', names)).toBe('You, Anna Wanjiru and Ben Otieno');
    expect(reactorNames(['ghost'], 'me', names)).toBe('Someone');
  });
});
