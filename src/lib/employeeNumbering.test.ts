import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('./supabase', () => ({ supabase: { rpc } }));

import { formatEmployeeNumber, loadEmployeeNumbering, numberingError, saveEmployeeNumbering } from './employeeNumbering';

const row = { mode: 'system', prefix: 'MCL-', digits: 6, next_number: 1501, preview: 'MCL-001501' };

beforeEach(() => rpc.mockReset());

describe('formatEmployeeNumber', () => {
  it('puts the prefix before the count padded to the digits', () => {
    expect(formatEmployeeNumber('MCL-', 6, 1)).toBe('MCL-000001');
    expect(formatEmployeeNumber('MCL-', 6, 1501)).toBe('MCL-001501');
    expect(formatEmployeeNumber('EMP/', 4, 42)).toBe('EMP/0042');
    expect(formatEmployeeNumber('FIG', 3, 7)).toBe('FIG007');
  });

  it('works with no prefix, and never cuts a count longer than the digits', () => {
    expect(formatEmployeeNumber('', 3, 5)).toBe('005');
    expect(formatEmployeeNumber('', 2, 12345)).toBe('12345');
    expect(formatEmployeeNumber('A-', 1, 9)).toBe('A-9');
  });
});

describe('numberingError', () => {
  it('accepts what the database accepts', () => {
    expect(numberingError('MCL-', 6, 1)).toBeNull();
    expect(numberingError('', 1, 1)).toBeNull();
    expect(numberingError('a.b_c/D-12345', 10, 1)).toMatch(/prefix/); // 13 characters
    expect(numberingError('ab.c_d/E-123', 10, 99)).toBeNull();
  });

  it('refuses a bad prefix, digits or next number', () => {
    expect(numberingError('MC L', 6, 1)).toMatch(/prefix/);
    expect(numberingError('MCL#', 6, 1)).toMatch(/prefix/);
    expect(numberingError('MCL-', 0, 1)).toMatch(/digits/);
    expect(numberingError('MCL-', 11, 1)).toMatch(/digits/);
    expect(numberingError('MCL-', 2.5, 1)).toMatch(/digits/);
    expect(numberingError('MCL-', 6, 0)).toMatch(/next number/);
    expect(numberingError('MCL-', 6, Number.NaN)).toMatch(/next number/);
  });
});

describe('loading and saving', () => {
  it('reads the settings, or null when the person may not see them', async () => {
    rpc.mockResolvedValueOnce({ data: [row], error: null });
    expect(await loadEmployeeNumbering()).toEqual(row);
    expect(rpc).toHaveBeenCalledWith('employee_numbering');
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'You may not see how employee numbers are given' } });
    expect(await loadEmployeeNumbering()).toBeNull();
  });

  it('saves, moving the count only when a next number is given', async () => {
    rpc.mockResolvedValue({ data: [row], error: null });
    expect(await saveEmployeeNumbering('system', 'MCL-', 6, 1501)).toEqual(row);
    expect(rpc).toHaveBeenLastCalledWith('set_employee_numbering', { p_mode: 'system', p_prefix: 'MCL-', p_digits: 6, p_next: 1501 });
    await saveEmployeeNumbering('own', 'MCL-', 6);
    expect(rpc).toHaveBeenLastCalledWith('set_employee_numbering', { p_mode: 'own', p_prefix: 'MCL-', p_digits: 6, p_next: null });
  });

  it('throws the reason when refused', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'You may not change how employee numbers are given' } });
    await expect(saveEmployeeNumbering('own', '', 6)).rejects.toThrow(/may not change/);
  });
});
