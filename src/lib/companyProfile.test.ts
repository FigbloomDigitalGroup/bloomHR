import { describe, expect, it, vi } from 'vitest';

// each table answers with what the test puts here
const tables = vi.hoisted(() => ({} as Record<string, { data: unknown; error: unknown }>));
vi.mock('./supabase', () => {
  const query = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'limit']) chain[m] = () => chain;
    chain.maybeSingle = () => Promise.resolve(tables[table]);
    return chain;
  };
  return { supabase: { from: query } };
});

import { cleanProfile, loadCompanyIdentity, normaliseWebsite, profileErrors } from './companyProfile';

const base = {
  company_name: 'Acme', tagline: null, logo_url: null, primary_color: null, secondary_color: null, description: null,
  registration_no: null, business_type: null, industry: null, country: 'Kenya', base_currency: 'KES', official_phone: null,
  official_email: null, website: null, address_line1: null, address_line2: null, city: null, postal_code: null,
  fiscal_year_start_month: 1, week_start_day: 'monday', letterhead_header_url: null, letterhead_footer_url: null,
};

describe('loadCompanyIdentity', () => {
  it('reads the name, logo and tagline from the profile', async () => {
    tables.company_profile = { data: { company_name: 'Acme', image_url: 'https://x/a.png', company_tagline: 'Hi' }, error: null };
    expect(await loadCompanyIdentity()).toEqual({ company_name: 'Acme', image_url: 'https://x/a.png', company_tagline: 'Hi' });
  });

  it('falls back to company_logo when the profile cannot be read (migration not applied yet)', async () => {
    tables.company_profile = { data: null, error: { code: '42P01', message: 'relation does not exist' } };
    tables.company_logo = { data: { company_name: 'Old', image_url: 'https://x/o.png', company_tagline: null }, error: null };
    expect(await loadCompanyIdentity()).toEqual({ company_name: 'Old', image_url: 'https://x/o.png', company_tagline: null });
  });
});

describe('profile validation', () => {
  it('accepts a good profile and names each bad field', () => {
    expect(profileErrors({ ...base, official_email: 'a@b.co', website: 'acme.co.ke', official_phone: '+254 712 345678', primary_color: '#AABBCC' })).toEqual({});
    const e = profileErrors({ ...base, company_name: ' ', official_email: 'x', website: 'no', official_phone: 'call', secondary_color: 'red' });
    expect(Object.keys(e).sort()).toEqual(['company_name', 'official_email', 'official_phone', 'secondary_color', 'website']);
  });

  it('saves blanks as null, the website with https:// and colours in capitals', () => {
    expect(normaliseWebsite('acme.co.ke')).toBe('https://acme.co.ke');
    expect(normaliseWebsite('http://a.co')).toBe('http://a.co');
    expect(cleanProfile({ ...base, city: '  ', website: 'acme.co.ke', primary_color: '#aabbcc' })).toMatchObject({
      city: null, website: 'https://acme.co.ke', primary_color: '#AABBCC',
    });
  });
});
