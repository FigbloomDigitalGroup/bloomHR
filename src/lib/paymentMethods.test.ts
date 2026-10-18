import { describe, expect, it } from 'vitest';
import {
  isKesPayslip, isPaidByMpesa, mpesaKenyaNote, normalisePaymentMethod, paymentKind, paymentMethodLabel, paymentMethodOption, splitForMpesaKenya,
} from './paymentMethods';

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

describe('M-Pesa Kenya pays KES payslips only', () => {
  it('counts KES and payslips with no currency (saved before payslips had one) as KES', () => {
    expect(isKesPayslip({ currency: 'KES' })).toBe(true);
    expect(isKesPayslip({ currency: ' kes ' })).toBe(true);
    expect(isKesPayslip({ currency: null })).toBe(true);
    expect(isKesPayslip({})).toBe(true);
    expect(isKesPayslip({ currency: 'TZS' })).toBe(false);
    expect(isKesPayslip({ currency: 'UGX' })).toBe(false);
    expect(isKesPayslip({ currency: 'USD' })).toBe(false);
  });

  it('splits payslips into the ones M-Pesa Kenya pays and the rest', () => {
    const slips = [{ id: 1, currency: 'KES' }, { id: 2, currency: 'TZS' }, { id: 3 }, { id: 4, currency: 'USD' }];
    const { kes, other } = splitForMpesaKenya(slips);
    expect(kes.map((s) => s.id)).toEqual([1, 3]);
    expect(other.map((s) => s.id)).toEqual([2, 4]);
  });

  it('says how many payslips are left out and in which currencies', () => {
    expect(mpesaKenyaNote([{ currency: 'KES' }, {}])).toBeNull();
    expect(mpesaKenyaNote([{ currency: 'USD' }, { currency: 'TZS' }, { currency: 'UGX' }, { currency: 'TZS' }])).toBe(
      "4 payslips in TZS/UGX/USD aren't paid through M-Pesa Kenya. Use the bank or mobile money file for their currency."
    );
    expect(mpesaKenyaNote([{ currency: 'UGX' }])).toBe("1 payslip in UGX isn't paid through M-Pesa Kenya. Use the bank or mobile money file for its currency.");
  });
});
