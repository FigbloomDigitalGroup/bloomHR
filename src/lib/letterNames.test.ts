import { beforeEach, describe, expect, it, vi } from 'vitest';

// The names on a letter when the records are thin: the company's when its profile has none, the sender's when they
// have no employee record (the "Your company" / "mikesuperadmin" letter, Oct 26).

const state = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  identity: null as Record<string, unknown> | null,
  companies: [] as { name: string; is_current: boolean }[],
  employee: null as Record<string, unknown> | null,
  userProfile: null as Record<string, unknown> | null,
  user: { id: 'u1', email: 'mikesuperadmin@figbloom.org', user_metadata: {} as Record<string, unknown> },
}));

vi.mock('./companyProfile', () => ({
  loadCompanyProfile: () => Promise.resolve(state.profile),
  loadCompanyIdentity: () => Promise.resolve(state.identity),
}));
vi.mock('./companyApi', () => ({ companyApi: { myCompanies: () => Promise.resolve(state.companies) } }));
vi.mock('./supabase', () => {
  const query = (table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: () => Promise.resolve({ data: table === 'employees' ? state.employee : state.userProfile, error: null }),
    };
    return q;
  };
  return { supabase: { auth: { getUser: () => Promise.resolve({ data: { user: state.user } }) }, from: query } };
});

import { loadBranding } from './offers';
import { loadLetterSender } from './exitLetters';

beforeEach(() => {
  state.profile = null;
  state.identity = null;
  state.companies = [{ name: 'Other Co', is_current: false }, { name: 'Figbloom Digital Group', is_current: true }];
  state.employee = null;
  state.userProfile = null;
});

describe('the company name on a letter', () => {
  it('is the profile’s; without one, the old logo settings’ name, then the company’s own name', async () => {
    state.profile = { company_name: 'Figbloom Digital Group Ltd' };
    expect((await loadBranding()).name).toBe('Figbloom Digital Group Ltd');
    state.profile = null;
    state.identity = { company_name: 'Figbloom (logo)' };
    expect((await loadBranding()).name).toBe('Figbloom (logo)');
    state.identity = null;
    expect((await loadBranding()).name).toBe('Figbloom Digital Group');
    state.profile = { company_name: '  ' };
    expect((await loadBranding()).name).toBe('Figbloom Digital Group');
  });

  it('is “Your company” only when no name can be found', async () => {
    state.companies = [];
    expect((await loadBranding()).name).toBe('Your company');
  });
});

describe('the sender on a letter', () => {
  it('is their employee record’s name and title', async () => {
    state.employee = { 'First Name': 'Zilpar', 'Last Name': 'Okoth', 'Job Title': 'Human Resource Officer' };
    expect(await loadLetterSender()).toEqual({ name: 'Zilpar Okoth', title: 'Human Resource Officer' });
  });

  it('without an employee record, the name on their account; the email only as a last resort', async () => {
    state.userProfile = { full_name: 'Michael Kiruti' };
    expect(await loadLetterSender()).toEqual({ name: 'Michael Kiruti', title: '' });
    state.userProfile = null;
    expect(await loadLetterSender()).toEqual({ name: 'mikesuperadmin', title: '' });
  });
});
