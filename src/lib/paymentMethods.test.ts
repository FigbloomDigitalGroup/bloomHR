import { describe, expect, it } from 'vitest';
import { normalisePaymentMethod, paymentKind, paymentMethodLabel, paymentMethodOption } from './paymentMethods';

describe('normalisePaymentMethod', () => {
  it.each([
    ['M-Pesa', 'M-Pesa'],
    ['MPESA', 'M-Pesa'],
    ['mpesa', 'M-Pesa'],
    ['Mobile Money', 'M-Pesa'],
    ['airtel', 'Airtel Money'],
    ['Airtel Money', 'Airtel Money'],
    ['bank', 'Bank Transfer'],
    ['Bank transfer', 'Bank Transfer'],
    ['CASH', 'Cash'],
    ['cheque', undefined],
    ['', undefined],
    [null, undefined],
  ])('%s -> %s', (typed, saved) => {
    expect(normalisePaymentMethod(typed)).toBe(saved);
  });
});

describe('paymentMethodLabel', () => {
  it('shows every M-Pesa spelling as M-Pesa, so payroll filters and payslips match it', () => {
    expect(['MPESA', 'Mobile Money', 'm-pesa', ' M-Pesa '].map(paymentMethodLabel)).toEqual(['M-Pesa', 'M-Pesa', 'M-Pesa', 'M-Pesa']);
  });

  it('treats no method as M-Pesa, as payroll pays it, and keeps unknown methods as typed', () => {
    expect(paymentMethodLabel(null)).toBe('M-Pesa');
    expect(paymentMethodLabel('')).toBe('M-Pesa');
    expect(paymentMethodLabel(' Cheque ')).toBe('Cheque');
  });
});

describe('paymentMethodOption', () => {
  it('leaves an unset dropdown blank', () => {
    expect(paymentMethodOption(null)).toBe('');
    expect(paymentMethodOption('Mobile Money')).toBe('M-Pesa');
  });
});

describe('paymentKind', () => {
  it.each([
    [null, 'mobile'],
    ['', 'mobile'],
    ['MPESA', 'mobile'],
    ['M-Pesa', 'mobile'],
    ['Mobile Money', 'mobile'],
    ['Airtel Money', 'mobile'],
    ['Cash', 'cash'],
    ['Bank Transfer', 'bank'],
    ['Cheque', 'bank'],
  ])('%s is paid by %s', (method, kind) => {
    expect(paymentKind(method)).toBe(kind);
  });
});
