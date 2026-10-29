import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { missingConfig } from './requiredConfig';

describe('browser code and import.meta.env', () => {
  it('never uses import.meta.env as a whole object (Vite would put every VITE_ value in the public bundle)', () => {
    const srcDir = join(process.cwd(), 'src'); // tests run from the repository's root
    const offenders = (readdirSync(srcDir, { recursive: true }) as string[])
      .filter((file) => /\.(ts|tsx|js|jsx)$/.test(file) && !/\.test\./.test(file))
      .filter((file) => /import\.meta\.env(?![.\w])/.test(readFileSync(join(srcDir, file), 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('missingConfig', () => {
  it('lists nothing when both settings are present', () => {
    expect(missingConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' })).toEqual([]);
  });

  it('names each missing setting', () => {
    expect(missingConfig({})).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']);
    expect(missingConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co' })).toEqual(['VITE_SUPABASE_ANON_KEY']);
  });

  it('treats empty and blank values as missing', () => {
    expect(missingConfig({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '   ' })).toEqual([
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY',
    ]);
  });

  it('never needs the server-only settings (those are not for the browser)', () => {
    expect(missingConfig({ SUPABASE_URL: 'x', SUPABASE_KEY: 'y' })).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']);
  });
});
