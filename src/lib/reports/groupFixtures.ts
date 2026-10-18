import type { Branch } from '../branches';

// A company in Kenya, Tanzania and Uganda (FIG-905 stage 5 tests): four branches, five people and the month's payslips.

const branch = (id: string, name: string, country: string, currency: string, isDefault = false): Branch => ({
  id, name, country, currency, city: null, address: null, active: true, is_default: isDefault,
});

export const BRANCHES: Branch[] = [
  branch('b-nbo', 'Nairobi HQ', 'Kenya', 'KES', true),
  branch('b-mba', 'Mombasa', 'Kenya', 'KES'),
  branch('b-dar', 'Dar es Salaam', 'Tanzania', 'TZS'),
  branch('b-kla', 'Kampala', 'Uganda', 'UGX'),
];

export const EMPLOYEES = [
  { 'Employee Number': 'K1', 'First Name': 'Amina', 'Last Name': 'Wanjiru', branch_id: 'b-nbo', 'Job Level': 'Finance', Status: 'Active', 'Start Date': '2026-10-05' },
  { 'Employee Number': 'K2', 'First Name': 'Juma', 'Last Name': 'Otieno', branch_id: 'b-mba', 'Job Level': 'Operations', Status: 'Active', 'Start Date': '2024-01-10', pay_basis: 'work' },
  { 'Employee Number': 'T1', 'First Name': 'Neema', 'Last Name': 'Mushi', branch_id: 'b-dar', 'Job Level': 'Operations', Status: 'Active', 'Start Date': '2025-03-01' },
  { 'Employee Number': 'U1', 'First Name': 'Akello', 'Last Name': 'Grace', branch_id: 'b-kla', 'Job Level': 'Operations', Status: 'Active', 'Start Date': '2025-06-01', worker_kind: 'casual' },
  { 'Employee Number': 'K9', 'First Name': 'Old', 'Last Name': 'Timer', branch_id: 'b-nbo', 'Job Level': 'Finance', Status: 'Terminated', 'Start Date': '2020-01-01' },
];

export const KENYA_RATES = { nssf_rate: 0.06, nssf_employer_rate: 0.06, ahl_rate: 0.015, ahl_employer_rate: 0.015 };
export const RATES = new Map<string, Record<string, unknown> | null>([['Kenya', KENYA_RATES]]);

export const PAYSLIPS = [
  {
    employee_id: 'K1', employee_name: 'Amina Wanjiru', country: 'Kenya', currency: 'KES', gross_pay: 100000, paye_tax: 20000, nssf_deduction: 4320,
    nhif_deduction: 2750, housing_levy: 1500, nita_levy: 50, loan_deduction: 1000, total_deductions: 29570, net_pay: 70430,
  },
  {
    employee_id: 'K2', employee_name: 'Juma Otieno', country: 'Kenya', currency: 'KES', gross_pay: 50000, paye_tax: 6000, nssf_deduction: 3000,
    nhif_deduction: 1375, housing_levy: 750, nita_levy: 50, total_deductions: 11125, net_pay: 38875,
  },
  {
    employee_id: 'T1', employee_name: 'Neema Mushi', country: 'Tanzania', currency: 'TZS', gross_pay: 2000000, paye_tax: 300000, nssf_deduction: 200000,
    employer_nssf: 200000, sdl_levy: 70000, wcf_levy: 10000, heslb_deduction: 0, total_deductions: 500000, net_pay: 1500000,
  },
  {
    employee_id: 'U1', employee_name: 'Akello Grace', country: 'Uganda', currency: 'UGX', gross_pay: 1500000, paye_tax: 330750, nssf_deduction: 75000,
    lst_deduction: 25000, employer_nssf: 150000, total_deductions: 430750, net_pay: 1069250,
  },
];
