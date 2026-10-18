import { describe, expect, it } from 'vitest';
import {
  entryAmount, entryTotals, monthOf, parseQuantity, rateOn, rateStarts, sheetDate, templateRows, typeOpenOn, workRowsFromSheet,
  type WorkRate,
} from './pieceRate';

const TEA = { id: 't1', rate: 15 };
const rate = (from: string, r: number): WorkRate => ({ id: `${from}-${r}`, work_type_id: 't1', rate: r, effective_from: from });

describe('amounts', () => {
  it('reads a quantity: numbers more than 0, commas allowed, anything else is nothing', () => {
    expect(parseQuantity('42.5')).toBe(42.5);
    expect(parseQuantity(' 1,250 ')).toBe(1250);
    expect(parseQuantity('.5')).toBe(0.5);
    expect(parseQuantity(12)).toBe(12);
    expect(parseQuantity('0.12345')).toBe(0.123);
    for (const bad of ['', '0', '-3', 'lots', '1e3', '12kg', null, undefined]) expect(parseQuantity(bad)).toBeNull();
  });

  it('works out an amount to the cent, as the database does', () => {
    expect(entryAmount(42.5, 12)).toBe(510);
    expect(entryAmount('3.333', '7.5')).toBe(25);
    expect(entryAmount(null, 12)).toBe(0);
  });

  it('adds up only the work that counts', () => {
    const t = entryTotals([
      { quantity: '10', amount: '120', status: 'approved' },
      { quantity: 2.5, amount: 30, status: 'approved' },
      { quantity: 99, amount: 999, status: 'draft' },
      { quantity: 5, amount: 60, status: 'rejected' },
      { quantity: 1, amount: 12, status: 'submitted' },
    ]);
    expect(t).toEqual({ quantity: 12.5, amount: 150 });
    expect(entryTotals([{ quantity: 1, amount: 12, status: 'submitted' }], ['submitted', 'approved']).amount).toBe(12);
  });
});

describe('the rate on a day', () => {
  it('takes the latest rate that started on or before the day', () => {
    const rates = [rate('-infinity', 12), rate('2026-10-10', 14), rate('2026-11-01', 16)];
    expect(rateOn(rates, TEA, '2026-01-01')).toBe(12);
    expect(rateOn(rates, TEA, '2026-10-09')).toBe(12);
    expect(rateOn(rates, TEA, '2026-10-10')).toBe(14);
    expect(rateOn(rates, TEA, '2026-12-25')).toBe(16);
  });

  it("before the first rate, the first; with no history, the type's own rate", () => {
    expect(rateOn([rate('2026-10-10', 14)], TEA, '2026-09-01')).toBe(14);
    expect(rateOn([], TEA, '2026-09-01')).toBe(15);
    expect(rateOn([{ ...rate('2026-01-01', 99), work_type_id: 'other' }], TEA, '2026-09-01')).toBe(15);
  });

  it("'-infinity' is from the start", () => {
    expect(rateStarts('-infinity')).toBeNull();
    expect(rateStarts('2026-10-10')).toBe('2026-10-10');
  });

  it('a kind of work is open on a day when in use and within its dates', () => {
    const t = { active: true, effective_from: '2026-10-01', effective_to: '2026-12-31' };
    expect(typeOpenOn(t, '2026-10-01')).toBe(true);
    expect(typeOpenOn(t, '2026-09-30')).toBe(false);
    expect(typeOpenOn(t, '2027-01-01')).toBe(false);
    expect(typeOpenOn({ ...t, active: false }, '2026-10-15')).toBe(false);
    expect(typeOpenOn({ active: true, effective_from: null, effective_to: null }, '1999-01-01')).toBe(true);
  });

  it("knows a month's first and last day", () => {
    expect(monthOf('2026-02-14')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthOf('2028-02-03')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthOf('2026-12-31')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('the spreadsheet', () => {
  it('reads dates as ISO, day first, or Excel day numbers; leaves the rest for the database to refuse', () => {
    expect(sheetDate('2026-10-16')).toBe('2026-10-16');
    expect(sheetDate('2026-10-16T00:00:00')).toBe('2026-10-16');
    expect(sheetDate('16/10/2026')).toBe('2026-10-16');
    expect(sheetDate('6.3.26')).toBe('2026-03-06');
    expect(sheetDate(46311)).toBe('2026-10-16');
    expect(sheetDate('next Tuesday')).toBe('next Tuesday');
    expect(sheetDate('31/13/2026')).toBe('31/13/2026');
  });

  it("takes the template's columns or common other names, drops empty rows and keeps each row's place", () => {
    const rows = workRowsFromSheet([
      { 'Employee Number': 'W1', Date: '2026-10-16', 'Kind of Work': 'Tea picked', Quantity: 42.5, Notes: 'North' },
      { 'Employee Number': '', Date: '', 'Kind of Work': '', Quantity: '' },
      { 'emp no': 'W2', 'work date': '16/10/2026', 'Work Type': 'Weeding', qty: '3' },
      { EMPLOYEE_NUMBER: 'W3', DATE: 46311, TASK: 'Pruning', UNITS: '1,200' },
    ]);
    expect(rows).toEqual([
      { employee_number: 'W1', work_date: '2026-10-16', work_type: 'Tea picked', quantity: '42.5', notes: 'North', sheet_row: 2 },
      { employee_number: 'W2', work_date: '2026-10-16', work_type: 'Weeding', quantity: '3', notes: '', sheet_row: 4 },
      { employee_number: 'W3', work_date: '2026-10-16', work_type: 'Pruning', quantity: '1,200', notes: '', sheet_row: 5 },
    ]);
  });

  it("fills the template with real workers paid by work and kinds of work in use", () => {
    const people = [
      { employee_number: 'S1', pay_basis: 'salary' as const },
      { employee_number: 'W1', pay_basis: 'work' as const },
      { employee_number: 'W2', pay_basis: 'work' as const },
    ];
    const types = [{ name: 'Old', active: false }, { name: 'Tea picked', active: true }, { name: 'Weeding', active: true }];
    expect(templateRows(people, types, '2026-10-16')).toEqual([
      ['W1', '2026-10-16', 'Tea picked', '10', ''],
      ['W2', '2026-10-16', 'Weeding', '10', ''],
    ]);
    expect(templateRows([], types, '2026-10-16')).toHaveLength(1);
  });
});
