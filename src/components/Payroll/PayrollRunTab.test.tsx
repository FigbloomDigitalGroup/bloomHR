import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const toasts = vi.hoisted(() => ({ error: [] as string[] }));
vi.mock('react-hot-toast', () => ({ default: { error: (m: string) => toasts.error.push(m), success: () => {} } }));
vi.mock('./PayrollRunBar', () => ({ default: () => null }));
vi.mock('./ReturnsReadiness', () => ({ default: () => null }));
vi.mock('./MinimumWageWarning', () => ({ default: ({ periodLabel }: { periodLabel: string }) => <div data-testid="minimum-wage-slot">{periodLabel}</div> }));

import PayrollRunTab from './PayrollRunTab';
import type { PayrollRun } from '../../lib/payrollRuns';
import { countryReadiness, totalsByCurrency } from '../../lib/payroll/multiCountry';
import { KENYA_RATES } from '../../lib/payroll/countries/kenyaFixtures';

beforeEach(() => {
  toasts.error = [];
});
afterEach(cleanup);

const record = {
  id: 'r1', employee_id: 'E1', employeeNu: '', employee_name: 'Amina Wanjiru', position: 'Accountant', department: 'Finance',
  basic_salary: 80000, house_allowance: 0, transport_allowance: 0, overtime_hours: 0, overtime_rate: 0,
  gross_pay: 80000, paye_tax: 12000, nhif_deduction: 2200, nssf_deduction: 2160, housing_levy: 1200,
  advance_deduction: 0, total_deductions: 17560, net_pay: 62440,
};

const props = (demoPay: Partial<Parameters<typeof PayrollRunTab>[0]['demoPay']> = {}, run: PayrollRun | null = null) => ({
  periodLabel: 'October 2026', onDownloadPdf: vi.fn(), monthRun: run, runLoading: false, runBusy: false,
  onStart: vi.fn(), onApprove: vi.fn(), onReopen: vi.fn(), onMarkPaid: vi.fn(), onDiscard: vi.fn(),
  onPayroll: [], onOpenFiles: vi.fn(), userRole: 'admin', handleBulkMpesaPayment: vi.fn(),
  onOpenSpreadsheet: vi.fn(), onOpenApprovals: vi.fn(), pendingCount: 0,
  branches: [{ value: 'all', label: 'All Branches' }], selectedBranch: 'all', setSelectedBranch: vi.fn(),
  departments: ['all'], selectedDepartment: 'all', setSelectedDepartment: vi.fn(),
  paymentMethods: ['all'], selectedPaymentMethod: 'all', setSelectedPaymentMethod: vi.fn(),
  searchTerm: '', setSearchTerm: vi.fn(), finalFilteredRecords: [record], currentItems: [record],
  totals: { totalGrossPay: 80000, totalDeductions: 17560, totalNetPay: 62440, totalPAYE: 12000, totalNHIF: 2200, totalNSSF: 2160, totalHousingLevy: 1200 },
  expandedRows: new Set(), toggleRowExpand: vi.fn(), smsSendingStatus: {}, sendingSMS: false,
  sendPayslipNotification: vi.fn(), handleSingleMpesaPayment: vi.fn(), handleViewPayslip: vi.fn(),
  currentPage: 1, totalPages: 1, handlePageChange: vi.fn(), itemsPerPage: 10,
  demoPay: {
    shown: true, enabled: false, blockedReason: "Approve October 2026's payroll first, then pay",
    lineFor: () => ({ employeeNumber: 'E1', name: 'Amina Wanjiru', netPay: 62440, channel: 'Bank' as const, problems: [] }),
    isPaid: () => false, onPaid: vi.fn(), onPayAll: vi.fn(),
    ...demoPay,
  },
});

describe('PayrollRunTab', () => {
  it('lists the employees with the month totals, without the summary cards', () => {
    render(<PayrollRunTab {...props()} />);
    expect(screen.getByText(/Employees on payroll/)).toBeTruthy();
    expect(screen.getAllByText('Amina Wanjiru').length).toBeGreaterThan(0);
    expect(screen.getByText(/Total · 1 employee/)).toBeTruthy();
    expect(screen.queryByText('Housing levy')).toBeNull();
  });

  it('shows Pay all and Pay before approval, and says to approve first when clicked', () => {
    const p = props();
    render(<PayrollRunTab {...p} />);
    fireEvent.click(screen.getByText('Pay all employees'));
    expect(p.demoPay.onPayAll).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: 'Pay' }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Pay' })[0]);
    expect(toasts.error).toEqual(["Approve October 2026's payroll first, then pay", "Approve October 2026's payroll first, then pay"]);
  });

  it('opens the pay-all dialog once the month is approved', () => {
    const p = props({ enabled: true, blockedReason: null });
    render(<PayrollRunTab {...p} />);
    fireEvent.click(screen.getByText('Pay all employees'));
    expect(p.demoPay.onPayAll).toHaveBeenCalledOnce();
    expect(toasts.error).toEqual([]);
  });

  it('saves the listed payslips as a PDF from the list header', () => {
    const p = props();
    render(<PayrollRunTab {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /Download PDF/ }));
    expect(p.onDownloadPdf).toHaveBeenCalledOnce();
  });

  it('hides the Pay buttons when demo paying is off', () => {
    render(<PayrollRunTab {...props({ shown: false })} />);
    expect(screen.queryByText('Pay all employees')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pay' })).toBeNull();
  });
});

