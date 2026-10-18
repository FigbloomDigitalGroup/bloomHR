/**
 * May this person type into this field of an employee record? Whoever holds HR administration (hr-admin: by default
 * administrators and HR) may change anything; an employee only the fields not in `readOnlyFields` (pay, contract and
 * company-provided details), and only while editing. The one exception: the primary mobile number may be added by the
 * employee while it is still empty (changing it later needs HR). The database enforces the same rule (20261006000500).
 */
export function canEditEmployeeField(
  fieldName: string,
  options: { hrAdmin: boolean; isEditMode: boolean; readOnlyFields: readonly string[]; currentValue?: unknown }
): boolean {
  if (options.hrAdmin) return true;
  if (!options.isEditMode) return false;
  if (fieldName === 'Mobile Number' && String(options.currentValue ?? '').trim() === '') return true;
  return !options.readOnlyFields.includes(fieldName);
}
