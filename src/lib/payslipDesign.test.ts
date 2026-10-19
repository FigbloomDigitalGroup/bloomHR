import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { DEFAULT_DESIGN, designError, designOf, payslipEmployer } from './payslipDesign';

// FIG-814: the company's payslip design and the employer block it gives each payslip.

const profile = {
  company_name: 'Acme Ltd', logo_url: 'https://cdn.example/logo.png', address_line1: 'Plot 7', address_line2: 'Mombasa Road', city: 'Nairobi', postal_code: '00100',
  official_phone: '+254 700 000000', official_email: 'info@acme.co', website: 'acme.co', letterhead_header_url: 'https://cdn.example/offer-lh.png',
};

describe('the design', () => {
  it('defaults when there is none, and fills in what a saved row leaves out', () => {
    expect(designOf(null)).toEqual(DEFAULT_DESIGN);
    expect(designOf({ show_ytd: false, brand_color: 'green', letterhead: 'poster', employer_tax_numbers: { Uganda: ' 1000123456 ', Tanzania: '' } })).toEqual({
      ...DEFAULT_DESIGN, show_ytd: false, employer_tax_numbers: { Uganda: '1000123456' },
    });
  });

  it('checks what it saves', () => {
    expect(designError(DEFAULT_DESIGN)).toBeNull();
    expect(designError({ ...DEFAULT_DESIGN, brand_color: '#12' })).toMatch(/colour/);
    expect(designError({ ...DEFAULT_DESIGN, letterhead: 'own' })).toMatch(/Upload a letterhead/);
    expect(designError({ ...DEFAULT_DESIGN, email: 'nope' })).toMatch(/email/);
  });
});

describe('the employer block', () => {
  it("defaults to the company profile, with Kenya's employer KRA PIN", () => {
    const e = payslipEmployer({ design: DEFAULT_DESIGN, profile, country: 'Kenya', employerKraPin: 'P051234567X' });
    expect(e).toEqual({
      name: 'Acme Ltd', logoUrl: 'https://cdn.example/logo.png', letterheadUrl: null, address: 'Plot 7, Mombasa Road, Nairobi 00100',
      phone: '+254 700 000000', email: 'info@acme.co', website: 'acme.co', taxLabel: 'KRA PIN', taxNumber: 'P051234567X',
    });
  });

  it('the design overrides the profile; a branch address overrides the design; a branch override wins', () => {
    const design = { ...DEFAULT_DESIGN, address: 'P.O. Box 1, Nairobi', phone: '+254 711 111111' };
    expect(payslipEmployer({ design, profile, country: 'Kenya' }).address).toBe('P.O. Box 1, Nairobi');
    const branch = { id: 'b1', name: 'Kampala', country: 'Uganda', city: 'Kampala', address: 'Plot 1, Kampala Road' };
    const withBranch = payslipEmployer({ design, profile, branch, country: 'Uganda' });
    expect(withBranch.address).toBe('Plot 1, Kampala Road, Kampala');
    expect(withBranch.phone).toBe('+254 711 111111');
    const own = { branch_id: 'b1', address: 'Kampala office, 2nd floor', phone: '+256 700 000000', email: null, website: null };
    const overridden = payslipEmployer({ design, profile, branch, branchContacts: own, country: 'Uganda' });
    expect(overridden).toMatchObject({ address: 'Kampala office, 2nd floor', phone: '+256 700 000000', email: 'info@acme.co' });
  });

  it("uses each country's employer TIN; Kenya's KRA PIN only in Kenya", () => {
    const design = { ...DEFAULT_DESIGN, employer_tax_numbers: { Uganda: '1000123456', Kenya: 'P000000001A' } };
    expect(payslipEmployer({ design, country: 'Uganda', employerKraPin: 'P051234567X' })).toMatchObject({ taxLabel: 'TIN', taxNumber: '1000123456' });
    expect(payslipEmployer({ design, country: 'Tanzania', employerKraPin: 'P051234567X' })).toMatchObject({ taxLabel: 'TIN', taxNumber: null });
    expect(payslipEmployer({ design, country: 'Kenya', employerKraPin: 'P051234567X' }).taxNumber).toBe('P000000001A');
  });

  it('the letterhead: the logo, the offer letterhead, or one uploaded for payslips', () => {
    expect(payslipEmployer({ design: DEFAULT_DESIGN, profile, country: 'Kenya' }).letterheadUrl).toBeNull();
    expect(payslipEmployer({ design: { ...DEFAULT_DESIGN, letterhead: 'company' }, profile, country: 'Kenya' }).letterheadUrl).toBe('https://cdn.example/offer-lh.png');
    expect(payslipEmployer({ design: { ...DEFAULT_DESIGN, letterhead: 'own', letterhead_url: 'https://cdn.example/pay-lh.png' }, profile, country: 'Kenya' }).letterheadUrl).toBe(
      'https://cdn.example/pay-lh.png',
    );
  });
});
