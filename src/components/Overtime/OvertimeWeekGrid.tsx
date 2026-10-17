import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, Clock, Upload } from 'lucide-react';
import { Button, Card, EmptyState, SearchInput, TableScroll } from '../UI';
import { loadOvertime, setOvertimeHours, type OvertimeEntry, type OvertimePerson } from '../../lib/overtimeApi';
import { addDays, shortDay, today, weekDays, weekStart } from '../../lib/casualPay';
import { DAY_TYPE_LABEL, round2 } from '../../lib/overtimePay';
import OvertimeUploadModal from './OvertimeUploadModal';

// The week's overtime: a row per person, a column per day, the hours in each cell. Supervisors and payroll fill it in
// (what they enter is approved); an employee's own request shows with an orange dot until it is approved. The kind of
// day each entry was rated as shows under it (R: rest day, H: public holiday).

interface Props {
  people: OvertimePerson[];
  canUpload: boolean;
  onChanged?: () => void;
}

const personName = (p: OvertimePerson) => p.name || p.employee_number;

function HoursCell({ label, entry, disabled, onSave }: {
  label: string;
  entry: OvertimeEntry | undefined;
  disabled: boolean;
  onSave: (hours: number | null) => Promise<void>;
}) {
  const saved = entry ? String(Number(entry.hours)) : '';
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(saved), [saved]);

  const commit = async () => {
    const text = value.trim();
    if (text === saved) return;
    const hours = text === '' ? null : Number(text);
    if (hours !== null && !(hours > 0 && hours <= 24)) {
      toast.error('Hours should be more than 0 and at most 24 (leave it empty for none)');
      setValue(saved);
      return;
    }
    setBusy(true);
    try {
      await onSave(hours === null ? null : round2(hours));
    } catch (err) {
      toast.error((err as Error).message);
      setValue(saved);
    } finally {
      setBusy(false);
    }
  };

  const tone = entry?.status === 'rejected' ? 'border-status-danger text-status-danger line-through'
    : entry?.day_type === 'holiday' ? 'border-status-info text-status-info'
      : entry?.day_type === 'rest' ? 'border-orange text-orange-text-alt'
        : entry ? 'border-brand text-brand' : 'border-border text-ink';

  return (
    <div className="flex items-center gap-1">
      <input
        aria-label={label}
        inputMode="decimal"
        value={value}
        disabled={disabled || busy}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className={`w-12 rounded-md border px-1 py-1 text-[11px] text-center disabled:bg-secondary ${tone}`}
      />
      {entry && entry.day_type !== 'normal' && (
        <span className="text-[10px] font-semibold text-subtle" title={DAY_TYPE_LABEL[entry.day_type]}>{entry.day_type === 'rest' ? 'R' : 'H'}</span>
      )}
      {entry?.status === 'submitted' && (
        <span className="w-1.5 h-1.5 rounded-full bg-orange" title="Requested, waiting for approval" aria-label="Waiting for approval" />
      )}
    </div>
  );
}

export default function OvertimeWeekGrid({ people, canUpload, onChanged }: Props) {
  const [monday, setMonday] = useState(() => weekStart(today()));
  const [entries, setEntries] = useState<OvertimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const week = useMemo(() => weekDays(monday), [monday]);
  const now = today();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await loadOvertime(week[0], week[6]));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [week]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const byKey = useMemo(() => new Map(entries.map((e) => [`${e.employee_number}|${e.work_date}`, e])), [entries]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => !q || [p.name, p.employee_number, p.department].some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [people, query]);

  const save = async (p: OvertimePerson, day: string, hours: number | null) => {
    await setOvertimeHours(p.employee_number, day, hours, byKey.get(`${p.employee_number}|${day}`));
    await reload();
    onChanged?.();
  };

  return (
    <Card padding="none">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border">
        <Button variant="secondary" aria-label="Previous week" onClick={() => setMonday(addDays(monday, -7))} icon={<ChevronLeft className="w-3.5 h-3.5" />}>
          <span className="sr-only">Previous week</span>
        </Button>
        <span className="text-[13px] font-semibold text-ink">Week of {shortDay(monday)}</span>
        <Button variant="secondary" aria-label="Next week" disabled={addDays(monday, 7) > now} onClick={() => setMonday(addDays(monday, 7))} icon={<ChevronRight className="w-3.5 h-3.5" />}>
          <span className="sr-only">Next week</span>
        </Button>
        <SearchInput placeholder="Search by name, number or department" value={query} onChange={(e) => setQuery(e.target.value)} />
        {canUpload && (
          <div className="ml-auto">
            <Button variant="secondary" icon={<Upload className="w-3.5 h-3.5" />} onClick={() => setUploading(true)}>Upload overtime</Button>
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={<Clock className="w-5 h-5" />} title={loading ? 'Loading...' : 'Nobody to record overtime for'}
          description={loading ? undefined : 'The people you supervise show here (payroll sees everyone).'} />
      ) : (
        <TableScroll>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-muted-foreground border-b border-border">
                <th className="px-3 py-2 font-semibold">Employee</th>
                {week.map((d) => <th key={d} className="px-2 py-2 font-semibold whitespace-nowrap">{shortDay(d)}</th>)}
                <th className="px-3 py-2 font-semibold text-right">Week</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const total = round2(week.reduce((s, d) => {
                  const e = byKey.get(`${p.employee_number}|${d}`);
                  return s + (e && e.status !== 'rejected' ? Number(e.hours) : 0);
                }, 0));
                return (
                  <tr key={p.employee_number} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-semibold text-ink">{personName(p)}</div>
                      <div className="text-[10.5px] text-subtle">
                        {p.employee_number}{p.department ? ` · ${p.department}` : ''}
                        {p.excluded_reason && <span className="block text-status-danger">{p.excluded_reason}</span>}
                      </div>
                    </td>
                    {week.map((d) => (
                      <td key={d} className="px-1.5 py-1.5">
                        <HoursCell
                          label={`${personName(p)}, ${shortDay(d)}`}
                          entry={byKey.get(`${p.employee_number}|${d}`)}
                          disabled={d > now || (!!p.excluded_reason && !byKey.get(`${p.employee_number}|${d}`))}
                          onSave={(hours) => save(p, d, hours)}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right whitespace-nowrap font-semibold text-ink">{total} h</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}
      <p className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border">
        Type the overtime hours and press Enter; clear a cell to remove it. R: rest day, H: public holiday (paid at their
        multipliers). An orange dot: requested by the employee, waiting for approval. A month whose payroll is approved can&apos;t change.
      </p>

      {uploading && (
        <OvertimeUploadModal open people={people} onClose={() => setUploading(false)} onDone={() => { void reload(); onChanged?.(); }} />
      )}
    </Card>
  );
}
