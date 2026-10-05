import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ES module script with no type declarations
import { resolveAppVersion, versionFile } from '../scripts/appVersion.mjs';

const builtAt = new Date('2026-10-05T15:30:45Z');

describe('resolveAppVersion', () => {
  it('uses an explicit VITE_APP_VERSION when one is set', () => {
    expect(resolveAppVersion({ explicit: '2.4.0', pkgVersion: '1.0.1', commit: 'abc1234', builtAt })).toBe('2.4.0');
  });

  it('otherwise uses the package version plus the commit, so every deploy is distinct', () => {
    expect(resolveAppVersion({ explicit: '', pkgVersion: '1.0.1', commit: 'abc1234', builtAt })).toBe('1.0.1+abc1234');
  });

  it('falls back to the build time when there is no git checkout', () => {
    expect(resolveAppVersion({ pkgVersion: '1.0.1', commit: '', builtAt })).toBe('1.0.1+202610051530');
  });

  it('ignores blank or padded values', () => {
    expect(resolveAppVersion({ explicit: '   ', pkgVersion: '1.0.1', commit: ' abc ', builtAt })).toBe('1.0.1+abc');
  });
});

describe('versionFile', () => {
  it('publishes the same version string the build bakes in', () => {
    const v = resolveAppVersion({ pkgVersion: '1.0.1', commit: 'abc1234', builtAt });
    expect(versionFile(v, builtAt)).toMatchObject({ version: '1.0.1+abc1234', buildDate: '2026-10-05T15:30:45.000Z', forceUpdate: false });
  });
});
