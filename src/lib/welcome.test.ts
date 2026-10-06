import { beforeEach, describe, expect, it } from 'vitest';
import { welcomeMessage } from './welcome';

beforeEach(() => localStorage.clear());

describe('welcomeMessage', () => {
  it('welcomes a first sign-in, then welcomes back', () => {
    expect(welcomeMessage('u1', 'a@b.co')).toBe('Welcome to Figbloom HR, a@b.co!');
    expect(welcomeMessage('u1', 'a@b.co')).toBe('Welcome back, a@b.co!');
  });

  it('remembers each person separately', () => {
    welcomeMessage('u1', 'a@b.co');
    expect(welcomeMessage('u2', 'c@d.co')).toBe('Welcome to Figbloom HR, c@d.co!');
  });

  it('says welcome back when the person is unknown', () => {
    expect(welcomeMessage(undefined, 'a@b.co')).toBe('Welcome back, a@b.co!');
  });
});
