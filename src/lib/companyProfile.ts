import { supabase } from './supabase';

// The company profile (migration 20261015100000): one row per company, read by everyone in it, changed by ADMIN and
// people with Settings. Saving it also updates company_logo (name, logo, tagline), which payslips still read.

export interface CompanyProfile {
  tenant_id: string;
  company_name: string;
  tagline: string | null;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  description: string | null;
  registration_no: string | null;
  business_type: string | null;
  industry: string | null;
  country: string;
  base_currency: string;
  official_phone: string | null;
  official_email: string | null;
  website: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postal_code: string | null;
  fiscal_year_start_month: number;
  week_start_day: string;
  /** an uploaded letterhead image shown at the top of offer letters instead of the generated one (20261016600000) */
  letterhead_header_url: string | null;
  /** an optional image at the bottom of offer letters */
  letterhead_footer_url: string | null;
}

/** What the page edits: every field but the key. */
export type CompanyProfileFields = Omit<CompanyProfile, 'tenant_id'>;

/** The name, logo and tagline in the shape the old company_logo rows had (payslips and headers read these). */
export interface CompanyIdentity {
  company_name: string | null;
  image_url: string | null;
  company_tagline: string | null;
}

/** A company with no profile yet: every field blank, Kenya, KES, January, Monday. */
export const EMPTY_PROFILE: CompanyProfileFields = {
  company_name: '', tagline: null, logo_url: null, primary_color: null, secondary_color: null, description: null,
  registration_no: null, business_type: null, industry: null, country: 'Kenya', base_currency: 'KES',
  official_phone: null, official_email: null, website: null, address_line1: null, address_line2: null, city: null,
  postal_code: null, fiscal_year_start_month: 1, week_start_day: 'monday', letterhead_header_url: null, letterhead_footer_url: null,
};

/** A saved profile as the fields the page edits (the key dropped, anything missing blank). */
export const profileFields = (p: CompanyProfileFields & { tenant_id?: string }): CompanyProfileFields => {
  const out = { ...EMPTY_PROFILE };
  for (const k of Object.keys(EMPTY_PROFILE) as (keyof CompanyProfileFields)[]) {
    if (p[k] !== undefined) (out as Record<string, unknown>)[k] = p[k];
  }
  return out;
};

export const DEFAULT_PRIMARY_COLOR = '#17402A';
export const DEFAULT_SECONDARY_COLOR = '#F26A1B';

export const BUSINESS_TYPES: { id: string; label: string }[] = [
  { id: 'sole_proprietorship', label: 'Sole proprietorship' },
  { id: 'partnership', label: 'Partnership' },
  { id: 'limited_company', label: 'Private limited company' },
  { id: 'public_limited_company', label: 'Public limited company' },
  { id: 'ngo', label: 'NGO / non-profit' },
  { id: 'government', label: 'Government / parastatal' },
  { id: 'other', label: 'Other' },
];

export const INDUSTRIES: { id: string; label: string }[] = [
  { id: 'agriculture', label: 'Agriculture' },
  { id: 'construction', label: 'Construction' },
  { id: 'education', label: 'Education' },
  { id: 'energy', label: 'Energy & utilities' },
  { id: 'financial_services', label: 'Financial services' },
  { id: 'healthcare', label: 'Healthcare' },
  { id: 'hospitality', label: 'Hospitality' },
  { id: 'ict', label: 'ICT & technology' },
  { id: 'manufacturing', label: 'Manufacturing' },
  { id: 'media', label: 'Media & communications' },
  { id: 'ngo', label: 'Non-profit' },
  { id: 'professional_services', label: 'Professional services' },
  { id: 'real_estate', label: 'Real estate' },
  { id: 'retail', label: 'Retail & wholesale' },
  { id: 'transport_logistics', label: 'Transport & logistics' },
  { id: 'other', label: 'Other' },
];

