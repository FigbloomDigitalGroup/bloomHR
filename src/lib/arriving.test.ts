import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARRIVING_KEY, ARRIVING_LABEL, clearArriving, isArriving, isHandoffWorking, markArriving } from './arriving';

// tests run from the repository's root
const indexHtml = readFileSync(`${process.cwd().replace(/\\/g, '/')}/index.html`, 'utf8');

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  document.title = 'Figbloom HR';
});
afterEach(() => vi.restoreAllMocks());

describe('the arriving flag', () => {
  it('is set by /handoff and read back, and /handoff itself counts while it works (not its status page)', () => {
    expect(isArriving()).toBe(false);
    markArriving();
    expect(sessionStorage.getItem(ARRIVING_KEY)).toBe('1');
    expect(isArriving()).toBe(true);
    clearArriving();
    expect(isArriving()).toBe(false);
    expect(isHandoffWorking('/handoff', '')).toBe(true);
    expect(isHandoffWorking('/handoff', '?status=off&from=fleet')).toBe(false);
    expect(isHandoffWorking('/login', '')).toBe(false);
  });

  it('puts the app\'s title back when it goes', () => {
    document.title = ARRIVING_LABEL;
    clearArriving();
    expect(document.title).toBe('Figbloom HR');
  });

  it('never throws when session storage is blocked', () => {
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error('blocked');
      });
    }
    expect(() => markArriving()).not.toThrow();
    expect(isArriving()).toBe(false);
    expect(() => clearArriving()).not.toThrow();
  });
});

// index.html's boot screen: its markup and inline script, run as the browser would before the app's code arrives
describe('index.html boot screen', () => {
  const body = indexHtml.match(/<div id="root">[\s\S]*?<\/div><\/div>/)?.[0] ?? '';
  const script = indexHtml.match(/<div id="root">[\s\S]*?<script>([\s\S]*?)<\/script>/)?.[1] ?? '';

  function boot(path: string) {
    window.history.replaceState(null, '', path);
    document.body.innerHTML = body;
    new Function(script)();
    return document.getElementById('boot');
  }

  it('has the markup and script to run', () => {
    expect(body).toContain('id="boot"');
    expect(script).toContain('fb-arriving');
  });

  it('as before: removed for signed-out visits and the sign-in pages, kept (no words) for a signed-in visit', () => {
    expect(boot('/dashboard')).toBeNull();
    localStorage.setItem('sb-abc-auth-token', '{}');
    expect(boot('/login')).toBeNull();
    const kept = boot('/dashboard');
    expect(kept).not.toBeNull();
    expect((document.getElementById('boot-text') as HTMLElement).hidden).toBe(true);
    expect(document.title).toBe('Figbloom HR');
  });

  it('arriving, it is the "Opening Figbloom HR" screen on every page, the sign-in page too', () => {
    sessionStorage.setItem(ARRIVING_KEY, '1');
    for (const path of ['/login', '/dashboard']) {
      const kept = boot(path);
      expect(kept, path).not.toBeNull();
      expect(kept?.getAttribute('aria-label')).toBe('Opening Figbloom HR');
      const text = document.getElementById('boot-text') as HTMLElement;
      expect(text.hidden).toBe(false);
      expect(text.textContent).toBe('Opening Figbloom HR...');
      expect(document.title).toBe('Opening Figbloom HR');
    }
  });

  it('on /handoff it is that screen already, signed out too, but not on its status page', () => {
    expect(boot('/handoff')).not.toBeNull();
    expect(boot('/handoff?status=off')).toBeNull();
  });

  it('uses the same 2.2 s orbit as FigbloomLoader', () => {
    expect(indexHtml).toMatch(/animation: boot-orbit 2\.2s infinite/);
    expect(indexHtml).not.toMatch(/boot-spin/);
  });

  it('shows the usual boot screen when session storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    localStorage.setItem('sb-abc-auth-token', '{}');
    expect(boot('/dashboard')).not.toBeNull();
    expect((document.getElementById('boot-text') as HTMLElement).hidden).toBe(true);
  });
});
