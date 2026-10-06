import { describe, expect, it } from 'vitest';
import { isValidPhone, summarizeErrors } from './formValidation';

describe('isValidPhone', () => {
  it.each(['0712345678', '+254712345678', '0712 345 678', '+254-712-345-678', '(0712) 345678', '254712345678', '0712.345.678'])('accepts %s', (v) => {
    expect(isValidPhone(v)).toBe(true);
  });

  it.each(['', '123', '07123', 'abcdefghij', '0712-345-67x', '+', '++254712345678', '1234567890123456', null, undefined])('rejects %s', (v) => {
    expect(isValidPhone(v as string)).toBe(false);
  });
});

describe('summarizeErrors', () => {
  it('lists what blocks saving, naming the field when the message does not', () => {
    const text = summarizeErrors({ 'Personal Email': 'Personal Email is required', emergencyContactPhone: 'Emergency contact phone is required', 'First Name': 'This field is required' });
    expect(text).toContain('Cannot save yet.');
    expect(text).toContain('Personal Email is required');
    expect(text).toContain('Emergency contact phone is required');
    expect(text).toContain('First Name: This field is required');
  });

  it('caps a long list and says how many more there are', () => {
    const many = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`Field ${i}`, `Field ${i} is required`]));
    expect(summarizeErrors(many)).toMatch(/and 3 more/);
  });

  it('copes with an empty or message-less set', () => {
    expect(summarizeErrors({})).toBe('Please check the form.');
    expect(summarizeErrors({ a: '' })).toBe('Please check the form.');
  });
});
