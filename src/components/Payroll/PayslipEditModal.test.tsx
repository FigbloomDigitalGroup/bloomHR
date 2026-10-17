import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { StatutoryContext } from '../../lib/payslipOverrides';

const db = vi.hoisted(() => ({
  history: [] as unknown[],
  savePayslipEdit: vi.fn(),
  removePayslipEdits: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/payslipOverridesDb', () => ({
  loadPayslipHistory: () => Promise.resolve(db.history),
  savePayslipEdit: db.savePayslipEdit,
  removePayslipEdits: db.removePayslipEdits,
}));

import { PayslipEditBar, PayslipEditModal, editBlockedReason } from './PayslipEditModal';

const rates = {
  paye_bands: [{ upto: 24000, rate: 0.1 }, { upto: 32333, rate: 0.25 }, { upto: 500000, rate: 0.3 }, { upto: null, rate: 0.35 }],
  personal_relief: 2400, shif_deductible: 1, ahl_deductible: 1, shif_rate: 0.0275, shif_minimum: 300, ahl_rate: 0.015,
  nssf_rate: 0.06, nssf_upper_limit: 108000,
};
const context: StatutoryContext = { rates, inputs: {}, apply: { shif: true, nssf: true, ahl: true, paye: true } };
const base = {
  employee_id: 'E1', employee_name: 'Ann Achieng', basic_salary: 60000, house_allowance: 0, transport_allowance: 0,
  medical_allowance: 0, other_allowances: 0, overtime_hours: 0, overtime_rate: 0, commission: 0, bonus: 0, per_diem: 19800,
  gross_pay: 60000, paye_tax: 5000, nhif_deduction: 1650, nssf_deduction: 3600, housing_levy: 900, loan_deduction: 0,
  advance_deduction: 0, welfare_deduction: 0, other_deductions: 0, deduction_items: [], earning_items: [], leave_deduction: 0,
  total_deductions: 11150, net_pay: 48850,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  db.history = [];
});

const renderModal = (props: Partial<Parameters<typeof PayslipEditModal>[0]> = {}) => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onRemove = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <PayslipEditModal record={base} base={base} override={null} context={context} runStatus="draft" onClose={onClose} onSave={onSave} onRemove={onRemove} {...props} />,
  );
  return { onSave, onRemove, onClose };
};

const preview = (key: string) => screen.getByTestId(`preview-${key}`).textContent ?? '';

describe('PayslipEditModal', () => {
  it('previews gross, each statutory deduction and net before saving', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /add an earning/i }));
    fireEvent.change(screen.getByLabelText('One-off earning 1 name'), { target: { value: 'Bonus' } });
    fireEvent.change(screen.getByLabelText('One-off earning 1 amount'), { target: { value: '10000' } });
    expect(preview('gross_pay')).toMatch(/KSh 60,000.*→.*KSh 70,000/);
    for (const key of ['paye_tax', 'nssf_deduction', 'nhif_deduction', 'housing_levy', 'net_pay']) {
      expect(screen.getByTestId(`preview-${key}`)).toBeTruthy();
    }
    // SHIF at 2.75% of cash pay: 70,000 less the per diem (33% of the 60,000 basic)
    expect(preview('nhif_deduction')).toMatch(/KSh 1,380.5/);
    // no statutory amount can be typed in
    expect(screen.queryByLabelText('PAYE')).toBeNull();
    expect(screen.queryByLabelText(/net pay/i)).toBeNull();
  });

  it('a reason is required', async () => {
    const { onSave } = renderModal();
    fireEvent.change(screen.getByLabelText('Basic salary'), { target: { value: '65000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/say why/i);
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Pay rise from October' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const input = onSave.mock.calls[0][0];
    expect(input.override).toEqual({ fields: { basic_salary: 65000 } });
    expect(input.reason).toBe('Pay rise from October');
    expect(input.after.gross_pay).toBe(65000);
    expect(input.changes.map((c: { field: string }) => c.field)).toEqual(expect.arrayContaining(['Basic salary', 'Gross pay', 'Net pay']));
  });

  it('one-off deductions need a name and an amount', async () => {
    const { onSave } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: /add a deduction/i }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Damaged laptop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/needs a name/);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('is disabled while the run is approved: "Reopen the run to edit"', () => {
    const { onSave } = renderModal({ runStatus: 'approved' });
    expect(screen.getByRole('status').textContent).toBe('Reopen the run to edit');
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Basic salary') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('removes the edits with a reason', async () => {
    const edited = { ...base, gross_pay: 65000, net_pay: 52000, basic_salary: 65000 };
    const { onRemove } = renderModal({ record: edited, override: { fields: { basic_salary: 65000 } } });
    expect((screen.getByLabelText('Basic salary') as HTMLInputElement).value).toBe('65000');
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Entered by mistake' } });
    fireEvent.click(screen.getByRole('button', { name: /remove edits/i }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledTimes(1));
    expect(onRemove.mock.calls[0][0].after).toBe(base);
    expect(onRemove.mock.calls[0][0].changes).toContainEqual({ field: 'Basic salary', before: 65000, after: 60000 });
  });
});

describe('PayslipEditBar', () => {
  const edit = (status: 'draft' | 'approved' | 'paid', override = null as null | { note: string }) => ({
    run: { id: 'run1', status, pay_period: '2026-10' },
    base,
    override,
    context,
    onSaved: vi.fn(),
  });

  it('offers Edit on a draft run and shows the Edited badge and history', async () => {
    db.history = [
      { id: 'h1', run_id: 'run1', pay_period: '2026-10', employee_id: 'E1', action: 'edited', reason: 'Arrears', edited_by: 'u', edited_by_name: 'Pat Payroll', edited_at: '2026-10-17T10:00:00Z', overrides: {}, changes: [{ field: 'Gross pay', before: 60000, after: 65000 }] },
    ];
    render(<PayslipEditBar record={base} edit={edit('draft', { note: 'x' })} />);
    expect(screen.getByText('Edited')).toBeTruthy();
    const button = screen.getByRole('button', { name: /edit payslip/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    const history = await screen.findByText(/Edit history \(1\)/);
    expect(within(history.closest('details') as HTMLElement).getByText(/Gross pay: KSh 60,000 → KSh 65,000/)).toBeTruthy();
    fireEvent.click(button);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('is disabled on an approved run, and a paid run points to next month', () => {
    render(<PayslipEditBar record={base} edit={edit('approved')} />);
    expect((screen.getByRole('button', { name: /edit payslip/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Reopen the run to edit')).toBeTruthy();
    cleanup();
    render(<PayslipEditBar record={base} edit={edit('paid')} />);
    expect((screen.getByRole('button', { name: /edit payslip/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/next month's payslip as a one-off adjustment/)).toBeTruthy();
    expect(editBlockedReason('draft')).toBeNull();
  });
});
