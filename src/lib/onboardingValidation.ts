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
export const normaliseShaNumber = (value: unknown) => text(value).replace(/\s/g, '').toUpperCase();
export const normaliseNssfNumber = (value: unknown) => text(value).replace(/[\s-]/g, '').toUpperCase();
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

/** 5 to 12 characters, all digits except that the last may be X (a check character, e.g. 206593059X). */
export const isValidNssfNumber = (value: unknown) => /^\d{4,11}[0-9X]$/.test(normaliseNssfNumber(value));
export const isValidShaNumber = (value: unknown) => /^[A-Z0-9-]{4,20}$/.test(normaliseShaNumber(value));

/** Why a value can't be saved, or null when it can (blank is fine here; `onboardingMissing` says what is required). */
export function fieldProblem(field: string, value: unknown, employee: EmployeeRecord = {}): string | null {
  if (!text(value)) return null;
  switch (field) {
    case 'Tax PIN':
      return isValidKraPin(value) ? null : 'KRA PIN should look like A123456789B';
    case 'ID Number': {
      // no type is taken as a national ID, as the database does
      const type = text(employee['Type of Identification']) || 'National ID';
      if (!isIdentityType(type)) return 'Choose the identity type first';
      return isValidIdNumber(type, value) ? null : `This is not a valid ${type} number`;
    }
    case 'Mobile Number':
      return isValidOnboardingPhone(value) ? null : 'Phone number should look like 0712345678, or start with + and the country code';
    case 'NSSF Number':
      return isValidNssfNumber(value) ? null : 'NSSF number should be 5 to 12 digits (the last may be X)';
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
export function employeePartMissing(e: EmployeeRecord, contacts: OnboardingContacts): string[] {
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
  needValid('ID Number', 'ID number', (v) => isValidIdNumber(e['Type of Identification'], v));
  needValid('Tax PIN', 'KRA PIN', isValidKraPin);
  needValid('SHIF Number', 'SHA number', isValidShaNumber);
  needValid('NSSF Number', 'NSSF number', isValidNssfNumber);
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

export const onboardingMissing = (e: EmployeeRecord, contacts: OnboardingContacts) => [
  ...employeePartMissing(e, contacts),
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
