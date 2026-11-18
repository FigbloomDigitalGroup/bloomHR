// @vitest-environment node
//
// Every migration has its own version (the number before the first underscore). Two files with the same version are
// both kept in the folder, but the database records only one: the second is silently never applied (it happened with
// 20261118300000, a loan change and the ID card one, merged on different branches the same day).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(__dirname, '..', 'migrations');

describe('migration versions', () => {
  it('no two migrations share a version', () => {
    const byVersion = new Map<string, string[]>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
      const version = file.split('_')[0];
      byVersion.set(version, [...(byVersion.get(version) ?? []), file]);
    }
    const clashes = [...byVersion.values()].filter((files) => files.length > 1);
    expect(clashes).toEqual([]);
  });
});
