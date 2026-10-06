import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ createCompany: vi.fn(), assign: vi.fn() }));

vi.mock('../lib/supabase', () => ({ supabase: { auth: { signOut: vi.fn() } } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../lib/companyApi', () => ({ companyApi: { createCompany: (...a: unknown[]) => api.createCompany(...a) } }));

import toast from 'react-hot-toast';
import NoCompany from './NoCompany';
import { readPendingCompany, writePendingCompany } from '../lib/pendingCompany';

beforeEach(() => {
  localStorage.clear();
  api.createCompany.mockReset().mockResolvedValue('tenant-1');
  api.assign.mockReset();
  vi.mocked(toast.error).mockClear();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign: api.assign } });
});
afterEach(() => cleanup());

describe('NoCompany', () => {
  it('without a waiting company name, asks what to call the company', () => {
    render(<NoCompany email="new@x.co" />);
    expect(screen.getByText('You are not in a company yet')).toBeTruthy();
    expect(api.createCompany).not.toHaveBeenCalled();
  });

  it('creates the company typed before the email was confirmed, once, and opens the dashboard', async () => {
    writePendingCompany('Acme Ltd');
    render(<NoCompany email="new@x.co" />);
    expect(screen.getByText('Setting up your company…')).toBeTruthy();
    await waitFor(() => expect(api.assign).toHaveBeenCalledWith('/dashboard'));
    expect(api.createCompany).toHaveBeenCalledTimes(1);
    expect(api.createCompany).toHaveBeenCalledWith('Acme Ltd');
    expect(readPendingCompany()).toBeNull(); // used up, so a reload cannot create it again
  });

  it('if that fails, shows the reason and the form with the name filled in', async () => {
    writePendingCompany('Acme Ltd');
    api.createCompany.mockRejectedValue(new Error('You already administer 10 companies'));
    render(<NoCompany email="new@x.co" />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('You already administer 10 companies'));
    const input = (await screen.findByPlaceholderText('Company name')) as HTMLInputElement;
    expect(input.value).toBe('Acme Ltd');
    expect(api.assign).not.toHaveBeenCalled();
  });
});
