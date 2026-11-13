// Whether someone still works here, read the way the sign-in check reads it (pages/Login.tsx): they have left when
// their Status says so (Terminated, Inactive) or their Termination Date has passed. A termination date still to come
// means they are leaving: they work (and sign in) until then.

export type EmploymentState = 'current' | 'leaving' | 'former';

interface StatusFields {
  Status?: string | null;
  'Termination Date'?: string | null;
}

/** Today as YYYY-MM-DD in the browser's own time zone (the sign-in check compares against the same). */
export function localToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function employmentState(e: StatusFields, today: string = localToday()): EmploymentState {
  const ended = String(e['Termination Date'] ?? '').trim().slice(0, 10);
  if (['terminated', 'inactive'].includes(String(e.Status ?? '').trim().toLowerCase())) return 'former';
  if (ended && ended < today) return 'former';
  return ended ? 'leaving' : 'current';
}

/** The Employees list's views: current (the default: everyone still working, those leaving included), former, all. */
export type EmployeeView = 'current' | 'former' | 'all';

export const EMPLOYEE_VIEW_LABELS: Record<EmployeeView, string> = {
  current: 'Current employees',
  former: 'Former employees',
  all: 'All employees',
};

export function inEmployeeView(e: StatusFields, view: EmployeeView, today: string = localToday()): boolean {
  if (view === 'all') return true;
  const former = employmentState(e, today) === 'former';
  return view === 'former' ? former : !former;
}
