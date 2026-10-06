import { describe, expect, it } from 'vitest';
import { tokenFromInput } from './inviteToken';

describe('tokenFromInput', () => {
  it('reads the token from a full invitation link', () => {
    expect(tokenFromInput('https://bloom-hr-phi.vercel.app/join?token=abc123')).toBe('abc123');
  });

  it('accepts the bare token, ignoring spaces around it', () => {
    expect(tokenFromInput('  abc123  ')).toBe('abc123');
  });

  it('decodes an encoded token and ignores other parameters', () => {
    expect(tokenFromInput('https://x.co/join?utm=1&token=a%20b')).toBe('a b');
  });

  it('falls back to the text when a link has no token', () => {
    expect(tokenFromInput('https://x.co/join')).toBe('https://x.co/join');
  });
});
