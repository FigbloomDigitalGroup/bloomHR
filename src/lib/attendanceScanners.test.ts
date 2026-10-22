import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import {
  compareScannerIds,
  employeesNamed,
  idDigits,
  nameKey,
  scannerError,
  scannerServers,
  seenLabel,
  serialLooksRight,
  suggestMatches,
  suggestScannerMatches,
} from './attendanceScanners';

const people = (...numbers: string[]) => numbers.map((employeeNumber) => ({ employeeNumber }));

// Figbloom's people, as far as the scanner's names go (Oct 22)
const person = (employeeNumber: string, name: string, status = 'Active') => {
  const parts = name.split(' ');
  return { employeeNumber, firstName: parts[0], middleName: parts.slice(1, -1).join(' '), lastName: parts.length > 1 ? parts[parts.length - 1] : '', status };
};
const STAFF = [
  person('FBL-000003', 'Victor Ogola'),
  person('FBL-000010', 'Esther Nalenyi'),
  person('FBL-000004', 'David Katam'),
  person('FBL-000005', 'Hassan Faruq'),
  person('FBL-000006', 'Francis Kiprono'),
  person('FBL-000007', 'Francis Maina'),
  person('FBL-000008', 'Morris Bundi Maina'),
  person('FBL-000017', 'Anne Wanjiru'),
  person('FBL-000021', 'Hannah Achieng'),
  person('FBL-000023', 'Gloria Atieno', 'Terminated'),
  person('FBL-000001', 'Fidel Odhiambo'),
];
// the scanner's own list: ID -> name
const SCANNER: [string, string][] = [
  ['1', 'Onyii'], ['2', 'Fidel'], ['3', 'Esther'], ['9', 'Franciskiprono'], ['10', 'Katam'], ['11', 'Victor'], ['16', 'Maina'],
  ['17', 'Ann'], ['19', 'Morris'], ['20', 'Faruq'], ['21', 'Hana'], ['22', 'Beatrice'], ['23', 'Gloria'],
];
const numbersNamed = (name: string) => employeesNamed(name, STAFF).map((e) => e.employeeNumber);

describe('matching by the name on the scanner', () => {
  it('a first name, a surname, or both run together', () => {
    expect(numbersNamed('Esther')).toEqual(['FBL-000010']);
    expect(numbersNamed('Katam')).toEqual(['FBL-000004']);
    expect(numbersNamed('Faruq')).toEqual(['FBL-000005']);
    expect(numbersNamed('Franciskiprono')).toEqual(['FBL-000006']);
    expect(numbersNamed('  esther NALENYI ')).toEqual(['FBL-000010']);
    expect(numbersNamed('Kiprono Francis')).toEqual(['FBL-000006']);
    expect(numbersNamed('Bundi')).toEqual(['FBL-000008']);
  });

  it('several people: Maina is two of them', () => {
    expect(numbersNamed('Maina')).toEqual(['FBL-000007', 'FBL-000008']);
  });

  it('nobody: Onyii, Ann (not Anne), Hana (not Hannah), Gloria (who has left)', () => {
    for (const name of ['Onyii', 'Ann', 'Hana', 'Gloria', '', '  ']) expect(numbersNamed(name)).toEqual([]);
  });

  it('compares letters only, without case or accents', () => {
    expect(nameKey(" Ng'ang'a  Wé ")).toBe('ngangawe');
  });
});

describe('suggestScannerMatches (Match automatically)', () => {
  const waiting = SCANNER.map(([scannerUserId, name]) => ({ scannerUserId, name }));

  it('suggests by name, never by a number the name disagrees with', () => {
    const { matches, ambiguous } = suggestScannerMatches(waiting, STAFF);
    expect(Object.fromEntries([...matches].map(([id, m]) => [id, `${m.employeeNumber} by ${m.by}`]))).toEqual({
      '2': 'FBL-000001 by name',
      '3': 'FBL-000010 by name', // not Victor Ogola (FBL-000003)
      '9': 'FBL-000006 by name',
      '10': 'FBL-000004 by name',
      '11': 'FBL-000003 by name',
      '19': 'FBL-000008 by name',
      '20': 'FBL-000005 by name',
    });
    // 17 "Ann" isn't suggested Anne Wanjiru (FBL-000017) by number: the scanner's name decides
    expect(Object.fromEntries(ambiguous)).toEqual({ '16': 'Maina' });
  });

  it('by employee number only when the scanner has no name for the ID', () => {
    const { matches } = suggestScannerMatches([{ scannerUserId: '17' }, { scannerUserId: '3', name: null }, { scannerUserId: '1', name: 'Onyii' }], STAFF);
    expect(Object.fromEntries([...matches].map(([id, m]) => [id, `${m.employeeNumber} by ${m.by}`]))).toEqual({
      '17': 'FBL-000017 by number',
      '3': 'FBL-000003 by number',
    });
  });

  it('skips people already matched, and someone two IDs point at', () => {
    expect(suggestScannerMatches([{ scannerUserId: '3', name: 'Esther' }], STAFF, ['FBL-000010']).matches.size).toBe(0);
    const twice = suggestScannerMatches([{ scannerUserId: '3', name: 'Esther' }, { scannerUserId: '30', name: 'Nalenyi' }], STAFF);
    expect(twice.matches.size).toBe(0);
  });
});

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
