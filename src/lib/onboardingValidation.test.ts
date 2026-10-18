import { describe, expect, it } from 'vitest';
import {
  employeePartMissing,
  employerPartMissing,
  fieldProblem,
  isPayrollReady,
  leftBefore,
  isValidIdNumber,
  isValidKraPin,
  isValidNssfNumber,
  isValidOnboardingPhone,
  isValidShaNumber,
  normaliseKraPin,
  normaliseNssfNumber,
  normaliseShaNumber,
  normalisePhone,
  onboardingMissing,
} from './onboardingValidation';

const complete = {
  'Last Name': 'Wanjiru', 'First Name': 'Amina', 'Date of Birth': '1994-02-01', Gender: 'Female', nationality: 'Kenyan',
  residential_address: 'Kilimani', 'Personal Email': 'amina@mail.co', 'Type of Identification': 'National ID',
  'ID Number': '28123456', 'Tax PIN': 'A012345678Z', 'SHIF Number': 'CR1234567', 'NSSF Number': '2012345678',
  'Mobile Number': '0712345678', kra_residency: 'Resident', is_pwd: false, payment_method: 'Bank Transfer', Bank: 'KCB',
  'Bank Branch': 'Moi Avenue', account_number_name: 'Amina Wanjiru', 'Account Number': '1234567890',
  'Job Title': 'Accountant', kra_employee_type: 'Primary Employee', 'Basic Salary': 80000,
};
const contacts = { hasEmergencyContact: true, hasNextOfKin: true };

describe('KRA PIN', () => {
  it('is stored upper case without spaces', () => {
    expect(normaliseKraPin(' a012 345678b ')).toBe('A012345678B');
  });

  it('must be an individual PIN: A, nine digits, a letter', () => {
    expect(isValidKraPin('A012345678B')).toBe(true);
    expect(isValidKraPin('a012345678b')).toBe(true);
    for (const pin of ['A12345678B', 'P051234567X', 'A0123456789', 'AA12345678B', '', null]) expect(isValidKraPin(pin), String(pin)).toBe(false);
  });
});

describe('ID number', () => {
  it('follows the identity type', () => {
    expect(isValidIdNumber('National ID', '28123456')).toBe(true);
    expect(isValidIdNumber('National ID', '123456789')).toBe(true);
    expect(isValidIdNumber('National ID', 'AB12345')).toBe(false);
    expect(isValidIdNumber('Passport Number', 'ak1234567')).toBe(true);
    expect(isValidIdNumber('Passport Number', 'AK12')).toBe(false);
    expect(isValidIdNumber('Alien ID', '1234567')).toBe(true);
    expect(isValidIdNumber('Refugee ID', 'RCK-12345')).toBe(true);
  });

  it('needs a known identity type', () => {
    expect(isValidIdNumber('Driving licence', '28123456')).toBe(false);
    expect(isValidIdNumber(null, '28123456')).toBe(false);
    expect(fieldProblem('ID Number', '28123456', { 'Type of Identification': 'Driving licence' })).toBe('Choose the identity type first');
    expect(fieldProblem('ID Number', '28123456', {})).toBeNull(); // taken as a national ID
  });
});

describe('phone number', () => {
  it('accepts Kenyan numbers in their usual forms and international numbers with a country code', () => {
    for (const p of ['0712345678', '0112345678', '0712 345-678', '(0712) 345678', '254712345678', '+254712345678', '+447911123456']) {
      expect(isValidOnboardingPhone(p), p).toBe(true);
    }
    expect(normalisePhone('0712 345-678')).toBe('0712345678');
  });

  it('rejects numbers that are too short, not mobile, or have no country code', () => {
    for (const p of ['12345', '0812345678', '07123456789', '+0712345678', '447911123456']) expect(isValidOnboardingPhone(p), p).toBe(false);
  });
});

