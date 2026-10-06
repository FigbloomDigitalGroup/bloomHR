import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { readEmployeeRows } from './employeeSheet';

const csv = (text: string) => new TextEncoder().encode(text);

describe('readEmployeeRows: CSV', () => {
  const file = csv(
    ['Employee Number,First Name,Last Name,Mobile Number,Date of Birth,Basic Salary,ID Number', 'EMP-001,Grace,Mwangi,0722000001,1984-03-14,120000,23456701'].join('\n')
  );

  it('keeps dates as the plain text that was typed, not a spreadsheet serial number', () => {
    expect(readEmployeeRows(file)[0]['Date of Birth']).toBe('1984-03-14');
  });

  it('keeps the leading zero of phone numbers', () => {
    expect(readEmployeeRows(file)[0]['Mobile Number']).toBe('0722000001');
  });

  it('keys each row by its header and reads every row', () => {
    const rows = readEmployeeRows(csv('Employee Number,First Name\nEMP-1,A\nEMP-2,B\nEMP-3,C'));
    expect(rows.map((r) => r['Employee Number'])).toEqual(['EMP-1', 'EMP-2', 'EMP-3']);
  });

  it('trims stray spaces around headers and values', () => {
    const rows = readEmployeeRows(csv(' Employee Number , First Name \n EMP-1 , Grace '));
    expect(rows[0]).toEqual({ 'Employee Number': 'EMP-1', 'First Name': 'Grace' });
  });

  it('gives no rows for an empty file', () => {
    expect(readEmployeeRows(csv(''))).toEqual([]);
  });
});

describe('readEmployeeRows: Excel', () => {
  const workbook = (rows: unknown[][]) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), 'Sheet1');
    return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellDates: true }));
  };

  it('turns real date cells into YYYY-MM-DD text', () => {
    const rows = readEmployeeRows(workbook([['Employee Number', 'Date of Birth'], ['EMP-1', new Date(Date.UTC(1990, 2, 14))]]));
    expect(rows[0]['Date of Birth']).toBe('1990-03-14');
  });

  it('keeps text and numbers as they are', () => {
    const rows = readEmployeeRows(workbook([['Employee Number', 'Basic Salary', 'Mobile Number'], ['EMP-1', 95000, '0712345678']]));
    expect(rows[0]).toEqual({ 'Employee Number': 'EMP-1', 'Basic Salary': 95000, 'Mobile Number': '0712345678' });
  });
});
