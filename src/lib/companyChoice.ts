// Remembers, for this browser tab only, that the person has chosen which company to work in, so a page refresh
// does not ask again but a new sign-in does. (sessionStorage can be unavailable; then they are simply asked again.)
const KEY = 'company_chosen_for';

export function markCompanyChosen(userId: string): void {
  try {
    sessionStorage.setItem(KEY, userId);
  } catch {
    /* ask again next time */
  }
}

export function hasChosenCompany(userId: string): boolean {
  try {
    return sessionStorage.getItem(KEY) === userId;
  } catch {
    return false;
  }
}

export function clearCompanyChoice(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
