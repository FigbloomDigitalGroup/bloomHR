import { supabase } from './supabase';

// How the company's payslips look (FIG-814, migration 20261021600000_payslip_details.sql): the letterhead, the address
// and contacts (each branch may have its own), the footer, a brand colour for headings, and which optional sections
// show. One design for the admin payslip, the staff portal, the downloaded PDF and the emailed PDF (PayslipDocument).
// Everyone in the company reads it (staff render their own payslips with it); only the payslip-design module changes it.

export type LetterheadMode = 'logo' | 'company' | 'own';

export interface PayslipDesign {
  /** 'logo': the logo and company name; 'company': the letterhead uploaded for offer letters; 'own': letterhead_url */
  letterhead: LetterheadMode;
  letterhead_url: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  footer_text: string | null;
  /** #rrggbb, for headings */
  brand_color: string | null;
  /** the employer's tax number per country ({"Tanzania": "123456789"}); Kenya defaults to the employer KRA PIN */
  employer_tax_numbers: Record<string, string>;
  show_employer_contributions: boolean;
  show_ytd: boolean;
  show_bank_details: boolean;
  show_leave_balance: boolean;
}

export interface BranchContacts {
  branch_id: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
}

export const DEFAULT_DESIGN: PayslipDesign = {
  letterhead: 'logo',
  letterhead_url: null,
  address: null,
  phone: null,
  email: null,
  website: null,
  footer_text: null,
  brand_color: null,
  employer_tax_numbers: {},
  show_employer_contributions: true,
  show_ytd: true,
  show_bank_details: true,
  show_leave_balance: false,
};

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const orNull = (v: unknown) => text(v) || null;

/** A saved row (or nothing) as a full design: anything missing takes the default. */
export function designOf(row: Partial<Record<keyof PayslipDesign, unknown>> | null | undefined): PayslipDesign {
  if (!row) return { ...DEFAULT_DESIGN };
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const letterhead = ['logo', 'company', 'own'].includes(text(row.letterhead)) ? (text(row.letterhead) as LetterheadMode) : 'logo';
  const numbers = row.employer_tax_numbers && typeof row.employer_tax_numbers === 'object' ? (row.employer_tax_numbers as Record<string, unknown>) : {};
  return {
    letterhead,
    letterhead_url: orNull(row.letterhead_url),
    address: orNull(row.address),
    phone: orNull(row.phone),
    email: orNull(row.email),
    website: orNull(row.website),
    footer_text: orNull(row.footer_text),
    brand_color: /^#[0-9a-f]{6}$/i.test(text(row.brand_color)) ? text(row.brand_color) : null,
    employer_tax_numbers: Object.fromEntries(Object.entries(numbers).map(([k, v]) => [k, text(v)]).filter(([, v]) => v)),
    show_employer_contributions: bool(row.show_employer_contributions, true),
    show_ytd: bool(row.show_ytd, true),
    show_bank_details: bool(row.show_bank_details, true),
    show_leave_balance: bool(row.show_leave_balance, false),
  };
}

