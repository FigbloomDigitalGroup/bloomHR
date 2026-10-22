import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { compareScannerIds, idDigits, scannerError, scannerServers, seenLabel, serialLooksRight, suggestMatches } from './attendanceScanners';

const people = (...numbers: string[]) => numbers.map((employeeNumber) => ({ employeeNumber }));

describe('suggestMatches (Match automatically)', () => {
  it('matches a scanner user ID to the employee number with the same digits', () => {
    expect(Object.fromEntries(suggestMatches(['6', '12', '007'], people('FBL-000006', 'FBL-000012', 'MCL-000007', 'FBL-000099'))))
      .toEqual({ '6': 'FBL-000006', '12': 'FBL-000012', '007': 'MCL-000007' });
  });

  it('suggests nothing when it isn’t clear', () => {
    // two people with digits 6, an ID that isn't a number, nobody with 5
    expect(suggestMatches(['6', 'A6', '5'], people('FBL-000006', 'MCL-6', 'FBL-000007')).size).toBe(0);
  });

  it('skips employees already matched, and suggests each employee once', () => {
    expect(suggestMatches(['6'], people('FBL-000006'), ['FBL-000006']).size).toBe(0);
    expect(Object.fromEntries(suggestMatches(['6', '06'], people('FBL-000006')))).toEqual({ '6': 'FBL-000006' });
  });
});

describe('helpers', () => {
  it('idDigits and natural order', () => {
    expect(idDigits('FBL-000006')).toBe('6');
    expect(idDigits('0')).toBe('0');
    expect(idDigits('ABC')).toBeNull();
    expect(['10', '2', '1'].sort(compareScannerIds)).toEqual(['1', '2', '10']);
  });

  it('serial numbers', () => {
    expect(serialLooksRight(' brav260421021 ')).toBe(true);
    expect(serialLooksRight('a b')).toBe(false);
  });

  it('plain messages for refusals', () => {
    expect(scannerError({ code: '23505', message: 'duplicate key value violates unique constraint "attendance_devices_serial_key"' }))
      .toMatch(/already registered/);
    expect(scannerError({ code: '23505', message: 'duplicate key value violates unique constraint "attendance_scanner_users_key"' }))
      .toMatch(/already matched/);
    expect(scannerError({ code: 'P0001', message: 'Unknown employee' })).toBe('Unknown employee');
  });

  it('last seen in Nairobi time', () => {
    expect(seenLabel('2026-10-22T05:05:00Z')).toBe('Thu 22 Oct 2026, 8:05 am');
    expect(seenLabel(null)).toBe('Never connected');
  });

  it('where scanners connect: the relay host when set, and this app', () => {
    expect(scannerServers('https://scanners.example.com/', 'hr.example.com')).toEqual({ relay: 'scanners.example.com', app: 'hr.example.com' });
    expect(scannerServers('', 'hr.example.com')).toEqual({ relay: null, app: 'hr.example.com' });
  });
});
