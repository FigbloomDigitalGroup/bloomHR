import * as XLSX from 'xlsx';
import { STANDARD_EMPLOYEE_TYPES } from './employmentTypes';
import type { EmployeeNumberMode } from './employeeNumbering';

/**
 * The bulk-add template: only what HR has to give. The employee fills in their own ID, KRA PIN, NSSF and SHA numbers,
 * phone, date of birth and bank details when they accept the invitation sent to their work email.
 * The first three are required; the rest may be left blank. Employee numbers are given by the system (MCL-000001, ...),
 * so there is no column for them, unless the company uses its own numbers: then Employee Number comes first and is needed.
 */
export const TEMPLATE_COLUMNS = [
  'First Name',
  'Last Name',
  'Work Email',
  'Job Title',
  'Employee Type',
  'Basic Salary',
  'Town',
  'Manager Email',
] as const;

const EXAMPLE = ['Jane', 'Wanjiru', 'jane.wanjiru@company.co.ke', 'Accountant', 'Permanent', '85000', 'Nairobi', 'manager@company.co.ke'];

/** The columns of the template: with the company's own numbers, Employee Number comes first. */
export const templateColumns = (mode: EmployeeNumberMode = 'system'): string[] =>
  mode === 'own' ? ['Employee Number', ...TEMPLATE_COLUMNS] : [...TEMPLATE_COLUMNS];

const howToFill = (mode: EmployeeNumberMode) => [
  ['How to fill the Employees sheet'],
  [],
  ...(mode === 'own'
    ? [
        ['Needed for every employee: Employee Number, First Name, Last Name, Work Email.'],
        ['Employee Number: your own number for the employee, as you already use it. Each new employee needs one, and no two may be the same.'],
      ]
    : [
        ['Needed for every employee: First Name, Last Name, Work Email.'],
        ['Employee numbers are given by the system (MCL-000001, MCL-000002, ...): there is nothing to fill in for them.'],
      ]),
  ['Each new employee is emailed an invitation at their Work Email and fills in their own ID, KRA PIN, NSSF and SHA numbers, phone, date of birth and bank details.'],
  ['A row with the Employee Number or Work Email of someone already in the company updates that employee instead of adding a new one.'],
  [],
  ['Job Title, Employee Type, Basic Salary, Town and Manager Email may be left blank and filled in later.'],
  [`Employee Type: one of ${STANDARD_EMPLOYEE_TYPES.join(', ')}.`],
  ['Basic Salary: the monthly amount in KSh, e.g. 85000 (commas are fine).'],
  ['Manager Email: the work email of the person they report to (their supervisor).'],
  [],
  ['Example row:'],
  templateColumns(mode),
  mode === 'own' ? ['EMP-0042', ...EXAMPLE] : EXAMPLE,
];

/**
 * The template workbook: the Employees sheet first (the upload reads the first sheet), then How to fill.
 * `mode` is how the company's employee numbers are given ('own' adds the Employee Number column).
 */
export function employeeTemplateWorkbook(mode: EmployeeNumberMode = 'system'): XLSX.WorkBook {
  const columns = templateColumns(mode);
  const employees = XLSX.utils.aoa_to_sheet([columns]);
  employees['!cols'] = columns.map((c) => ({ wch: Math.max(14, c.length + 4) }));
  const help = XLSX.utils.aoa_to_sheet(howToFill(mode));
  help['!cols'] = [{ wch: 110 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, employees, 'Employees');
  XLSX.utils.book_append_sheet(wb, help, 'How to fill');
  return wb;
}

/** An amount as typed in a sheet: 85000, "85,000", "KSh 85,000.50". Empty or unreadable is null, never a wrong number. */
export function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/ksh|kes|[,\s]/gi, '');
  return /^\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
}
