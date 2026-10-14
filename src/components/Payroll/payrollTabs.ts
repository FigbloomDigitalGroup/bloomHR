import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

// The payroll page's tabs. The open tab is kept in the address (?tab=rates), so a link or a refresh opens the same one.

export const PAYROLL_TABS = [
  { id: 'run', label: 'Run' },
  { id: 'employees', label: "Employees' pay" },
  { id: 'deductions', label: 'Deductions' },
  { id: 'rates', label: 'Rates' },
  { id: 'files', label: 'Files' },
  { id: 'history', label: 'History' },
] as const;

export type PayrollTabId = (typeof PAYROLL_TABS)[number]['id'];

const isTab = (id: string | null): id is PayrollTabId => PAYROLL_TABS.some((t) => t.id === id);

/** The open tab (Run when the address names none, or one that doesn't exist) and a way to open another. */
export function usePayrollTab(): [PayrollTabId, (id: string) => void] {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: PayrollTabId = isTab(requested) ? requested : 'run';
  const setTab = useCallback(
    (id: string) => {
      if (!isTab(id)) return;
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', id);
        return next;
      });
    },
    [setParams],
  );
  return [tab, setTab];
}
