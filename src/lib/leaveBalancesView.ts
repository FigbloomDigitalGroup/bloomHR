// How the Leave Balances tab lists its rows: filtered by a search and a leave type, sorted by the column chosen.

export type BalanceSortKey = 'employee' | 'number' | 'leave_type' | 'office' | 'earned' | 'used' | 'remaining';
export type SortDirection = 'asc' | 'desc';

export interface BalanceRow {
  employee_number: string;
  first_name: string;
  last_name: string;
  office: string;
  leave_type_id: string;
  leave_type_name: string;
  accrued_days: number;
  used_days: number;
  remaining_days: number;
}

const fullName = (b: BalanceRow) => `${b.first_name} ${b.last_name}`.trim();
const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

/** Rows matching the search (name or employee number) and the leave type ('' = all). */
export function filterBalances<T extends BalanceRow>(rows: T[], search: string, leaveTypeId: string): T[] {
  const q = search.trim().toLowerCase();
  return rows.filter((b) =>
    (!leaveTypeId || b.leave_type_id === leaveTypeId)
    && (!q || fullName(b).toLowerCase().includes(q) || b.employee_number.toLowerCase().includes(q)));
}

/**
 * Sorted by the chosen column; ties fall back to the employee's name, then the leave type, so one person's rows stay
 * together. Rows without a name go last.
 */
export function sortBalances<T extends BalanceRow>(rows: T[], key: BalanceSortKey, direction: SortDirection): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  const byName = (a: T, b: T) => {
    const an = fullName(a), bn = fullName(b);
    if (!an !== !bn) return an ? -1 : 1;
    return text(an, bn) || text(a.employee_number, b.employee_number);
  };
  const primary = (a: T, b: T): number => {
    switch (key) {
      case 'employee': return byName(a, b);
      case 'number': return text(a.employee_number, b.employee_number);
      case 'leave_type': return text(a.leave_type_name, b.leave_type_name);
      case 'office': return text(a.office, b.office);
      case 'earned': return (Number(a.accrued_days) || 0) - (Number(b.accrued_days) || 0);
      case 'used': return (Number(a.used_days) || 0) - (Number(b.used_days) || 0);
      case 'remaining': return (Number(a.remaining_days) || 0) - (Number(b.remaining_days) || 0);
    }
  };
  return [...rows].sort((a, b) =>
    sign * primary(a, b)
    || (key === 'employee' ? 0 : byName(a, b))
    || text(a.leave_type_name, b.leave_type_name));
}