export const COUNTRIES = ['Kenya', 'Uganda', 'Tanzania', 'Rwanda', 'Burundi', 'South Sudan', 'Ethiopia', 'Somalia', 'Other'];
export const CURRENCIES = ['KES', 'UGX', 'TZS', 'RWF', 'BIF', 'SSP', 'ETB', 'USD', 'EUR', 'GBP'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEK_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{6,19}$/;
export const URL_PATTERN = /^https?:\/\/\S+\.\S+$/i;
export const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** A website as typed, with https:// added when it has no scheme ('' stays ''). */
export function normaliseWebsite(url: string): string {
  const v = url.trim();
  if (!v) return '';
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

/** What is wrong with each field, by field name (empty when it can be saved). */
export function profileErrors(p: CompanyProfileFields): Partial<Record<keyof CompanyProfileFields, string>> {
  const e: Partial<Record<keyof CompanyProfileFields, string>> = {};
  const name = p.company_name.trim();
  if (!name) e.company_name = 'The company name is needed';
  else if (name.length > 120) e.company_name = 'Use 120 characters or fewer';
  if (p.official_email && !EMAIL_PATTERN.test(p.official_email.trim())) e.official_email = 'Enter an email like hello@company.co.ke';
  if (p.official_phone && !PHONE_PATTERN.test(p.official_phone.trim())) e.official_phone = 'Enter a phone number like +254 712 345678';
  if (p.website && !URL_PATTERN.test(normaliseWebsite(p.website))) e.website = 'Enter a website like https://company.co.ke';
  if (p.primary_color && !HEX_PATTERN.test(p.primary_color)) e.primary_color = 'Use a colour like #17402A';
  if (p.secondary_color && !HEX_PATTERN.test(p.secondary_color)) e.secondary_color = 'Use a colour like #F26A1B';
  if ((p.description ?? '').length > 1000) e.description = 'Use 1000 characters or fewer';
  if ((p.tagline ?? '').length > 120) e.tagline = 'Use 120 characters or fewer';
  if (!p.country.trim()) e.country = 'Choose a country';
  return e;
}

const blankToNull = (v: string | null) => {
  const t = (v ?? '').trim();
  return t ? t : null;
};

/** The fields as saved: trimmed, blanks as null, the website with its scheme. */
export function cleanProfile(p: CompanyProfileFields): CompanyProfileFields {
  return {
    ...p,
    company_name: p.company_name.trim(),
    tagline: blankToNull(p.tagline),
    logo_url: blankToNull(p.logo_url),
    primary_color: blankToNull(p.primary_color)?.toUpperCase() ?? null,
    secondary_color: blankToNull(p.secondary_color)?.toUpperCase() ?? null,
    description: blankToNull(p.description),
    registration_no: blankToNull(p.registration_no),
    business_type: blankToNull(p.business_type),
    industry: blankToNull(p.industry),
    country: p.country.trim(),
    official_phone: blankToNull(p.official_phone),
    official_email: blankToNull(p.official_email),
    website: blankToNull(normaliseWebsite(p.website ?? '')),
    address_line1: blankToNull(p.address_line1),
    address_line2: blankToNull(p.address_line2),
    city: blankToNull(p.city),
    postal_code: blankToNull(p.postal_code),
    letterhead_header_url: blankToNull(p.letterhead_header_url),
    letterhead_footer_url: blankToNull(p.letterhead_footer_url),
  };
}

const fail = (error: { message?: string } | null, fallback: string): never => {
  throw new Error(error?.message || fallback);
};

/** The signed-in person's company profile (null if it has none yet). */
export async function loadCompanyProfile(): Promise<CompanyProfile | null> {
  const { data, error } = await supabase.from('company_profile').select('*').maybeSingle();
  if (error) fail(error, 'Could not load the company profile.');
  return (data as CompanyProfile | null) ?? null;
}

/** Saves the profile (creating it if the company has none); returns it as saved. */
export async function saveCompanyProfile(fields: CompanyProfileFields): Promise<CompanyProfile> {
  const { data, error } = await supabase
    .from('company_profile')
    .upsert(cleanProfile(fields), { onConflict: 'tenant_id' })
    .select('*')
    .single();
  if (error) fail(error, 'The company profile was not saved.');
  return data as CompanyProfile;
}

/** The person who created the company, shown as its administrator. */
export async function loadCompanyAdmin(): Promise<{ full_name: string; email: string } | null> {
  const { data, error } = await supabase.rpc('company_profile_admin');
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as { full_name: string; email: string } | undefined;
  return row ?? null;
}

/** The employer KRA PIN as every member reads it (payroll keeps and edits it, in company_payroll_settings). */
export async function loadEmployerPinForProfile(): Promise<string> {
  const { data, error } = await supabase.rpc('company_tax_details');
  if (error) return '';
  const row = (Array.isArray(data) ? data[0] : data) as { employer_kra_pin?: string | null } | undefined;
  return row?.employer_kra_pin ?? '';
}

/**
 * The company's name, logo and tagline for headers and payslips (null when it has none). Falls back to the latest
 * company_logo row when the profile can't be read or has no row (e.g. before its migration is applied).
 */
export async function loadCompanyIdentity(): Promise<CompanyIdentity | null> {
  const { data, error } = await supabase
    .from('company_profile')
    .select('company_name, image_url:logo_url, company_tagline:tagline')
    .maybeSingle();
  if (!error && data) return data as CompanyIdentity;
  const old = await supabase
    .from('company_logo')
    .select('company_name, image_url, company_tagline')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (old.error) throw old.error;
  return (old.data as CompanyIdentity | null) ?? null;
}

export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** What is wrong with a logo file, or null. */
export function logoFileError(file: File): string | null {
  if (!LOGO_TYPES.includes(file.type)) return 'Use a PNG, JPG, SVG or WebP image';
  if (file.size > LOGO_MAX_BYTES) return 'Use an image of 2 MB or less';
  return null;
}

/** Uploads an image to the company-logo bucket (as the top bar did) and returns its public URL. */
async function uploadCompanyImage(file: File, failure: string): Promise<string> {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('company-logo').upload(path, file);
  if (error) fail(error, failure);
  return supabase.storage.from('company-logo').getPublicUrl(path).data.publicUrl;
}

/** Uploads a logo and returns its public URL. */
export const uploadCompanyLogo = (file: File) => uploadCompanyImage(file, 'The logo was not uploaded.');

// An offer letter's own letterhead: a header (and optional footer) image the width of an A4 page
export const LETTERHEAD_TYPES = ['image/png', 'image/jpeg'];
export const LETTERHEAD_MAX_BYTES = 2 * 1024 * 1024;

/** What is wrong with a letterhead image file, or null. */
export function letterheadFileError(file: File): string | null {
  if (!LETTERHEAD_TYPES.includes(file.type)) return 'Use a PNG or JPG image';
  if (file.size > LETTERHEAD_MAX_BYTES) return 'Use an image of 2 MB or less';
  return null;
}

/** Uploads a letterhead header or footer image (same bucket as the logo) and returns its public URL. */
export const uploadLetterheadImage = (file: File) => uploadCompanyImage(file, 'The letterhead image was not uploaded.');

/**
 * Sets the letterhead images from a letter screen (migration 20261026300000): HR, Recruitment or Settings; only these
 * two images change. null removes one.
 */
export async function setCompanyLetterhead(header: string | null, footer: string | null) {
  const { data, error } = await supabase.rpc('set_company_letterhead', { p_header: header, p_footer: footer });
  if (error) fail(error, 'The letterhead was not saved.');
  return ((Array.isArray(data) ? data[0] : data) ?? { letterhead_header_url: header, letterhead_footer_url: footer }) as {
    letterhead_header_url: string | null;
    letterhead_footer_url: string | null;
  };
}
