import { describe, expect, it } from 'vitest';
import { canEditEmployeeField, isHrOrAdmin, normalizeRole } from './employeeFieldAccess';

const READ_ONLY = ['Employee Number', 'Work Email', 'Work Mobile', 'Mobile Number'];

describe('roles', () => {
  it('compares roles whatever their letter case (the database stores ADMIN, HR, STAFF)', () => {
    expect(normalizeRole('ADMIN')).toBe('admin');
    expect(isHrOrAdmin('ADMIN')).toBe(true);
    expect(isHrOrAdmin('HR')).toBe(true);
    expect(isHrOrAdmin('hr')).toBe(true);
    expect(isHrOrAdmin('STAFF')).toBe(false);
    expect(isHrOrAdmin(null)).toBe(false);
    expect(isHrOrAdmin(undefined)).toBe(false);
  });
});

describe('canEditEmployeeField', () => {
  const as = (role: string, isEditMode: boolean, field: string) => canEditEmployeeField(field, { role, isEditMode, readOnlyFields: READ_ONLY, currentValue: 'already filled in' });

  it('lets an administrator or HR change any field, including the primary mobile number', () => {
    expect(as('ADMIN', true, 'Mobile Number')).toBe(true);
    expect(as('HR', true, 'Work Email')).toBe(true);
  });

  it('lets a staff member change their own personal details while editing, but not the locked ones', () => {
    expect(as('STAFF', true, 'Personal Email')).toBe(true);
    expect(as('STAFF', true, 'Mobile Number')).toBe(false);
    expect(as('STAFF', true, 'Work Mobile')).toBe(false);
    expect(as('STAFF', true, 'Employee Number')).toBe(false);
  });

  it('lets a staff member ADD their primary mobile number while it is empty, but not change it afterwards', () => {
    const base = { role: 'STAFF', isEditMode: true, readOnlyFields: READ_ONLY };
    expect(canEditEmployeeField('Mobile Number', { ...base, currentValue: '' })).toBe(true);
    expect(canEditEmployeeField('Mobile Number', { ...base, currentValue: null })).toBe(true);
    expect(canEditEmployeeField('Mobile Number', { ...base, currentValue: '   ' })).toBe(true);
    expect(canEditEmployeeField('Mobile Number', { ...base, currentValue: '0712345678' })).toBe(false);
    expect(canEditEmployeeField('Work Mobile', { ...base, currentValue: '' })).toBe(false); // only the primary number
    expect(canEditEmployeeField('Mobile Number', { ...base, isEditMode: false, currentValue: '' })).toBe(false);
  });

  it('changes nothing for a staff member who is only viewing', () => {
    expect(as('STAFF', false, 'Personal Email')).toBe(false);
  });
});
