// A company name typed before the person confirmed their email. Registering with "Confirm email" on ends at
// "check your email"; the company is created when they come back signed in, wherever the app lands them.
const KEY = 'pending_company_name';

export function readPendingCompany(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writePendingCompany(name: string): void {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    /* storage unavailable: they will be asked for the name again */
  }
}

export function clearPendingCompany(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