describe('SHA and NSSF numbers', () => {
  it('NSSF: letters and digits, spaces, dashes, slashes and dots dropped', () => {
    expect(normaliseNssfNumber('2012-345 678')).toBe('2012345678');
    expect(normaliseNssfNumber('2012/345.678')).toBe('2012345678');
    expect(isValidNssfNumber('2012-345 678')).toBe(true);
    expect(isValidNssfNumber('NS12345')).toBe(true);
    expect(isValidNssfNumber('123')).toBe(false); // too short
    expect(isValidNssfNumber('1234567890123456')).toBe(false); // too long
    expect(isValidNssfNumber('ABCDEF')).toBe(false); // no digit
    expect(isValidNssfNumber('12#45')).toBe(false);
  });

  it('NSSF: real numbers with a check letter pass, saved in upper case', () => {
    expect(isValidNssfNumber('206593059X')).toBe(true); // from finance's July 2026 NSSF return
    expect(normaliseNssfNumber('206593059x')).toBe('206593059X');
    expect(isValidNssfNumber('2065X3059')).toBe(true);
    expect(isValidNssfNumber('X')).toBe(false);
  });

  it('SHA: letters, digits and dashes; spaces, slashes and dots dropped', () => {
    expect(isValidShaNumber('cr 1234567')).toBe(true);
    expect(isValidShaNumber('CR-123-4')).toBe(true);
    expect(isValidShaNumber('CR1234567890123-1')).toBe(true);
    expect(isValidShaNumber('CR/1234/567')).toBe(true);
    expect(normaliseShaNumber('cr/1234 567')).toBe('CR1234567');
    expect(isValidShaNumber('CR#1')).toBe(false);
    expect(isValidShaNumber('ABCD')).toBe(false); // no digit
  });
});

describe('fieldProblem', () => {
  it('says what is wrong with a value, and nothing for a blank or a field without a format', () => {
    expect(fieldProblem('Tax PIN', 'A1')).toMatch(/A123456789B/);
    expect(fieldProblem('Mobile Number', '123')).toMatch(/0712345678/);
    expect(fieldProblem('NSSF Number', 'x')).toMatch(/digits/);
    expect(fieldProblem('SHIF Number', '#')).toMatch(/letters and digits/);
    expect(fieldProblem('ID Number', 'X1', { 'Type of Identification': 'National ID' })).toBe('This is not a valid National ID number');
    expect(fieldProblem('Tax PIN', '  ')).toBeNull();
    expect(fieldProblem('First Name', '!!!')).toBeNull();
  });
});

describe('what is still missing', () => {
  it('nothing when both parts are complete', () => {
    expect(onboardingMissing(complete, contacts)).toEqual([]);
  });

  it('lists the employee’s gaps, and flags values that are filled in but not valid', () => {
    expect(employeePartMissing({ ...complete, 'Tax PIN': '', 'NSSF Number': 'abc', kra_residency: null }, contacts)).toEqual([
      'KRA PIN', 'NSSF number (not valid)', 'Residency',
    ]);
  });

  it('needs the exemption certificate only from a person with a disability, and an answer either way', () => {
    expect(employeePartMissing({ ...complete, is_pwd: true }, contacts)).toEqual(['Exemption certificate number']);
    expect(employeePartMissing({ ...complete, is_pwd: true, 'Disability Cert No': 'PWD/1' }, contacts)).toEqual([]);
    expect(employeePartMissing({ ...complete, is_pwd: null }, contacts)).toEqual(['Disability (PWD) status']);
  });

  it('needs bank details only from someone paid by bank', () => {
    const noBank = { ...complete, Bank: '', 'Bank Branch': '', account_number_name: '', 'Account Number': '' };
    expect(employeePartMissing(noBank, contacts)).toEqual(['Bank name', 'Bank branch', 'Account name', 'Account number']);
    expect(employeePartMissing({ ...noBank, payment_method: 'M-Pesa' }, contacts)).toEqual([]);
    expect(employeePartMissing({ ...noBank, payment_method: 'Cash' }, contacts)).toEqual([]);
  });

  it('needs an emergency contact and a next of kin', () => {
    expect(employeePartMissing(complete, { hasEmergencyContact: false, hasNextOfKin: false })).toEqual(['Emergency contact', 'Next of kin']);
  });

  it('lists HR’s gaps separately', () => {
    expect(employerPartMissing({ ...complete, kra_employee_type: 'Casual', 'Basic Salary': 0, payment_method: '', 'Job Title': ' ' }))
      .toEqual(['Position', 'Type of employee', 'Basic salary', 'Payment method']);
  });
});

describe('isPayrollReady', () => {
  it('only an approved record is paid', () => {
    expect(isPayrollReady({ onboarding_status: 'approved' })).toBe(true);
    for (const s of ['draft', 'invited', 'submitted', 'changes_requested', undefined]) expect(isPayrollReady({ onboarding_status: s })).toBe(false);
  });

  it('a leaver is paid up to the month they leave in, not after', () => {
    expect(isPayrollReady({ onboarding_status: 'approved', 'Termination Date': '2000-01-31' })).toBe(false);
    expect(isPayrollReady({ onboarding_status: 'approved', 'Termination Date': '2999-01-31' })).toBe(true);
    expect(leftBefore({ 'Termination Date': '2026-10-15' }, '2026-10')).toBe(false);
    expect(leftBefore({ 'Termination Date': '2026-10-15' }, '2026-11')).toBe(true);
    expect(leftBefore({ 'Termination Date': '' }, '2026-11')).toBe(false);
  });
});
