import { describe, expect, it, vi } from 'vitest';

vi.mock('react', async (importOriginal) => importOriginal());

import { shouldShowUpdate } from './sw';

describe('shouldShowUpdate', () => {
  it('stays quiet when the server publishes the version that is already running', () => {
    expect(shouldShowUpdate('1.0.1+abc', '1.0.1+abc', null)).toBe(false);
  });

  it('shows when a different version is published', () => {
    expect(shouldShowUpdate('1.0.2+def', '1.0.1+abc', null)).toBe(true);
  });

  it('does nothing when the server gives no version', () => {
    expect(shouldShowUpdate(undefined, '1.0.1+abc', null)).toBe(false);
    expect(shouldShowUpdate('', '1.0.1+abc', null)).toBe(false);
  });

  it('does not ask again for a version the person already reloaded for (a mismatch a refresh cannot fix)', () => {
    // running 1.0.1, server says 1.0.0, and they have already pressed Refresh Now once
    expect(shouldShowUpdate('1.0.0', '1.0.1', '1.0.0')).toBe(false);
  });

  it('still shows for a newer version after they refreshed for an older one', () => {
    expect(shouldShowUpdate('1.0.3', '1.0.1', '1.0.2')).toBe(true);
  });
});
