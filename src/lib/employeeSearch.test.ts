import { describe, expect, it } from 'vitest';
import { employeeMatchesSearch } from './employeeSearch';

const michael = {
  'First Name': 'Michael',
  'Middle Name': null,
  'Last Name': 'Mwaura',
  'Employee Number': 'FIG-1019',
  'Work Email': 'mikekirutic@gmail.com',
  'Mobile Number': '0111498300',
};

describe('employeeMatchesSearch', () => {
  it('finds a person by first name and the start of the last name, with no middle name on record', () => {
    expect(employeeMatchesSearch(michael, 'michael m')).toBe(true);
    expect(employeeMatchesSearch(michael, 'Michael Mwaura')).toBe(true);
  });

  it('accepts the words in any order and mixed with the number, email or phone', () => {
    expect(employeeMatchesSearch(michael, 'mwaura michael')).toBe(true);
    expect(employeeMatchesSearch(michael, 'michael 1019')).toBe(true);
    expect(employeeMatchesSearch(michael, 'mikekirutic')).toBe(true);
    expect(employeeMatchesSearch(michael, '0111')).toBe(true);
  });

  it('needs every word to match, and never matches the word "null" from an empty field', () => {
    expect(employeeMatchesSearch(michael, 'michael otieno')).toBe(false);
    expect(employeeMatchesSearch(michael, 'null')).toBe(false);
  });

  it('shows everyone when the search is empty', () => {
    expect(employeeMatchesSearch(michael, '   ')).toBe(true);
  });
});
