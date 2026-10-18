import type { EmployeeRecord } from './profileCompleteness';
import { paymentKind } from './paymentMethods';

// The details the KRA (P10), SHA and NSSF returns need, checked the way the database checks them
// (supabase/migrations/20261012100000_employee_onboarding.sql), so a form can say what is wrong before saving.

export const IDENTITY_TYPES = ['National ID', 'Alien ID', 'Refugee ID', 'Passport Number'] as const;
export type IdentityType = (typeof IDENTITY_TYPES)[number];

/** KRA P10 "Type of Employee". */
export const KRA_EMPLOYEE_TYPES = ['Primary Employee', 'Secondary Employee'] as const;
export const RESIDENCY_OPTIONS = ['Resident', 'Non-Resident'] as const;

export const ONBOARDING_STATUSES = ['draft', 'invited', 'submitted', 'changes_requested', 'approved'] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value).trim());

// ---------------------------------------------------------------------------------------------
// each value as it is saved
// ---------------------------------------------------------------------------------------------
export const normaliseKraPin = (value: unknown) => text(value).replace(/\s/g, '').toUpperCase();
export const normaliseIdNumber = (value: unknown) => text(value).replace(/\s/g, '').toUpperCase();
export const normaliseShaNumber = (value: unknown) => text(value).replace(/[\s/.]/g, '').toUpperCase();
export const normaliseNssfNumber = (value: unknown) => text(value).replace(/[\s/.-]/g, '').toUpperCase();
export const normalisePhone = (value: unknown) => text(value).replace(/[\s().-]/g, '');

// ---------------------------------------------------------------------------------------------
// formats
// ---------------------------------------------------------------------------------------------
/** An individual's KRA PIN: A, nine digits, a letter (A123456789B). */
export const isValidKraPin = (value: unknown) => /^A\d{9}[A-Z]$/.test(normaliseKraPin(value));

export const isIdentityType = (value: unknown): value is IdentityType => IDENTITY_TYPES.includes(value as IdentityType);

const ID_FORMATS: Record<IdentityType, RegExp> = {
  'National ID': /^\d{6,9}$/,
  'Alien ID': /^[A-Z0-9]{5,12}$/,
  'Refugee ID': /^[A-Z0-9/-]{5,20}$/,
  'Passport Number': /^[A-Z0-9]{6,9}$/,
};

export const isValidIdNumber = (type: unknown, value: unknown) =>
  isIdentityType(type) && ID_FORMATS[type].test(normaliseIdNumber(value));

/** A Kenyan mobile (07.., 01.., 2547.., +2547..) or an international number with its + country code. */
export const isValidOnboardingPhone = (value: unknown) =>
  /^(0[17]\d{8}|\+?254[17]\d{8}|\+[1-9]\d{7,14})$/.test(normalisePhone(value));

// NSSF and SHA don't publish a number format, and real numbers vary (e.g. 206593059X, CR1234567890123-1), so these
// only catch typos: letters and digits (SHA also dashes), with at least one digit. Spaces, dashes, slashes and dots
// are tidied away first. The database checks the same (nssf_number_ok, sha_number_ok in 20261021300000).
const nssfOk = (v: string) => /^[A-Z0-9]{4,15}$/.test(v) && /\d/.test(v);
export const isValidNssfNumber = (value: unknown) => nssfOk(normaliseNssfNumber(value));
export const isValidShaNumber = (value: unknown) => {
  const v = normaliseShaNumber(value);
  return /^[A-Z0-9-]{4,25}$/.test(v) && /\d/.test(v);
};

// ---------------------------------------------------------------------------------------------
// the statutory numbers of the employee's country (FIG-905), as the database checks them (tax_number_ok,
// social_security_number_ok, identity_number_ok_in, needs_sha_number in 20261021100000_uganda_payroll.sql)
// ---------------------------------------------------------------------------------------------
/** The payroll country as the database spells it ('Kenya' when not known). */
const countryOf = (country?: string | null) => {
  const c = text(country).toLowerCase();
  return c === 'tanzania' ? 'Tanzania' : c === 'uganda' ? 'Uganda' : 'Kenya';
};

interface CountryNumbers {
  /** what the "Tax PIN" field holds: KRA PIN, TRA TIN, URA TIN */
  taxLabel: string;
  taxOk: (normalised: string) => boolean;
  taxHint: string;
  taxPlaceholder: string;
  /** "NSSF Number": the member number of that country's NSSF */
  nssfOk: (normalised: string) => boolean;
  nssfHint: string;
  /** a National ID number in that country, when it isn't Kenya's */
  nationalId?: { ok: (normalised: string) => boolean; hint: string };
  /** an SHA number is asked for (Kenya only) */
  sha: boolean;
}

