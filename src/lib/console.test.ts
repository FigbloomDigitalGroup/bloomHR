import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONSOLE_DEV_FLAG, CONSOLE_HOSTNAMES, isConsoleHost } from './console';

const at = (address: string) => window.history.replaceState(null, '', address);

afterEach(() => {
  window.localStorage.clear();
  at('/');
  vi.unstubAllEnvs();
});

describe('which addresses open the Figbloom console', () => {
  it('the console hostnames do', () => {
    expect(CONSOLE_HOSTNAMES).toEqual(['console.figbloom.org', 'console-staging.figbloom.org']);
    expect(isConsoleHost('console.figbloom.org')).toBe(true);
    expect(isConsoleHost('console-staging.figbloom.org')).toBe(true);
    expect(isConsoleHost('Console.Figbloom.org')).toBe(true);
  });

  it('the company app and look-alike hostnames do not', () => {
    for (const host of ['hr.figbloom.org', 'staging.figbloom.org', 'figbloom.org', 'localhost', 'console.figbloom.org.evil.com', 'xconsole.figbloom.org']) {
      expect(isConsoleHost(host)).toBe(false);
    }
  });

  it('reads the open page by default', () => {
    expect(isConsoleHost()).toBe(false); // jsdom is localhost
  });

  it('can be tried locally with ?console=1, remembered until ?console=0', () => {
    vi.stubEnv('DEV', true);
    at('/?console=1');
    expect(isConsoleHost('localhost')).toBe(true);
    at('/platform/rates');
    expect(isConsoleHost('localhost')).toBe(true);
    at('/?console=0');
    expect(isConsoleHost('localhost')).toBe(false);
    expect(window.localStorage.getItem(CONSOLE_DEV_FLAG)).toBeNull();
  });

  it('a production build ignores the local switch', () => {
    vi.stubEnv('DEV', false);
    at('/?console=1');
    expect(isConsoleHost('localhost')).toBe(false);
    window.localStorage.setItem(CONSOLE_DEV_FLAG, '1');
    expect(isConsoleHost('localhost')).toBe(false);
  });
});