/** What is wrong with a design before saving it, or null. */
export function designError(d: PayslipDesign): string | null {
  if (d.brand_color && !/^#[0-9a-f]{6}$/i.test(d.brand_color)) return 'Pick a colour like #17402A';
  if (d.letterhead === 'own' && !d.letterhead_url) return 'Upload a letterhead image, or choose another letterhead';
  if (d.email && !/^\S+@\S+\.\S+$/.test(d.email)) return 'Enter a valid email address';
  if ((d.footer_text ?? '').length > 500) return 'Keep the footer to 500 characters';
  return null;
}

export async function loadPayslipDesign(): Promise<PayslipDesign> {
  const { data, error } = await supabase.from('payslip_settings').select('*').maybeSingle();
  // before the migration is applied (or on any read error) payslips use the default design
  if (error) return { ...DEFAULT_DESIGN };
  return designOf(data as Record<string, unknown> | null);
}

export async function loadBranchContacts(): Promise<BranchContacts[]> {
  const { data, error } = await supabase.from('payslip_branch_settings').select('branch_id, address, phone, email, website');
  if (error) return [];
  return (data ?? []) as BranchContacts[];
}

const failed = (error: { code?: string; message?: string }, what: string): never => {
  if (error.code === '42501' || /row-level security/i.test(error.message ?? '')) throw new Error('Only people with Payslip design can change how payslips look');
  throw new Error(error.message || what);
};

export async function savePayslipDesign(d: PayslipDesign): Promise<PayslipDesign> {
  const problem = designError(d);
  if (problem) throw new Error(problem);
  const { data, error } = await supabase
    .from('payslip_settings')
    .upsert(d, { onConflict: 'tenant_id' })
    .select('*')
    .single();
  if (error) failed(error, 'The payslip design was not saved.');
  return designOf(data as Record<string, unknown>);
}

/** Saves a branch's own contacts; all blank removes them (the branch uses the company's). */
export async function saveBranchContacts(c: BranchContacts): Promise<void> {
  const blank = !text(c.address) && !text(c.phone) && !text(c.email) && !text(c.website);
  if (blank) {
    const { error } = await supabase.from('payslip_branch_settings').delete().eq('branch_id', c.branch_id);
    if (error) failed(error, 'The branch contacts were not removed.');
    return;
  }
  const { error } = await supabase
    .from('payslip_branch_settings')
    .upsert({ branch_id: c.branch_id, address: orNull(c.address), phone: orNull(c.phone), email: orNull(c.email), website: orNull(c.website) }, { onConflict: 'tenant_id,branch_id' });
  if (error) failed(error, 'The branch contacts were not saved.');
}

// ---------------------------------------------------------------------------------------------
// the employer block on a payslip
// ---------------------------------------------------------------------------------------------
/** The company profile fields the employer block reads. */
export interface EmployerProfile {
  company_name?: string | null;
  logo_url?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  postal_code?: string | null;
  country?: string | null;
  official_phone?: string | null;
  official_email?: string | null;
  website?: string | null;
  letterhead_header_url?: string | null;
}

export interface EmployerBranch {
  id: string;
  name?: string | null;
  country?: string | null;
  city?: string | null;
  address?: string | null;
}

export interface PayslipEmployer {
  name: string | null;
  logoUrl: string | null;
  /** a full-width letterhead image in place of the logo and name */
  letterheadUrl: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  /** "KRA PIN" in Kenya, "TIN" in Tanzania and Uganda */
  taxLabel: string;
  taxNumber: string | null;
}

/** The employer's tax number's name in a country. */
export const employerTaxLabel = (country: string | null | undefined) => (['tanzania', 'uganda'].includes(text(country).toLowerCase()) ? 'TIN' : 'KRA PIN');

/**
 * The employer block for a payslip: the company's name and logo (or the letterhead the design picks); the address and
 * contacts of the employee's branch when the design gives it its own, else the branch's address, else the design's,
 * else the company profile's; and the employer's tax number in the payslip's country.
 */
export function payslipEmployer(args: {
  design: PayslipDesign;
  profile?: EmployerProfile | null;
  identity?: { company_name?: string | null; image_url?: string | null } | null;
  branch?: EmployerBranch | null;
  branchContacts?: BranchContacts | null;
  country: string;
  employerKraPin?: string | null;
}): PayslipEmployer {
  const { design, profile, identity, branch, branchContacts: own, country } = args;
  const profileAddress = [profile?.address_line1, profile?.address_line2, [profile?.city, profile?.postal_code].map(text).filter(Boolean).join(' ')]
    .map(text)
    .filter(Boolean)
    .join(', ');
  const branchAddress = [branch?.address, branch?.city].map(text).filter(Boolean).join(', ');
  const isKenya = !['tanzania', 'uganda'].includes(text(country).toLowerCase());
  const taxFor = text(design.employer_tax_numbers[country]) || (isKenya ? text(args.employerKraPin) : '');
  return {
    name: orNull(identity?.company_name) ?? orNull(profile?.company_name),
    logoUrl: orNull(identity?.image_url) ?? orNull(profile?.logo_url),
    letterheadUrl: design.letterhead === 'company' ? orNull(profile?.letterhead_header_url) : design.letterhead === 'own' ? design.letterhead_url : null,
    address: orNull(own?.address) ?? (orNull(branchAddress) ?? design.address ?? orNull(profileAddress)),
    phone: orNull(own?.phone) ?? design.phone ?? orNull(profile?.official_phone),
    email: orNull(own?.email) ?? design.email ?? orNull(profile?.official_email),
    website: orNull(own?.website) ?? design.website ?? orNull(profile?.website),
    taxLabel: employerTaxLabel(country),
    taxNumber: orNull(taxFor),
  };
}
