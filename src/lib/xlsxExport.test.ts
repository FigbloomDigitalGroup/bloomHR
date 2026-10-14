import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { sheetName, toXlsx } from './xlsxExport';
import { MPESA_HEADERS } from './payrollExports';

const read = (bytes: ArrayBuffer) => {
  const book = XLSX.read(bytes, { type: 'array' });
  return { book, sheet: book.Sheets[book.SheetNames[0]] };
};

const headers = ['Account Number', 'Phone Number', 'Bank Code', 'Amount'];
const rows = [
  ['0123456789', '254712345678', '01', '40000.00'],
  ['00012345678901234567', '254700000001', '68000', '1500.50'],
];

describe('toXlsx', () => {
  it('writes the header row exactly as the CSV has it', () => {
    const { sheet } = read(toXlsx(MPESA_HEADERS, [['254712345678', 'Amina Wanjiru', '40000.00', 'Salary 2026-10', 'PR-00001']]));
    expect(XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0]).toEqual([...MPESA_HEADERS]);
  });

  it('keeps leading zeros and long digit strings as text cells', () => {
    const { sheet } = read(toXlsx(headers, rows));
    expect(sheet.A2).toMatchObject({ t: 's', v: '0123456789' });
    expect(sheet.B2).toMatchObject({ t: 's', v: '254712345678' });
    expect(sheet.C2).toMatchObject({ t: 's', v: '01' });
    expect(sheet.A3).toMatchObject({ t: 's', v: '00012345678901234567' });
    for (const ref of Object.keys(sheet).filter((k) => !k.startsWith('!'))) expect(sheet[ref].t).toBe('s');
  });

  it('reads back the same strings it was given', () => {
    const { sheet } = read(toXlsx(headers, rows));
    expect(XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' })).toEqual([headers, ...rows]);
  });

  it('writes a header-only sheet when there are no rows, and names the sheet', () => {
    const { book, sheet } = read(toXlsx(headers, [], 'Bulk pay (M-Pesa) 2026-10'));
    expect(book.SheetNames).toEqual(['Bulk pay (M-Pesa) 2026-10']);
    expect(XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })).toEqual([headers]);
  });
});

describe('sheetName', () => {
  it('drops characters Excel refuses and keeps to 31 characters', () => {
    expect(sheetName('KRA P10 2026/10')).toBe('KRA P10 2026 10');
    expect(sheetName('a'.repeat(40))).toHaveLength(31);
    expect(sheetName('')).toBe('Sheet1');
  });
});
