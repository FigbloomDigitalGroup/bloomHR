import { useEffect, useState } from 'react';
import { Card, StatusPill } from '../UI';
import { ABSENCE_KIND_LABEL, formatDateRange, workingDaysText, type AbsenceRecord } from '../../lib/leaveDiscipline';
import { loadMyAbsences } from '../../lib/leaveDisciplineApi';

// The staff portal's own absence records (FIG-881): unexcused absences and failures to notify that HR or the
// supervisor recorded, and whether they were excused. Nothing shows when there are none.

type Mine = Awaited<ReturnType<typeof loadMyAbsences>>[number];

export default function MyAbsences() {
  const [rows, setRows] = useState<Mine[]>([]);

  useEffect(() => {
    let live = true;
    loadMyAbsences()
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, []);

  if (rows.length === 0) return null;
  return (
    <Card className="mt-4">
      <h2 className="m-0 text-sm font-bold text-ink">Absences recorded</h2>
      <p className="text-[11.5px] text-muted-foreground mt-1 mb-3">
        An unexcused absence is unpaid. If you have a reason or a document, give it to HR: an excused absence is not deducted.
      </p>
      <ul className="m-0 p-0 list-none space-y-2">
        {rows.map((a) => (
          <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-[#F1F5F2] last:border-b-0 pb-2">
            <div className="text-xs text-ink">
              <div className="font-semibold">{ABSENCE_KIND_LABEL[a.kind as AbsenceRecord['kind']] ?? a.kind}</div>
              <div className="text-muted-foreground">{formatDateRange(a.start_date, a.end_date)} · {workingDaysText(a.days)}</div>
              {a.note && <div className="text-muted-foreground">{a.note}</div>}
              {a.excuse_note && <div className="text-muted-foreground">Excused: {a.excuse_note}</div>}
            </div>
            <StatusPill tone={a.status === 'excused' ? 'success' : 'warning'} label={a.status === 'excused' ? 'Excused' : 'Recorded'} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
