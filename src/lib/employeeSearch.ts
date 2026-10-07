/**
 * Does an employee record match what was typed in the Employees search box? Every word typed must appear somewhere
 * in the name, employee number, work email or mobile number, so "michael m", "mwaura michael" and "michael 1019"
 * all find Michael Mwaura (FIG-1019). Empty name parts are skipped, never read as the word "null".
 */
export function employeeMatchesSearch(employee: Record<string, unknown>, search: string): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = ['First Name', 'Middle Name', 'Last Name', 'Employee Number', 'Work Email', 'Mobile Number']
    .map((field) => employee[field])
    .filter((value) => value !== null && value !== undefined && value !== '')
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}
