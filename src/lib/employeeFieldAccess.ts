/** Roles are stored upper case (ADMIN, HR, STAFF) but the staff portal compared them in lower case. */
export const normalizeRole = (role: unknown): string => String(role ?? '').trim().toLowerCase();

export const isHrOrAdmin = (role: unknown): boolean => ['hr', 'admin'].includes(normalizeRole(role));

/**
 * May this person type into this field of an employee record? HR and administrators may change anything; an
 * employee only the fields not in `readOnlyFields` (pay, contract and company-provided details), and only while editing.
 * The one exception: the primary mobile number may be added by the employee while it is still empty (changing it
 * later needs HR). The database enforces the same rule (20261006000500).
 */
export function canEditEmployeeField(
  fieldName: string,
  options: { role: unknown; isEditMode: boolean; readOnlyFields: readonly string[]; currentValue?: unknown }
): boolean {
  if (isHrOrAdmin(options.role)) return true;
  if (!options.isEditMode) return false;
  if (fieldName === 'Mobile Number' && String(options.currentValue ?? '').trim() === '') return true;
  return !options.readOnlyFields.includes(fieldName);
}