// A country without payroll rules yet keeps Kenya's formats, as the database does.
const NUMBERS: Record<'Kenya' | 'Tanzania' | 'Uganda', CountryNumbers> = {
  Kenya: {
    taxLabel: 'KRA PIN', taxOk: (v) => /^A\d{9}[A-Z]$/.test(v), taxHint: 'should look like A123456789B', taxPlaceholder: 'A123456789B',
    nssfOk, nssfHint: 'should be 4 to 15 letters and digits', sha: true,
  },
  // TRA TIN: 9 digits (written 123-456-789). NSSF Tanzania and Uganda don't publish a member number format: 6 to 15
  // letters and digits only catches typos. A NIDA number is 20 digits (written 19900101-12345-00001-12).
  Tanzania: {
    taxLabel: 'TIN', taxOk: (v) => /^\d{9}$/.test(v), taxHint: 'should be 9 digits, like 123-456-789', taxPlaceholder: '123-456-789',
    nssfOk: (v) => /^[A-Z0-9]{6,15}$/.test(v), nssfHint: 'should be 6 to 15 letters and digits',
    nationalId: { ok: (v) => /^\d{20}$/.test(v), hint: 'A NIDA number is 20 digits' }, sha: false,
  },
  // URA TIN: 10 digits. A Ugandan National ID is the NIN: 14 letters and digits.
  Uganda: {
    taxLabel: 'TIN', taxOk: (v) => /^\d{10}$/.test(v), taxHint: 'should be 10 digits', taxPlaceholder: '1000123456',
    nssfOk: (v) => /^[A-Z0-9]{6,15}$/.test(v), nssfHint: 'should be 6 to 15 letters and digits',
    nationalId: { ok: (v) => /^[A-Z0-9]{14}$/.test(v), hint: 'A NIN is 14 letters and digits' }, sha: false,
  },
};
const numbersOf = (country?: string | null) => NUMBERS[countryOf(country)];

/** A tax number as saved: no spaces, upper case; outside Kenya also without dashes (a TRA TIN is written 123-456-789). */
export const normaliseTaxNumber = (value: unknown, country?: string | null) =>
  countryOf(country) === 'Kenya' ? normaliseKraPin(value) : normaliseKraPin(value).replace(/-/g, '');
/** An ID number as saved: a Tanzanian National ID (NIDA) also loses its dashes. */
export const normaliseIdNumberIn = (value: unknown, country?: string | null, type: unknown = 'National ID') =>
  countryOf(country) === 'Tanzania' && (text(type) || 'National ID') === 'National ID'
    ? normaliseIdNumber(value).replace(/-/g, '')
    : normaliseIdNumber(value);

/** The employee's tax number by its name in their country: a KRA PIN in Kenya, a TIN in Tanzania and Uganda. */
export const taxNumberLabel = (country?: string | null) => numbersOf(country).taxLabel;
/** What a tax number looks like in the country, for a placeholder. */
export const taxNumberPlaceholder = (country?: string | null) => numbersOf(country).taxPlaceholder;
export const isValidTaxNumber = (value: unknown, country?: string | null) => numbersOf(country).taxOk(normaliseTaxNumber(value, country));
export const isValidSocialSecurityNumber = (value: unknown, country?: string | null) => numbersOf(country).nssfOk(normaliseNssfNumber(value));
/** An SHA number is asked for in Kenya only. */
export const needsShaNumber = (country?: string | null) => numbersOf(country).sha;
export const isValidIdNumberIn = (type: unknown, value: unknown, country?: string | null) => {
  const own = numbersOf(country).nationalId;
  if (own && type === 'National ID') return own.ok(normaliseIdNumberIn(value, country, type));
  return isValidIdNumber(type, value);
};

/**
 * Why a value can't be saved, or null when it can (blank is fine here; `onboardingMissing` says what is required).
 * The employee's country (their branch's) picks the formats, as the database does: a TRA or URA TIN instead of a KRA
 * PIN, each country's NSSF number and national ID.
 */
