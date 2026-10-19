import { useState } from 'react';
import toast from 'react-hot-toast';
import { type FollowUp, errorMessage, followUpText, setFollowUpDueDate } from '../../lib/onboarding';

// What an employee can give after approval (documents, referees, policies, and any detail the company does not make
// essential), with HR's due dates. HR sets the dates; the employee sees them.

interface Props {
  followUps: FollowUp[];
  /** HR: set a due date per item (the employee's record id) */
  employeeId?: string;
  onChanged?: () => void;
}

export default function StillToProvide({ followUps, employeeId, onChanged }: Props) {
  const [saving, setSaving] = useState<string | null>(null);

  if (followUps.length === 0) return <p className="text-sm text-muted-foreground">Nothing outstanding.</p>;

  const setDue = async (item: string, due: string) => {
    if (!employeeId) return;
    setSaving(item);
    try {
      await setFollowUpDueDate(employeeId, item, due || null);
      toast.success(due ? 'Due date saved' : 'Due date removed');
      onChanged?.();
    } catch (err) {
      toast.error(errorMessage(err, 'The due date was not saved.'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <ul className="divide-y divide-border/60">
      {followUps.map((f) => (
        <li key={f.item} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
          <span className={f.overdue ? 'text-status-danger' : 'text-ink'}>{employeeId ? f.item + (f.note ? ` (${f.note})` : '') : followUpText(f)}</span>
          {employeeId && (
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              Due
              <input
                type="date"
                aria-label={`Due date for ${f.item}`}
                value={f.due_date ?? ''}
                disabled={saving !== null}
                onChange={(e) => void setDue(f.item, e.target.value)}
                className={`rounded border px-1.5 py-0.5 text-xs ${f.overdue ? 'border-status-danger text-status-danger' : 'border-border text-ink'}`}
              />
            </label>
          )}
        </li>
      ))}
    </ul>
  );
}
