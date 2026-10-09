import { beforeEach, describe, expect, it, vi } from 'vitest';

const updates: { changes: Record<string, string>; employeeNumber: string }[] = [];
let respond: (employeeNumber: string) => { data: unknown[] | null; error: { message: string } | null };

vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      update: (changes: Record<string, string>) => ({
        eq: (_column: string, employeeNumber: string) => ({
          select: async () => {
            updates.push({ changes, employeeNumber });
            return respond(employeeNumber);
          },
        }),
      }),
    }),
  },
}));

import {
  DETAILS_SHEET_COLUMNS,
  detailsSheetRows,
  employeesMissingDetails,
  missingDetails,
  parseDetailsSheet,
  saveDetailsUpdates,
} from './missingPayrollDetails';

const complete = {
  'Employee Number': 'EMP-001',
  'First Name': 'Achieng',
  'Last Name': 'Otieno',
  'Tax PIN': 'A123456789B',
  'NSSF Number': '123456789',
  'SHIF Number': 'CR1234567',
  payment_method: 'Bank Transfer',
  Bank: 'KCB',
  'Bank Branch': 'Moi Avenue',
  'Account Number': '1100223344',
  'Mobile Number': '0712345678',
};

describe('missingDetails', () => {
  it('finds nothing for a complete bank-paid employee', () => {
    expect(missingDetails(complete)).toEqual([]);
  });

  it('lists the statutory numbers and bank details that are blank', () => {
    expect(missingDetails({ ...complete, 'Tax PIN': ' ', 'NSSF Number': null, 'SHIF Number': '', Bank: '', 'Account Number': undefined })).toEqual([
      'KRA PIN',
      'NSSF number',
      'SHA number',
      'Bank',
      'Account number',
    ]);
  });

  it('accepts an old NHIF number as the SHA number', () => {
    expect(missingDetails({ ...complete, 'SHIF Number': '', 'NHIF Number': '12345678' })).toEqual([]);
  });

  it('needs only a phone number for M-Pesa, including when no method is set', () => {
    const noBank = { ...complete, Bank: '', 'Bank Branch': '', 'Account Number': '' };
    expect(missingDetails({ ...noBank, payment_method: 'MPESA' })).toEqual([]);
    expect(missingDetails({ ...noBank, payment_method: null, 'Mobile Number': '' })).toEqual(['M-Pesa number']);
  });

  it('needs no payment details for cash', () => {
    expect(missingDetails({ ...complete, payment_method: 'Cash', Bank: '', 'Account Number': '', 'Mobile Number': '' })).toEqual([]);
  });
});

describe('employeesMissingDetails', () => {
  it('keeps only employees with gaps, by name, and skips rows without an employee number', () => {
    const list = employeesMissingDetails([
      complete,
      { ...complete, 'Employee Number': 'EMP-003', 'First Name': 'Zawadi', 'Tax PIN': '' },
      { ...complete, 'Employee Number': 'EMP-002', 'First Name': 'Brian', 'NSSF Number': '' },
      { ...complete, 'Employee Number': '', 'Tax PIN': '' },
    ]);
    expect(list).toEqual([
      { employeeNumber: 'EMP-002', name: 'Brian Otieno', missing: ['NSSF number'] },
      { employeeNumber: 'EMP-003', name: 'Zawadi Otieno', missing: ['KRA PIN'] },
    ]);
  });
});

describe('detailsSheetRows', () => {
  it('fills each row with what is saved, so only the gaps need typing', () => {
    const rows = detailsSheetRows([complete, { ...complete, 'Employee Number': 'EMP-002', 'SHIF Number': '', 'NHIF Number': '12345678', 'Tax PIN': '' }]);
    expect(rows).toHaveLength(1);
    const row = Object.fromEntries(DETAILS_SHEET_COLUMNS.map((c, i) => [c, rows[0][i]]));
    expect(row).toMatchObject({ 'Employee Number': 'EMP-002', Missing: 'KRA PIN', 'KRA PIN': '', 'SHA Number': '12345678', Bank: 'KCB' });
  });
});