export function fieldProblem(field: string, value: unknown, employee: EmployeeRecord = {}, country?: string | null): string | null {
  if (!text(value)) return null;
  const n = numbersOf(country);
  switch (field) {
    case 'Tax PIN':
      return isValidTaxNumber(value, country) ? null : `${n.taxLabel} ${n.taxHint}`;
    case 'ID Number': {
      // no type is taken as a national ID, as the database does
      const type = text(employee['Type of Identification']) || 'National ID';
      if (!isIdentityType(type)) return 'Choose the identity type first';
      if (n.nationalId && type === 'National ID') return isValidIdNumberIn(type, value, country) ? null : n.nationalId.hint;
      return isValidIdNumber(type, value) ? null : `This is not a valid ${type} number`;
    }
    case 'Mobile Number':
      return isValidOnboardingPhone(value) ? null : 'Phone number should look like 0712345678, or start with + and the country code';
    case 'NSSF Number':
      return isValidSocialSecurityNumber(value, country) ? null : `NSSF number ${n.nssfHint}`;
    case 'SHIF Number':
      return isValidShaNumber(value) ? null : 'SHA number should be letters and digits only';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// what is still missing (the same list submit_onboarding / review_onboarding give)
// ---------------------------------------------------------------------------------------------
export interface OnboardingContacts {
  hasEmergencyContact: boolean;
  hasNextOfKin: boolean;
}

/** What the employee still has to give before they can submit, in the words the form uses. */
export function employeePartMissing(e: EmployeeRecord, contacts: OnboardingContacts, country?: string | null): string[] {
  const m: string[] = [];
  const need = (field: string, label: string) => {
    if (!text(e[field])) m.push(label);
  };
  const needValid = (field: string, label: string, ok: (v: unknown) => boolean) => {
    if (!text(e[field])) m.push(label);
    else if (!ok(e[field])) m.push(`${label} (not valid)`);
  };

  need('Last Name', 'Surname');
  need('First Name', 'First name');
  need('Date of Birth', 'Date of birth');
  need('Gender', 'Sex');
  need('nationality', 'Nationality');
  need('residential_address', 'Residential address');
  need('Personal Email', 'Personal email');
  if (!isIdentityType(e['Type of Identification'])) m.push('Identity type');
  needValid('ID Number', 'ID number', (v) => isValidIdNumberIn(e['Type of Identification'], v, country));
  needValid('Tax PIN', taxNumberLabel(country), (v) => isValidTaxNumber(v, country));
  if (needsShaNumber(country)) needValid('SHIF Number', 'SHA number', isValidShaNumber);
  needValid('NSSF Number', 'NSSF number', (v) => isValidSocialSecurityNumber(v, country));
  needValid('Mobile Number', 'Phone number', isValidOnboardingPhone);
  need('kra_residency', 'Residency');
  if (e['is_pwd'] === null || e['is_pwd'] === undefined) m.push('Disability (PWD) status');
  else if (e['is_pwd'] === true) need('Disability Cert No', 'Exemption certificate number');
  if (text(e['payment_method']) && paymentKind(e['payment_method']) === 'bank') {
    need('Bank', 'Bank name');
    need('Bank Branch', 'Bank branch');
    need('account_number_name', 'Account name');
    need('Account Number', 'Account number');
  }
  if (!contacts.hasEmergencyContact) m.push('Emergency contact');
  if (!contacts.hasNextOfKin) m.push('Next of kin');
  return m;
}

/** What HR still has to enter before it can approve. */
export function employerPartMissing(e: EmployeeRecord): string[] {
  const m: string[] = [];
  if (!text(e['Job Title'])) m.push('Position');
  if (!KRA_EMPLOYEE_TYPES.includes(e['kra_employee_type'] as (typeof KRA_EMPLOYEE_TYPES)[number])) m.push('Type of employee');
  if (!(Number(e['Basic Salary']) > 0)) m.push('Basic salary');
  if (!text(e['payment_method'])) m.push('Payment method');
  return m;
}

export const onboardingMissing = (e: EmployeeRecord, contacts: OnboardingContacts, country?: string | null) => [
  ...employeePartMissing(e, contacts, country),
  ...employerPartMissing(e),
];

const thisPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * Someone who left before the pay period ('YYYY-MM'): their Termination Date is in an earlier month. They are paid for
 * the month they leave in (their final dues), never after; the database refuses those payslips too (FIG-832).
 */
export function leftBefore(e: EmployeeRecord, period: string = thisPeriod()): boolean {
  const left = /^(\d{4}-\d{2})-\d{2}/.exec(String(e['Termination Date'] ?? '').trim());
  return !!left && left[1] < period;
}

/**
 * Only approved employees are paid (everyone else is still being onboarded), and not after the month they left.
 * Casual workers are paid by the day from their own page, never on the monthly payroll.
 */
export const isPayrollReady = (e: EmployeeRecord) =>
  e['onboarding_status'] === 'approved' && !leftBefore(e) && e['worker_kind'] !== 'casual';
