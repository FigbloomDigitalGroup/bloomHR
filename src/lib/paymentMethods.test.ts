import { describe, expect, it } from 'vitest';
import { isPaidByMpesa, normalisePaymentMethod, paymentKind, paymentMethodLabel, paymentMethodOption } from './paymentMethods';

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

describe('isPaidByMpesa', () => {
  it('pays M-Pesa staff, including those with no method set', () => {
    expect([{ payment_method: 'M-Pesa' }, { payment_method: 'MPESA' }, { payment_method: 'Mobile Money' }, { payment_method: null }, {}].map(isPaidByMpesa)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it('leaves out bank, cash and Airtel staff', () => {
    expect([{ payment_method: 'Bank Transfer' }, { payment_method: 'Cash' }, { payment_method: 'Airtel Money' }, { payment_method: 'Cheque' }].map(isPaidByMpesa)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});
