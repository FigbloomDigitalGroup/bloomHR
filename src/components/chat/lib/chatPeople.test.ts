import { describe, expect, it } from 'vitest';
import { findEmployee } from './chatPeople';
import type { Employee } from '../types/types';

const emp = (n: string, first: string, last: string, email: string): Employee => ({
  id: n, employeeNumber: n, firstName: first, lastName: last, fullName: `${first} ${last}`, workEmail: email,
  jobTitle: 'Field Assistant', department: 'General', entity: 'Company', status: 'offline', initials: `${first[0]}${last[0]}`,
});
const people = [emp('E1', 'Michael', 'Kiruti', 'Michael@Farm.co.ke'), emp('E2', 'Samuel', 'Barasa', 'samuel@farm.co.ke')];

describe('findEmployee', () => {
  it('finds a message author by their display name', () => {
    expect(findEmployee(people, { name: 'michael kiruti' })?.id).toBe('E1');
  });
  it('finds a conversation by email, ignoring case', () => {
    expect(findEmployee(people, { name: 'kirutimichael.m', email: 'michael@farm.co.ke' })?.id).toBe('E1');
  });
  it('finds an author whose display name is their email', () => {
    expect(findEmployee(people, { name: 'samuel@farm.co.ke' })?.id).toBe('E2');
  });
  it('prefers the employee number', () => {
    expect(findEmployee(people, { employeeNumber: 'E2', name: 'Michael Kiruti' })?.id).toBe('E2');
  });
  it('returns nothing for someone with no employee record', () => {
    expect(findEmployee(people, { name: 'kirutimichael.m@gmail.com' })).toBeUndefined();
  });
});
