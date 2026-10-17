import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { loadRunOverrides } from '../lib/payslipOverridesDb';
import type { PayslipOverride } from '../lib/payslipOverrides';

const NONE = new Map<string, PayslipOverride>();

/** A payroll run's payslip edits by employee number (none without a run), loaded again when `version` changes. */
export function usePayslipOverrides(runId: string | null | undefined, version: number) {
  const [state, setState] = useState<{ runId: string | null; overrides: Map<string, PayslipOverride> }>({ runId: null, overrides: NONE });

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    loadRunOverrides(runId).then(
      (overrides) => {
        if (!cancelled) setState({ runId, overrides });
      },
      () => {
        if (!cancelled) toast.error("Could not load this month's payslip edits.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [runId, version]);

  // edits loaded for another run (or none) are never applied to this one
  return runId && state.runId === runId ? state.overrides : NONE;
}
