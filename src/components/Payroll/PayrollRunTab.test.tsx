import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const toasts = vi.hoisted(() => ({ error: [] as string[] }));
vi.mock('react-hot-toast', () => ({ default: { error: (m: string) => toasts.error.push(m), success: () => {} } }));
vi.mock('./PayrollRunBar', () => ({ default: () => null }));
vi.mock('./ReturnsReadiness', () => ({ default: () => null }));

import PayrollRunTab from './PayrollRunTab';
import type { PayrollRun } from '../../lib/payrollRuns';

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
