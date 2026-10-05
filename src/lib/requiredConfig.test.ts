import { describe, expect, it } from 'vitest';
import { missingConfig } from './requiredConfig';

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
