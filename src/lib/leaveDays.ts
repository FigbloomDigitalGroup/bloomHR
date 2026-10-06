import { parseDay } from './contract';

export const NO_EMPLOYEE_RECORD_MESSAGE =
  'We could not find your employee record, so this cannot be submitted yet. Ask HR to check that your work email matches your login.';

/**
 * Calendar days a leave covers, counting both the first and the last day (5 to 7 October = 3).
 * 0 when either date is missing or the end is before the start, which is not a valid request.
 */
export function leaveDays(start: string | null | undefined, end: string | null | undefined): number {
  const from = parseDay(start);
  const to = parseDay(end);
  if (!from || !to || to < from) return 0;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}
