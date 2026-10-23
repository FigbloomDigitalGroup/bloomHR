import { useEffect, useState } from 'react';
import { loadMissedScans, missedScanLine, type MissedScan } from '../../lib/missedScanApi';

/**
 * A day's missed-scan requests and their decisions, next to its scan list (migration 20261025100000): "Missed scan,
 * approved by Mary Kamau: came in 7:59 am, 'forgot to scan'." Nothing shows when there are none (or they can't be read).
 */
export default function MissedScanHistory({ employeeNumber, day }: { employeeNumber: string; day: string }) {
  const [items, setItems] = useState<MissedScan[]>([]);

  useEffect(() => {
    let live = true;
    loadMissedScans({ employeeNumber, from: day, to: day })
      .then((list) => live && setItems(list.filter((m) => m.status !== 'cancelled')))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [employeeNumber, day]);

  if (items.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 list-none p-0" aria-label="Missed-scan requests">
      {items.map((m) => (
        <li key={m.id} className={`text-[12px] ${m.status === 'declined' ? 'text-muted-foreground' : 'text-status-info'}`}>
          {missedScanLine(m)}
        </li>
      ))}
    </ul>
  );
}
