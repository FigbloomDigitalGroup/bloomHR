/**
 * A database update that matches no row is not an error: the rules (RLS) simply filter the row out, so the screen can
 * look as if it saved while nothing changed. Call this with the rows an update returned (add .select() to the update)
 * to turn that silence into a message.
 */
export class NotSavedError extends Error {}

export function requireUpdatedRows<T>(rows: T[] | null | undefined, message: string): T[] {
  if (!rows || rows.length === 0) throw new NotSavedError(message);
  return rows;
}

/** The message to show for a failed save: our own explanation when nothing was saved, otherwise the general one. */
export const saveFailureMessage = (error: unknown, fallback: string): string => (error instanceof NotSavedError ? error.message : fallback);

export const NOT_SAVED_NOT_LINKED =
  'Your changes were not saved: this login is not linked to that employee record. Ask HR to check that the Work Email on your record is the email you sign in with.';

export const NOT_SAVED_NO_ACCESS = 'The changes were not saved: you do not have permission to change this employee, or the record no longer exists.';
