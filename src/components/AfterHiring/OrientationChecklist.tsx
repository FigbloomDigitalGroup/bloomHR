import { useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { StatusPill } from '../UI';
import { OWNER_LABELS, type ChecklistItem, isOverdue, progressOf, shortDate } from '../../lib/afterHiring';

// A new employee's orientation checklist: each item with who does it and when it is due. Items the viewer may tick
// have a checkbox (HR: all; the employee: those marked for them); the rest show whether they are done.

interface Props {
  items: ChecklistItem[];
  canTick: (item: ChecklistItem) => boolean;
  onToggle: (item: ChecklistItem, done: boolean) => Promise<void>;
}

export default function OrientationChecklist({ items, canTick, onToggle }: Props) {
  const [saving, setSaving] = useState<string | null>(null);
  const { done, total } = progressOf(items, (i) => Boolean(i.done_at));

  const toggle = async (item: ChecklistItem, value: boolean) => {
    setSaving(item.id);
    try {
      await onToggle(item, value);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(null);
    }
  };

  if (total === 0) return <p className="text-sm text-muted-foreground">No orientation checklist yet.</p>;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}
          aria-label="Checklist progress">
          <div className="h-full bg-brand" style={{ width: `${(100 * done) / total}%` }} />
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap">{done} of {total} done</span>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {items.map((item) => {
          const isDone = Boolean(item.done_at);
          const tickable = canTick(item);
          const late = isOverdue(item.due_date, isDone);
          return (
            <li key={item.id} className="flex items-start gap-3 px-3 py-2">
              <span className="pt-0.5 w-4 shrink-0">
                {saving === item.id ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <input type="checkbox" checked={isDone} disabled={!tickable} aria-label={item.title}
                    onChange={(e) => void toggle(item, e.target.checked)} className="h-4 w-4 accent-[rgb(var(--brand))]" />
                )}
              </span>
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${isDone ? 'text-muted-foreground line-through' : 'text-ink'}`}>{item.title}</p>
                {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {OWNER_LABELS[item.owner_role]}
                  {item.due_date ? ` · due ${shortDate(item.due_date)}` : ''}
                  {isDone && item.done_at ? ` · done ${shortDate(item.done_at)}` : ''}
                </p>
              </div>
              {late && <StatusPill label="Overdue" tone="danger" />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
