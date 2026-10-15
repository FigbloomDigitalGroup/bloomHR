import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

// the demo must never reach the database or the network
const calls = vi.hoisted(() => ({ supabase: 0 }));
vi.mock('../../lib/supabase', () => ({
  supabase: new Proxy({}, { get: () => { calls.supabase += 1; return () => { throw new Error('no database in the demo'); }; } }),
}));
const toasts = vi.hoisted(() => ({ error: [] as string[], success: [] as string[] }));
vi.mock('react-hot-toast', () => ({
  default: { error: (m: string) => toasts.error.push(m), success: (m: string) => toasts.success.push(m) },
}));

import { DemoPayAllDialog, DemoPayButton } from './DemoPayments';
import { accountNameMatches, demoPayLines, paymentProblems } from '../../lib/demoPayments';

const fetchSpy = vi.fn();

beforeEach(() => {
  calls.supabase = 0;
  toasts.error = [];
  toasts.success = [];
  vi.stubGlobal('fetch', fetchSpy);
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchSpy.mockReset();
});

const base = {
  'Tax PIN': 'A012345678Z', 'NSSF Number': '2012345678', 'SHIF Number': 'CR1234567', 'Last Name': 'Wanjiru',
};
const EMPLOYEES = [
  { ...base, 'Employee Number': 'E1', 'First Name': 'Amina', payment_method: 'Bank Transfer', Bank: 'Equity', 'Bank Branch': 'Kilimani', 'Account Number': '0123456789', account_number_name: ' amina  WANJIRU ' },
  { ...base, 'Employee Number': 'E2', 'First Name': 'Juma', payment_method: 'M-Pesa', 'Mobile Number': '0712345678' },
  // bank account in someone else's name
  { ...base, 'Employee Number': 'E3', 'First Name': 'Otieno', payment_method: 'Bank Transfer', Bank: 'KCB', 'Bank Branch': 'CBD', 'Account Number': '999', account_number_name: 'Peter Kamau' },
  // M-Pesa number that isn't one
  { ...base, 'Employee Number': 'E4', 'First Name': 'Wairimu', payment_method: 'M-Pesa', 'Mobile Number': '12345' },
];
const RECORDS = [
  { employee_id: 'E1', employee_name: 'Amina Wanjiru', net_pay: 50000 },
  { employee_id: 'E2', employee_name: 'Juma Wanjiru', net_pay: 30000 },
  { employee_id: 'E3', employee_name: 'Otieno Wanjiru', net_pay: 20000 },
  { employee_id: 'E4', employee_name: 'Wairimu Wanjiru', net_pay: 10000 },
];
const lines = () => demoPayLines(RECORDS, EMPLOYEES);

describe('accountNameMatches', () => {
  const amina = { 'First Name': 'Amina', 'Middle Name': 'Njeri', 'Last Name': 'Wanjiru' };
  it('accepts the name as banks write it: any order, case, punctuation, initials, with or without the middle name', () => {
    for (const name of ['Amina Wanjiru', 'WANJIRU AMINA', 'Amina Njeri Wanjiru', 'Wanjiru, Amina N.', 'A. Njeri Wanjiru', 'Mrs Amina Wanjiru', 'amina  wanjiru'])
      expect(accountNameMatches(name, amina)).toBe(true);
  });
  it('refuses another person, a single shared name, or an extra unknown name', () => {
    for (const name of ['Peter Kamau', 'Amina Kamau', 'Amina', 'Amina Wanjiru Kamau', 'A. W.'])
      expect(accountNameMatches(name, amina)).toBe(false);
  });
  it('works for someone with one name on record', () => {
    expect(accountNameMatches('Wanjiru', { 'First Name': 'Wanjiru' })).toBe(true);
  });
});

describe('paymentProblems', () => {
  it('passes complete details, with the account name matched without case or spaces', () => {
    expect(paymentProblems(EMPLOYEES[0])).toEqual([]);
    expect(paymentProblems(EMPLOYEES[1])).toEqual([]);
  });

  it('flags an account in another name, a bad M-Pesa number and missing details', () => {
    expect(paymentProblems(EMPLOYEES[2])).toEqual([`Account name "Peter Kamau" doesn't match the employee's name "Otieno Wanjiru"`]);
    expect(paymentProblems(EMPLOYEES[3])).toEqual(['Phone number is not a valid M-Pesa number']);
    expect(paymentProblems({ 'Employee Number': 'E5', payment_method: 'Bank Transfer' })).toEqual(
      expect.arrayContaining(['KRA PIN', 'Bank', 'Bank branch', 'Account number', 'Account name'])
    );
  });
});

describe('DemoPayAllDialog', () => {
  it('shows the number of employees, the total, the channels and who cannot be paid', () => {
    render(<DemoPayAllDialog open onClose={() => {}} periodLabel="October 2026" lines={lines()} onPaid={() => {}} onFixDetails={() => {}} />);
    expect(screen.getByTestId('demo-pay-count').textContent).toBe('4');
    expect(screen.getByTestId('demo-pay-total').textContent).toBe('KSh 110,000');
    expect(screen.getByText('Bank')).toBeTruthy();
    expect(screen.getByText('M-Pesa')).toBeTruthy();
    expect(screen.getByText(/2 can't be paid until their details are fixed/)).toBeTruthy();
    expect(screen.getByText('Otieno Wanjiru')).toBeTruthy();
    expect(screen.getByText(/Account name "Peter Kamau" doesn't match/)).toBeTruthy();
    expect(screen.getByText('Wairimu Wanjiru')).toBeTruthy();
    expect(screen.getByText(/Demo mode/)).toBeTruthy();
  });

  it('after confirming, pays only those without problems and says who could not be paid', () => {
    const onPaid = vi.fn();
    const onFixDetails = vi.fn();
    render(<DemoPayAllDialog open onClose={() => {}} periodLabel="October 2026" lines={lines()} onPaid={onPaid} onFixDetails={onFixDetails} />);
    fireEvent.click(screen.getByRole('button', { name: /Pay 2 employees · KSh 80,000/ }));
    expect(screen.getByText(/Sending payments/)).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onPaid).toHaveBeenCalledWith(['E1', 'E2']);
    expect(screen.getByText('Payments sent to 2 employees · KSh 80,000')).toBeTruthy();
    expect(screen.getByText("2 couldn't be paid: fix their details")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fix missing details' }));
    expect(onFixDetails).toHaveBeenCalled();
    expect(calls.supabase).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('DemoPayButton', () => {
  it('explains why someone with bad details cannot be paid, and does not pay them', () => {
    const onPaid = vi.fn();
    render(<DemoPayButton line={lines()[2]} paid={false} onPaid={onPaid} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }));
    expect(screen.getByRole('alert').textContent).toBe(`Otieno Wanjiru can't be paid: Account name "Peter Kamau" doesn't match the employee's name "Otieno Wanjiru"`);
    expect(toasts.error).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onPaid).not.toHaveBeenCalled();
  });

  it('pays someone with good details after a confirm, without the database or the network', () => {
    const onPaid = vi.fn();
    const { rerender } = render(<DemoPayButton line={lines()[1]} paid={false} onPaid={onPaid} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }));
    expect(screen.getByText(/KSh 30,000 by M-Pesa/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Pay' }).at(-1)!);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onPaid).toHaveBeenCalledWith('E2');
    rerender(<DemoPayButton line={lines()[1]} paid onPaid={onPaid} />);
    expect(screen.getByText('Paid')).toBeTruthy();
    expect(calls.supabase).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
