import * as XLSX from 'xlsx';
import { STANDARD_EMPLOYEE_TYPES } from './employmentTypes';

/**
 * The bulk-add template: only what HR has to give. The employee fills in their own ID, KRA PIN, NSSF and SHA numbers,
 * phone, date of birth and bank details when they accept the invitation sent to their work email.
 * The first three are required; the rest may be left blank. Employee numbers are given by the system (PR-00001, ...),
 * so there is no column for them.
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

const HOW_TO_FILL = [
  ['How to fill the Employees sheet'],
  [],
  ['Needed for every employee: First Name, Last Name, Work Email.'],
  ['Employee numbers are given by the system (PR-00001, PR-00002, ...): there is nothing to fill in for them.'],
  ['Each new employee is emailed an invitation at their Work Email and fills in their own ID, KRA PIN, NSSF and SHA numbers, phone, date of birth and bank details.'],
  ['A row with the Work Email of someone already in the company updates that employee instead of adding a new one.'],
  [],
  ['Job Title, Employee Type, Basic Salary, Town and Manager Email may be left blank and filled in later.'],
  [`Employee Type: one of ${STANDARD_EMPLOYEE_TYPES.join(', ')}.`],
  ['Basic Salary: the monthly amount in KSh, e.g. 85000 (commas are fine).'],
  ['Manager Email: the work email of the person they report to (their supervisor).'],
  [],
  ['Example row:'],
  [...TEMPLATE_COLUMNS],
  EXAMPLE,
];

/** The template workbook: the Employees sheet first (the upload reads the first sheet), then How to fill. */
export function employeeTemplateWorkbook(): XLSX.WorkBook {
  const employees = XLSX.utils.aoa_to_sheet([[...TEMPLATE_COLUMNS]]);
  employees['!cols'] = TEMPLATE_COLUMNS.map((c) => ({ wch: Math.max(14, c.length + 4) }));
  const help = XLSX.utils.aoa_to_sheet(HOW_TO_FILL);
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