describe('PayrollRunTab minimum wage warning', () => {
  it('shows the warning slot before approval and hides it once the month is approved', () => {
    render(<PayrollRunTab {...props()} payPeriod="2026-10" />);
    expect(screen.getByTestId('minimum-wage-slot').textContent).toBe('October 2026');
    cleanup();
    const approved = { id: 'run1', pay_period: '2026-10', status: 'approved' } as unknown as PayrollRun;
    render(<PayrollRunTab {...props({}, approved)} payPeriod="2026-10" />);
    expect(screen.queryByTestId('minimum-wage-slot')).toBeNull();
  });
});

describe('PayrollRunTab: one run for every country (FIG-905 stage 2)', () => {
  const branches = [
    { id: 'hq', name: 'Nairobi HQ', country: 'Kenya', currency: 'KES', city: null, address: null, active: true, is_default: true },
    { id: 'dar', name: 'Dar es Salaam', country: 'Tanzania', currency: 'TZS', city: null, address: null, active: true, is_default: false },
  ];
  const ke = { ...record, country: 'Kenya', currency: 'KES' };
  const staff = [
    { 'Employee Number': 'E1', 'First Name': 'Amina', 'Last Name': 'Wanjiru', branch_id: 'hq', 'Tax PIN': 'A012345678Z', 'NSSF Number': '1', 'SHIF Number': '2', payment_method: 'cash' },
    { 'Employee Number': 'E2', 'First Name': 'Baraka', 'Last Name': 'Mushi', branch_id: 'dar' },
  ];
  const readinessFor = (runCountries: { country: string; status: 'draft' | 'approved' | 'paid' }[]) =>
    countryReadiness({
      employees: staff, branches, payslips: [ke], runCountries, runStarted: true,
      ratesByCountry: new Map([['Kenya', KENYA_RATES]]),
    });
  const actions = () => ({ onApprove: vi.fn(), onReopen: vi.fn(), onMarkPaid: vi.fn(), onDiscard: vi.fn() });
  const run = { id: 'run1', pay_period: '2026-10', status: 'draft' } as unknown as PayrollRun;

  it('shows the readiness per country and the approval summary; staff without rules wait, never on Kenya rules', () => {
    render(<PayrollRunTab {...props({}, run)} onPayroll={staff} companyBranches={branches} readiness={readinessFor([{ country: 'Kenya', status: 'draft' }])} countryActions={actions()} />);
    expect(screen.getByTestId('approval-summary').textContent).toBe('Kenya 1 payslip KSh 62K ✓ · Tanzania 1 waiting for rules');
    const tz = screen.getByTestId('country-Tanzania');
    expect(tz.textContent).toContain('Waiting for rules');
    expect(tz.textContent).toContain('Waiting for Tanzania payroll rules');
    expect(tz.textContent).toContain('Baraka Mushi');
    expect(screen.getByTestId('country-Kenya').textContent).toContain('Ready');
    expect(screen.queryByText(/Kenya rules/)).toBeNull();
  });

  it('approves or reopens one country from its menu', () => {
    const a = actions();
    render(<PayrollRunTab {...props({}, run)} onPayroll={staff} companyBranches={branches} readiness={readinessFor([{ country: 'Kenya', status: 'draft' }])} countryActions={a} />);
    fireEvent.click(screen.getByRole('button', { name: 'Kenya actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Approve Kenya only' }));
    expect(a.onApprove).toHaveBeenCalledWith('Kenya');
    cleanup();
    render(<PayrollRunTab {...props({}, run)} onPayroll={staff} companyBranches={branches} readiness={readinessFor([{ country: 'Kenya', status: 'approved' }])} countryActions={a} />);
    fireEvent.click(screen.getByRole('button', { name: 'Kenya actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reopen Kenya' }));
    expect(a.onReopen).toHaveBeenCalledWith('Kenya');
  });

  it('shows the totals per currency, never added together', () => {
    const tz = { ...record, id: 'r2', employee_id: 'E2', employee_name: 'Baraka Mushi', country: 'Tanzania', currency: 'TZS', gross_pay: 1000000, total_deductions: 200000, net_pay: 800000 };
    const rows = [ke, tz];
    render(<PayrollRunTab {...props()} finalFilteredRecords={rows} currentItems={rows} payrollRecords={rows} currencyTotals={totalsByCurrency(rows)} />);
    expect(screen.getByTestId('net-totals').textContent).toBe('KSh 62,440 · TSh 800,000');
    expect(screen.getByTestId('total-KES').textContent).toContain('KSh 62,440');
    expect(screen.getByTestId('total-TZS').textContent).toContain('TSh 800,000');
    expect(screen.getAllByText('TSh 800,000').length).toBeGreaterThan(0);
    expect(screen.queryByText(/862,440/)).toBeNull();
  });
});
