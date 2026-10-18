import { AlertTriangle, CalendarPlus, ExternalLink, ListTodo, PartyPopper, Plane } from 'lucide-react';
import { inDaysLabel, shortDay, type CalendarEntry } from '../../lib/upcoming';

const RANGE_CHOICES = [30, 90, 365] as const;
export type RangeChoice = (typeof RANGE_CHOICES)[number];

const rangeLabel = (d: RangeChoice) => (d === 365 ? '1 year' : `${d} days`);

const TONE: Record<CalendarEntry['kind'], string> = {
  event: 'text-status-purple bg-status-purple-tint',
  holiday: 'text-orange-text bg-orange-tint',
  leave: 'text-status-info bg-status-info-tint',
  task: 'text-amber-800 bg-amber-50',
  birthday: 'text-brand bg-green-tint',
};

function KindIcon({ entry }: { entry: CalendarEntry }) {
  const cls = 'w-4 h-4';
  if (entry.kind === 'task') return entry.overdue ? <AlertTriangle className={cls} /> : <ListTodo className={cls} />;
  if (entry.kind === 'holiday') return <PartyPopper className={cls} />;
  if (entry.kind === 'leave') return <Plane className={cls} />;
  return <CalendarPlus className={cls} />;
}

/** what is said under the title */
function describe(entry: CalendarEntry): string | null {
  if (entry.kind === 'holiday') return 'Public holiday: office closed, not counted as leave';
  if (entry.kind === 'leave') return entry.endDate && entry.endDate.getTime() !== entry.date.getTime() ? `Until ${shortDay(entry.endDate)}` : 'One day';
  if (entry.kind === 'task') return [entry.taskKey ? `Task ${entry.taskKey}` : 'Task', entry.detail].filter(Boolean).join(': ');
  return entry.detail || 'Company event';
}

function when(entry: CalendarEntry): string {
  if (entry.kind === 'task' && entry.overdue) return `Overdue by ${-entry.daysAway} day${entry.daysAway === -1 ? '' : 's'}`;
  if (entry.kind === 'task') return entry.daysAway === 0 ? 'Due today' : `Due ${inDaysLabel(entry.daysAway)}`;
  if (entry.kind === 'leave' && entry.daysAway < 0) return 'On now';
  return inDaysLabel(entry.daysAway);
}

/**
 * The calendar's "Coming up" list: company events, public holidays, the employee's own leave and their tasks, soonest
 * first, overdue tasks at the top. A row moves the calendar to its day; a task also opens in Tasks.
 */
export default function ComingUpList({
  items,
  range,
  onRangeChange,
  onPick,
  onOpenTask,
  loading,
}: {
  items: CalendarEntry[];
  range: RangeChoice;
  onRangeChange: (r: RangeChoice) => void;
  onPick: (entry: CalendarEntry) => void;
  onOpenTask?: (taskId: string) => void;
  loading?: boolean;
}) {
  const overdue = items.filter((i) => i.overdue).length;
  return (
    <section className="bg-white border border-border rounded-card p-3 sm:p-4" data-testid="coming-up" aria-label="Coming up">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div>
          <h2 className="text-[13px] font-bold text-ink m-0">Coming up</h2>
          <p className="text-[11px] text-muted-foreground m-0">The next {rangeLabel(range)}</p>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="How far ahead">
          {RANGE_CHOICES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => onRangeChange(r)}
              className={`text-[11px] font-semibold rounded-full px-2 py-0.5 border ${
                range === r ? 'bg-brand text-white border-brand' : 'bg-white text-muted-foreground border-border hover:text-ink'
              }`}
            >
              {rangeLabel(r)}
            </button>
          ))}
        </div>
      </div>
      {overdue > 0 && (
        <p className="text-[11.5px] font-semibold text-status-danger mb-1.5">
          {overdue} of your tasks {overdue === 1 ? 'is' : 'are'} overdue
        </p>
      )}
      {loading ? (
        <div className="space-y-2 py-1">
          {[0, 1, 2].map((i) => <div key={i} className="h-10 rounded-lg bg-secondary animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <p className="text-[12px] text-muted-foreground py-2">Nothing coming up in the next {rangeLabel(range)}.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((entry) => (
            <li key={entry.key} className="py-1.5 flex items-start gap-1" data-testid="coming-up-row">
              <button
                type="button"
                onClick={() => onPick(entry)}
                className="flex-1 min-w-0 flex items-start gap-2.5 text-left rounded-lg p-1 hover:bg-secondary/60"
                title="Show on the calendar"
              >
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${entry.overdue ? 'text-status-danger bg-red-50' : TONE[entry.kind]}`}>
                  <KindIcon entry={entry} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-[12.5px] font-semibold text-ink break-words">{entry.title}</span>
                    <span className={`text-[11px] font-semibold whitespace-nowrap ${entry.overdue ? 'text-status-danger' : entry.daysAway <= 0 ? 'text-brand' : 'text-muted-foreground'}`}>
                      {when(entry)}
                    </span>
                  </span>
                  <span className="block text-[11px] font-medium text-muted-foreground">{shortDay(entry.date)}</span>
                  {describe(entry) && <span className="block text-[11px] text-muted-foreground break-words">{describe(entry)}</span>}
                </span>
              </button>
              {entry.kind === 'task' && entry.taskId && onOpenTask && (
                <button
                  type="button"
                  onClick={() => onOpenTask(entry.taskId!)}
                  className="mt-1 p-1.5 rounded text-muted-foreground hover:text-ink hover:bg-secondary"
                  aria-label={`Open task ${entry.title}`}
                  title="Open in Tasks"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
