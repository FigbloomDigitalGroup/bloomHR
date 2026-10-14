import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { TEMPLATE_COLUMNS, employeeTemplateWorkbook, parseAmount } from './employeeTemplate';
import { readEmployeeRows } from './employeeSheet';

describe('employee bulk-add template', () => {
  it('has the Employees sheet first, with only the headers (no example row to upload by mistake)', () => {
    const wb = employeeTemplateWorkbook();
    expect(wb.SheetNames).toEqual(['Employees', 'How to fill']);
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Employees, { header: 1 });
    expect(rows).toEqual([[...TEMPLATE_COLUMNS]]);
  });

  it('a filled-in template reads back with the names the upload maps', () => {
    const wb = employeeTemplateWorkbook();
    XLSX.utils.sheet_add_aoa(wb.Sheets.Employees, [['Ann', 'Otieno', 'ann@co.ke', 'Clerk', 'Contract', '45,000', 'Kisumu', 'boss@co.ke']], { origin: 'A2' });
    const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const [row] = readEmployeeRows(data);
    expect(row).toMatchObject({
      'First Name': 'Ann', 'Last Name': 'Otieno', 'Work Email': 'ann@co.ke',
      'Job Title': 'Clerk', 'Employee Type': 'Contract', 'Basic Salary': '45,000', Town: 'Kisumu', 'Manager Email': 'boss@co.ke',
    });
    expect(parseAmount(row['Basic Salary'])).toBe(45000);
    expect(row['Employee Number']).toBeUndefined();
  });
});

describe('parseAmount', () => {
  it('reads amounts with commas or KSh, and never turns "150,000" into 150', () => {
    expect(parseAmount('150,000')).toBe(150000);
    expect(parseAmount('KSh 85,000.50')).toBe(85000.5);
    expect(parseAmount(85000)).toBe(85000);
  });

  it('leaves blank or unreadable amounts empty', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount('about 50k')).toBeNull();
  });
});
