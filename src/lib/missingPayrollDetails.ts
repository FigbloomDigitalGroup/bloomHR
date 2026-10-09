import { supabase } from './supabase';
import { isValidPhone } from './formValidation';
import { NOT_SAVED_NO_ACCESS, requireUpdatedRows } from './requireUpdated';
import type { EmployeeRecord } from './profileCompleteness';
import { normalisePaymentMethod, paymentKind } from './paymentMethods';

// Payroll details finance needs before paying and filing: KRA PIN, NSSF and SHA numbers, and where the salary goes.
// The check finds who is missing what; the spreadsheet lets finance fill the gaps for many employees at once.

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value).trim());

/** What is missing for one employee, in the words shown on screen and in the spreadsheet. */
export function missingDetails(employee: EmployeeRecord): string[] {
  const missing: string[] = [];
  if (!text(employee['Tax PIN'])) missing.push('KRA PIN');
  if (!text(employee['NSSF Number'])) missing.push('NSSF number');
  if (!text(employee['SHIF Number']) && !text(employee['NHIF Number'])) missing.push('SHA number');
  const kind = paymentKind(employee['payment_method']);
  if (kind === 'mobile' && !text(employee['Mobile Number'])) missing.push('M-Pesa number');
  if (kind === 'bank') {
    if (!text(employee['Bank'])) missing.push('Bank');
    if (!text(employee['Bank Branch'])) missing.push('Bank branch');
    if (!text(employee['Account Number'])) missing.push('Account number');
  }
  return missing;
}

export const employeeName = (employee: EmployeeRecord) =>
  [employee['First Name'], employee['Middle Name'], employee['Last Name']].map(text).filter(Boolean).join(' ');

export interface EmployeeMissingDetails {
  employeeNumber: string;
  name: string;
  missing: string[];
}

/** Employees with at least one detail missing, by name. Rows without an employee number are left out: payroll skips them too. */
export const employeesMissingDetails = (employees: EmployeeRecord[]): EmployeeMissingDetails[] =>
  employees
    .map((e) => ({ employeeNumber: text(e['Employee Number']), name: employeeName(e), missing: missingDetails(e) }))
    .filter((e) => e.employeeNumber && e.missing.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name) || a.employeeNumber.localeCompare(b.employeeNumber));

// ---------------------------------------------------------------------------------------------
// spreadsheet
// ---------------------------------------------------------------------------------------------

/** Sheet column -> employees column. "Name" and "Missing" are only there to help whoever fills the sheet in. */
export const DETAIL_COLUMNS = {
  'KRA PIN': 'Tax PIN',
  'NSSF Number': 'NSSF Number',
  'SHA Number': 'SHIF Number',
  'Payment Method': 'payment_method',
  'M-Pesa Number': 'Mobile Number',
  Bank: 'Bank',
  'Bank Branch': 'Bank Branch',
  'Account Number': 'Account Number',
  'Account Name': 'account_number_name',
} as const;

type DetailColumn = keyof typeof DETAIL_COLUMNS;
export const DETAILS_SHEET_COLUMNS = ['Employee Number', 'Name', 'Missing', ...(Object.keys(DETAIL_COLUMNS) as DetailColumn[])];

/** The saved value behind a sheet column. Older records keep the health number in "NHIF Number". */
const savedValue = (employee: EmployeeRecord, field: string) =>
  field === 'SHIF Number' ? text(employee['SHIF Number']) || text(employee['NHIF Number']) : text(employee[field]);

/** One row per employee with something missing, filled with what is already saved so only the gaps need typing. */
export const detailsSheetRows = (employees: EmployeeRecord[]): string[][] => {
  const byNumber = new Map(employees.map((e) => [text(e['Employee Number']), e]));
  return employeesMissingDetails(employees).map(({ employeeNumber, name, missing }) => {
    const e = byNumber.get(employeeNumber) ?? {};
    return [
      employeeNumber,
      name,
      missing.join(', '),
      ...(Object.values(DETAIL_COLUMNS) as string[]).map((field) => savedValue(e, field)),
    ];
  });
};

/** A phone number that lost its leading zero in Excel (722000001) gets it back. */
const restoreLeadingZero = (phone: string) => (/^[17]\d{8}$/.test(phone) ? `0${phone}` : phone);

