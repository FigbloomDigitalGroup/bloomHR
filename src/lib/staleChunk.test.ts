import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isStaleChunkError, reloadOnceForStaleChunk } from './staleChunk';

beforeEach(() => sessionStorage.clear());

describe('isStaleChunkError', () => {
  it('recognises a page file that no longer exists after a deploy', () => {
    expect(isStaleChunkError(new Error('Failed to fetch dynamically imported module: https://x/assets/UserRole.abc.js'))).toBe(true);
    expect(isStaleChunkError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isStaleChunkError({ message: 'Importing a module script failed.' })).toBe(true);
  });

  it('does not treat ordinary errors as stale pages', () => {
    expect(isStaleChunkError(new Error("Cannot read properties of undefined (reading 'email')"))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
  });
});

describe('reloadOnceForStaleChunk', () => {
  it('reloads the first time', () => {
    const reload = vi.fn();
    expect(reloadOnceForStaleChunk(1_000_000, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload again straight away, so a real fault cannot loop', () => {
    const reload = vi.fn();
    reloadOnceForStaleChunk(1_000_000, reload);
    expect(reloadOnceForStaleChunk(1_010_000, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('may reload again after half a minute', () => {
    const reload = vi.fn();
    reloadOnceForStaleChunk(1_000_000, reload);
    expect(reloadOnceForStaleChunk(1_031_000, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
