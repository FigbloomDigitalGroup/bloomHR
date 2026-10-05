import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ConfigError from './ConfigError';

afterEach(() => cleanup());

describe('ConfigError', () => {
  it('tells the person what is missing and what to do, instead of a blank page', () => {
    render(<ConfigError missing={['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']} />);
    expect(screen.getByRole('alert').textContent).toContain('not set up yet');
    expect(screen.getByText('VITE_SUPABASE_URL')).toBeTruthy();
    expect(screen.getByText('VITE_SUPABASE_ANON_KEY')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('redeploy');
  });
});