/** Each value as it should be saved, or an error message for the row. */
const CLEAN: Record<DetailColumn, (value: string) => { value: string } | { error: string }> = {
  'KRA PIN': (v) => {
    const pin = v.replace(/\s/g, '').toUpperCase();
    return /^[A-Z]\d{9}[A-Z]$/.test(pin) ? { value: pin } : { error: `KRA PIN "${v}" should look like A123456789B` };
  },
  'NSSF Number': (v) => {
    const n = v.replace(/[\s-]/g, '');
    return /^\d{5,12}$/.test(n) ? { value: n } : { error: `NSSF number "${v}" should be digits only` };
  },
  'SHA Number': (v) => {
    const n = v.replace(/\s/g, '').toUpperCase();
    return /^[A-Z0-9-]{4,20}$/.test(n) ? { value: n } : { error: `SHA number "${v}" should be letters and digits only` };
  },
  'Payment Method': (v) => {
    const method = normalisePaymentMethod(v);
    return method ? { value: method } : { error: `payment method "${v}" should be M-Pesa, Airtel Money, Bank Transfer or Cash` };
  },
  'M-Pesa Number': (v) => {
    const phone = restoreLeadingZero(v.replace(/[\s().-]/g, ''));
    return isValidPhone(phone) ? { value: phone } : { error: `M-Pesa number "${v}" is not a phone number` };
  },
  Bank: (v) => ({ value: v }),
  'Bank Branch': (v) => ({ value: v }),
  'Account Number': (v) => {
    const n = v.replace(/[\s-]/g, '');
    return /^\d{5,20}$/.test(n) ? { value: n } : { error: `account number "${v}" should be digits only` };
  },
  'Account Name': (v) => ({ value: v }),
};

export interface DetailsUpdate {
  employeeNumber: string;
  name: string;
  /** employees column -> new value; only fields that change */
  changes: Record<string, string>;
}

const cell = (row: Record<string, unknown>, column: string) => {
  const key = Object.keys(row).find((k) => k.trim().toLowerCase() === column.toLowerCase());
  return key === undefined ? '' : text(row[key]);
};

/**
 * Rows of an uploaded details sheet, checked against the company's employees (keyed by employee number). A blank
 * cell never clears a saved value; a filled cell replaces it. Rows that change nothing are counted, not listed.
 * Row numbers in errors count the header as row 1, as in Excel.
 */
export const parseDetailsSheet = (rows: Record<string, unknown>[], employees: Map<string, EmployeeRecord>) => {
  const updates: DetailsUpdate[] = [];
  const errors: string[] = [];
  let unchanged = 0;
  rows.forEach((row, index) => {
    const employeeNumber = cell(row, 'Employee Number');
    const values = (Object.keys(DETAIL_COLUMNS) as DetailColumn[]).map((column) => [column, cell(row, column)] as const);
    if (!employeeNumber && values.every(([, v]) => !v)) return; // blank line

    const problems: string[] = [];
    const employee = employees.get(employeeNumber);
    if (!employeeNumber) problems.push('no employee number');
    else if (!employee) problems.push(`no employee with number ${employeeNumber}`);

    const changes: Record<string, string> = {};
    for (const [column, raw] of values) {
      if (!raw) continue;
      const result = CLEAN[column](raw);
      if ('error' in result) {
        problems.push(result.error);
        continue;
      }
      const field = DETAIL_COLUMNS[column];
      if (employee && savedValue(employee, field) !== result.value) changes[field] = result.value;
    }

    if (problems.length) errors.push(`Row ${index + 2}: ${problems.join(', ')}`);
    else if (Object.keys(changes).length === 0) unchanged += 1;
    else updates.push({ employeeNumber, name: employeeName(employee ?? {}), changes });
  });
  return { updates, errors, unchanged };
};

// ---------------------------------------------------------------------------------------------
// database
// ---------------------------------------------------------------------------------------------

/**
 * Saves each employee's changes. One failure does not stop the rest: the result lists who was not saved and why.
 * The rules (RLS) decide who may change these fields; an update they filter out is reported, not silently skipped.
 */
export const saveDetailsUpdates = async (updates: DetailsUpdate[]) => {
  let saved = 0;
  const failed: string[] = [];
  for (const u of updates) {
    try {
      const { data, error } = await supabase
        .from('employees')
        .update(u.changes)
        .eq('"Employee Number"', u.employeeNumber)
        .select('"Employee Number"');
      if (error) throw error;
      requireUpdatedRows(data, NOT_SAVED_NO_ACCESS);
      saved += 1;
    } catch (err) {
      // database errors are plain objects with a message, not Error instances
      const message = (err as { message?: unknown } | null)?.message;
      failed.push(`${u.name || u.employeeNumber}: ${typeof message === 'string' && message ? message : 'not saved'}`);
    }
  }
  return { saved, failed };
};
