import { describe, expect, it } from 'vitest';
import { canEditEmployeeField } from './employeeFieldAccess';

const READ_ONLY = ['Employee Number', 'Work Email', 'Work Mobile', 'Mobile Number'];

describe('canEditEmployeeField', () => {
  // hrAdmin: the person's role holds HR administration (administrators and HR by default)
  const as = (hrAdmin: boolean, isEditMode: boolean, field: string) =>
    canEditEmployeeField(field, { hrAdmin, isEditMode, readOnlyFields: READ_ONLY, currentValue: 'already filled in' });

  it('lets whoever holds HR administration change any field, including the primary mobile number', () => {
    expect(as(true, true, 'Mobile Number')).toBe(true);
    expect(as(true, true, 'Work Email')).toBe(true);
    expect(as(true, false, 'Work Email')).toBe(true);
  });

  it('lets a staff member change their own personal details while editing, but not the locked ones', () => {
    expect(as(false, true, 'Personal Email')).toBe(true);
    expect(as(false, true, 'Mobile Number')).toBe(false);
    expect(as(false, true, 'Work Mobile')).toBe(false);
    expect(as(false, true, 'Employee Number')).toBe(false);
  });

  it('lets a staff member ADD their primary mobile number while it is empty, but not change it afterwards', () => {
    const base = { hrAdmin: false, isEditMode: true, readOnlyFields: READ_ONLY };
    expect(canEditEmployeeField('Mobile Number', { ...base, currentValue: '' })).toBe(true);
    expect(canEditEmployeeField('Mobile Number', { ...base, currentValue: null })).toBe(true);
    expect(canEditEmployeeField('Mobile Number', { ...base, currentValue: '   ' })).toBe(true);
    expect(canEditEmployeeField('Mobile Number', { ...base, currentValue: '0712345678' })).toBe(false);
    expect(canEditEmployeeField('Work Mobile', { ...base, currentValue: '' })).toBe(false); // only the primary number
    expect(canEditEmployeeField('Mobile Number', { ...base, isEditMode: false, currentValue: '' })).toBe(false);
  });

  it('changes nothing for a staff member who is only viewing', () => {
    expect(as(false, false, 'Personal Email')).toBe(false);
  });
});
