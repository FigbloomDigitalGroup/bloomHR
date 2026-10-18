import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const toasts = vi.hoisted(() => ({ error: [] as string[] }));
vi.mock('react-hot-toast', () => ({ default: { error: (m: string) => toasts.error.push(m), success: () => {} } }));

import { MpesaBulkPaymentModal, MpesaSinglePaymentModal } from './PaymentApprovalModals';

afterEach(() => {
  cleanup();
  toasts.error = [];
});

// the legacy M-Pesa buttons: M-Pesa Kenya pays KES payslips only, never TZS, UGX or USD
const slip = (employee_id: string, currency?: string, extra: Record<string, unknown> = {}) => ({
  employee_id, employee_name: `Name ${employee_id}`, net_pay: 1000, payment_method: 'M-Pesa', currency, ...extra,
});
const NOTE = "3 payslips in TZS/UGX/USD aren't paid through M-Pesa Kenya. Use the bank or mobile money file for their currency.";

describe('M-Pesa bulk pay', () => {
  it('lists only KES payslips, says why the others are left out, and sends only the KES ones', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <MpesaBulkPaymentModal
        isOpen
        onClose={() => {}}
        userRole="credit_analyst_officer"
        employees={[slip('K1', 'KES'), slip('K2'), slip('T1', 'TZS'), slip('U1', 'UGX'), slip('D1', 'USD'), slip('B1', 'KES', { payment_method: 'Bank Transfer' })]}
        onConfirm={onConfirm}
      />
    );
    expect(screen.getByText('Name K1')).toBeTruthy();
    expect(screen.getByText('Name K2')).toBeTruthy();
    for (const id of ['T1', 'U1', 'D1', 'B1']) expect(screen.queryByText(`Name ${id}`)).toBeNull();
    expect(screen.getByRole('note').textContent).toBe(NOTE);
    fireEvent.click(screen.getByRole('button', { name: /Confirm M-Pesa Payment \(2\)/ }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onConfirm.mock.calls[0][0].map((e: { employee_id: string }) => e.employee_id)).toEqual(['K1', 'K2']);
  });

  it('shows no note when every payslip is in KES', () => {
    render(<MpesaBulkPaymentModal isOpen onClose={() => {}} employees={[slip('K1', 'KES'), slip('K2')]} onConfirm={vi.fn()} />);
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('M-Pesa single pay', () => {
  it('refuses a USD payslip with the note and never confirms it', () => {
    const onConfirm = vi.fn();
    render(<MpesaSinglePaymentModal isOpen onClose={() => {}} userRole="credit_analyst_officer" employee={slip('D1', 'USD')} onConfirm={onConfirm} />);
    expect(screen.getByRole('note').textContent).toBe("1 payslip in USD isn't paid through M-Pesa Kenya. Use the bank or mobile money file for its currency.");
    const button = screen.getByRole('button', { name: /Confirm Payment/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('pays a KES payslip as before', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<MpesaSinglePaymentModal isOpen onClose={() => {}} userRole="credit_analyst_officer" employee={slip('K1')} onConfirm={onConfirm} />);
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Confirm Payment/ }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
  });
});