describe('parseDetailsSheet', () => {
  const employees = new Map<string, Record<string, unknown>>([
    ['EMP-001', { ...complete, 'Tax PIN': '', 'NSSF Number': '' }],
    ['EMP-002', { ...complete, 'Employee Number': 'EMP-002', 'First Name': 'Brian', 'SHIF Number': '', 'NHIF Number': '12345678' }],
  ]);

  it('saves only filled cells that change something, cleaned up', () => {
    const { updates: parsed, errors, unchanged } = parseDetailsSheet(
      [
        { 'employee number': 'EMP-001', 'KRA PIN': 'a 123456789 b', 'NSSF Number': '1234-56789', Bank: '', Name: 'ignored', Missing: 'ignored' },
        // the NHIF number shown in the SHA column comes back unchanged and is not copied over
        { 'Employee Number': 'EMP-002', 'SHA Number': '12345678', 'Payment Method': 'Bank Transfer' },
        {},
      ],
      employees
    );
    expect(errors).toEqual([]);
    expect(unchanged).toBe(1);
    expect(parsed).toEqual([{ employeeNumber: 'EMP-001', name: 'Achieng Otieno', changes: { 'Tax PIN': 'A123456789B', 'NSSF Number': '123456789' } }]);
  });

  it('switches to M-Pesa with a number whose leading zero Excel dropped', () => {
    const { updates: parsed } = parseDetailsSheet([{ 'Employee Number': 'EMP-002', 'Payment Method': 'M-Pesa', 'M-Pesa Number': 722000001 }], employees);
    expect(parsed[0].changes).toEqual({ payment_method: 'M-Pesa', 'Mobile Number': '0722000001' });
  });

  it('reports every problem on a row, numbered as in Excel', () => {
    const { updates: parsed, errors } = parseDetailsSheet(
      [
        { 'Employee Number': 'EMP-001', 'KRA PIN': '12345', 'Payment Method': 'cheque', 'Account Number': 'abc' },
        { 'Employee Number': 'EMP-999', 'NSSF Number': '123456789' },
        { 'KRA PIN': 'A123456789B' },
      ],
      employees
    );
    expect(parsed).toEqual([]);
    expect(errors).toEqual([
      'Row 2: KRA PIN "12345" should look like A123456789B, payment method "cheque" should be M-Pesa, Airtel Money, Bank Transfer or Cash, account number "abc" should be digits only',
      'Row 3: no employee with number EMP-999',
      'Row 4: no employee number',
    ]);
  });
});

describe('saveDetailsUpdates', () => {
  beforeEach(() => {
    updates.length = 0;
    respond = (n) => ({ data: [{ 'Employee Number': n }], error: null });
  });

  it('saves each employee and reports the ones that were not saved', async () => {
    respond = (n) =>
      n === 'EMP-002' ? { data: [], error: null } : n === 'EMP-003' ? { data: null, error: { message: 'value too long' } } : { data: [{}], error: null };
    const result = await saveDetailsUpdates([
      { employeeNumber: 'EMP-001', name: 'Achieng', changes: { 'Tax PIN': 'A123456789B' } },
      { employeeNumber: 'EMP-002', name: 'Brian', changes: { Bank: 'KCB' } },
      { employeeNumber: 'EMP-003', name: '', changes: { Bank: 'x' } },
    ]);
    expect(updates.map((u) => u.employeeNumber)).toEqual(['EMP-001', 'EMP-002', 'EMP-003']);
    expect(updates[0].changes).toEqual({ 'Tax PIN': 'A123456789B' });
    expect(result.saved).toBe(1);
    expect(result.failed).toEqual([
      'Brian: The changes were not saved: you do not have permission to change this employee, or the record no longer exists.',
      'EMP-003: value too long',
    ]);
  });
});
