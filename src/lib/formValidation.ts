/**
 * A phone number as people actually type it: an optional +, then 8 to 15 digits, with spaces, dashes, dots and
 * brackets allowed between them (0712 345 678, +254-712-345-678, (0712) 345678).
 */
export function isValidPhone(value: string | null | undefined): boolean {
  const compact = String(value ?? '').replace(/[\s().-]/g, '');
  return /^\+?\d{8,15}$/.test(compact);
}

/** "emergencyContactPhone" / "deductionNSSF Number" -> "Emergency Contact Phone" / "NSSF Number". */
function labelFor(key: string): string {
  const cleaned = key.replace(/^deduction/, '').replace(/\d+$/, '');
  return cleaned
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * One readable sentence listing everything that stopped a form from saving, so the person is not left pressing Save
 * on a button that silently does nothing because a required field on another tab is empty.
 */
export function summarizeErrors(errors: Record<string, string>): string {
  const lines = Object.entries(errors)
    .filter(([, message]) => message)
    .map(([key, message]) => {
      const label = labelFor(key);
      return message.toLowerCase().includes(label.toLowerCase()) ? message : `${label}: ${message}`;
    });
  if (lines.length === 0) return 'Please check the form.';
  const shown = lines.slice(0, 4).join('. ');
  return `Cannot save yet. ${shown}${lines.length > 4 ? ` (and ${lines.length - 4} more)` : ''}`;
}
