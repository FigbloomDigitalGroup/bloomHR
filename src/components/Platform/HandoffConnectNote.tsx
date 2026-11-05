import { useState } from 'react';
import { loadPendingHandoff } from '../../lib/platformHandoff';

/**
 * On HR's sign-in (and invitation) page, when someone just came from Figbloom Schools and their Schools account is not
 * connected to an HR login yet (src/lib/platformHandoff.ts).
 */
export default function HandoffConnectNote() {
  const [pending] = useState(() => loadPendingHandoff());
  if (!pending) return null;
  return (
    <div role="status" className="rounded-card border border-brand/30 bg-brand/5 px-4 py-3 text-[13px] text-ink">
      <p className="m-0 font-semibold">Sign in to HR once to connect your Figbloom Schools account</p>
      <p className="m-0 mt-1 text-[12px] text-muted-foreground">
        After this, HR &amp; Payroll in Figbloom Schools opens HR without a password. Use the HR account you were
        invited with for your school.
      </p>
    </div>
  );
}
