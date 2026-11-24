import type { ReactNode } from 'react';
import { StatusPill } from '../UI';
import { hrRequestPending, requestedAt, requestedWhen } from '../../lib/hrRequests';
import type { HrState } from '../../lib/platformSchoolHr';

// "Requested 2 days ago" next to HR & Payroll "Off" on the Fleet companies and Property workspaces pages: the
// customer asked for Figbloom HR in the product, and staff switch it on with the usual Enable (lib/hrRequests.ts).

interface Row {
  hr_requested_at?: string | null;
  hr?: { state: HrState } | null;
}

/** The HR & Payroll cell, with "Requested …" after it while a customer's request waits. */
export function WithHrRequest({ row, children }: { row: Row; children: ReactNode }) {
  if (!hrRequestPending(row)) return <>{children}</>;
  const iso = row.hr_requested_at!;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      {children}
      <span title={`The customer asked for Figbloom HR on ${requestedAt(iso)}`}>
        <StatusPill label={`Requested ${requestedWhen(iso)}`} tone="info" />
      </span>
    </span>
  );
}

/** The "HR requested (n)" filter chip, beside the status tabs; shown only while there are requests (or it is on). */
export function HrRequestedChip({ count, on, onChange }: { count: number; on: boolean; onChange: (on: boolean) => void }) {
  if (!count && !on) return null;
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)}
      title="Customers who asked for Figbloom HR that isn't switched on yet, the longest waiting first"
      className={`px-3 py-1.5 rounded-tile border text-[11.5px] font-semibold ${on ? 'border-status-info bg-status-info-tint text-status-info' : 'border-border bg-white text-ink hover:bg-secondary'}`}>
      HR requested ({count})
    </button>
  );
}
