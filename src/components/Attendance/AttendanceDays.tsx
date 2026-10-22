import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarClock, Download, Pencil } from 'lucide-react';
import { Button, Card, EmptyState, Modal, SearchInput, StatusPill, TableScroll } from '../UI';
import { LoaderBlock } from '../UI/FigbloomLoader';
import { inputClass, labelClass, tdClass, thClass } from '../Perfomance/kpis/shared';
import {
  STATUS_TONE,
  attendanceCsv,
  correctionProblem,
  dayLabel,
  daysInRange,
  formatHours,
  formatTime,
  nairobiParts,
  nairobiToIso,
  nairobiToday,
  statusLabel,
  summarise,
  weekOf,
  type AttendanceDay,
  type CsvPerson,
} from '../../lib/attendance';
import { loadAttendanceDays, removeAttendanceDay, setAttendanceDay, type AttendanceAccess } from '../../lib/attendanceApi';
import { loadEmployeeDirectory, type DirectoryEmployee } from '../../lib/employeeDirectory';
import { downloadCsv } from '../../lib/kpiApi';

const MAX_DAYS = 367;

/** The days tab: a summary per person over a range, each person's days, corrections (HR) and a CSV. */
export default function AttendanceDays({ access }: { access: AttendanceAccess }) {
  const [range, setRange] = useState(() => weekOf(nairobiToday()));
  const [days, setDays] = useState<AttendanceDay[]>([]);
  const [people, setPeople] = useState<DirectoryEmployee[]>([]);
  const [loading, setLoading] = useState(false);
  const [department, setDepartment] = useState('');
  const [branch, setBranch] = useState('');
  const [search, setSearch] = useState('');
  const [openEmp, setOpenEmp] = useState<string | null>(null);

  useEffect(() => {
    loadEmployeeDirectory().then(setPeople).catch(() => setPeople([]));
  }, []);

  const rangeProblem = !range.from || !range.to
    ? 'Choose both dates'
    : range.to < range.from
      ? 'The end date must be on or after the start date'
      : daysInRange(range.from, range.to) > MAX_DAYS
        ? 'Choose a range of a year or less'
        : null;

  const reload = useCallback(async () => {
    if (rangeProblem) return;
    setLoading(true);
    try {
      setDays(await loadAttendanceDays(range.from, range.to));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range, rangeProblem]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const byNumber = useMemo(() => new Map(people.map((p) => [p.employeeNumber, p])), [people]);
  const summaries = useMemo(() => summarise(days), [days]);
  const departments = useMemo(
    () => [...new Set(summaries.map((s) => byNumber.get(s.employeeNumber)?.department).filter(Boolean) as string[])].sort(),
    [summaries, byNumber]
  );
  const branches = useMemo(
    () => [...new Set(summaries.map((s) => byNumber.get(s.employeeNumber)?.branch).filter(Boolean) as string[])].sort(),
    [summaries, byNumber]
  );
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return summaries
      .filter((s) => {
        const p = byNumber.get(s.employeeNumber);
        return (!department || p?.department === department)
          && (!branch || p?.branch === branch)
          && (!q || s.employeeNumber.toLowerCase().includes(q) || (p?.fullName ?? '').toLowerCase().includes(q));
      })
      .sort((a, b) => (byNumber.get(a.employeeNumber)?.fullName ?? a.employeeNumber).localeCompare(byNumber.get(b.employeeNumber)?.fullName ?? b.employeeNumber));
  }, [summaries, byNumber, department, branch, search]);

  const nameOf = (emp: string) => byNumber.get(emp)?.fullName ?? emp;

  const exportCsv = () => {
    const keep = new Set(shown.map((s) => s.employeeNumber));
    const rows = days.filter((d) => keep.has(d.employeeNumber));
    if (rows.length === 0) return toast.error('Nothing to export');
    const csvPeople = new Map<string, CsvPerson>(
      [...keep].map((emp) => {
        const p = byNumber.get(emp);
        return [emp, { name: p?.fullName ?? '', department: p?.department ?? '', branch: p?.branch ?? '' }];
      })
    );
    downloadCsv(`Attendance-${range.from}-to-${range.to}.csv`, attendanceCsv(rows, csvPeople));
  };

  const openDays = openEmp ? days.filter((d) => d.employeeNumber === openEmp) : [];

  return (
    <div className="space-y-4">
      <Card padding="sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <div className="min-w-0">
            <label htmlFor="attendance-from" className={labelClass}>From</label>
            <input id="attendance-from" type="date" className={inputClass} value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
          </div>
          <div className="min-w-0">
            <label htmlFor="attendance-to" className={labelClass}>To</label>
            <input id="attendance-to" type="date" className={inputClass} value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          </div>
          <div className="min-w-0">
            <label htmlFor="attendance-department" className={labelClass}>Department</label>
            <select id="attendance-department" className={inputClass} value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label htmlFor="attendance-branch" className={labelClass}>Branch</label>
            <select id="attendance-branch" className={inputClass} value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">All branches</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people" aria-label="Search people" />
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Button variant="secondary" onClick={() => setRange(weekOf(nairobiToday()))}>This week</Button>
            <Button variant="secondary" icon={<Download size={14} />} onClick={exportCsv}>Export CSV</Button>
          </div>
        </div>
        {rangeProblem && <p role="alert" className="mt-2 text-[12px] text-status-danger">{rangeProblem}</p>}
      </Card>

      {!access.seesAll && <p className="text-[12px] text-muted-foreground">Showing you and the people who report to you.</p>}

      {shown.length === 0 ? (
        <Card>
          {loading ? <LoaderBlock label="Loading" compact /> : (
            <EmptyState icon={<CalendarClock size={20} />} title="No attendance" description="Nobody here has days in this range." />
          )}
        </Card>
      ) : (
        <Card padding="none">
          <TableScroll>
            <table className="w-full min-w-[680px]">
              <thead className="border-b border-border bg-secondary/50">
                <tr>
                  <th className={thClass}>Employee</th>
                  <th className={thClass}>Department</th>
                  <th className={thClass}>Present</th>
                  <th className={thClass}>Late</th>
                  <th className={thClass}>Absent</th>
                  <th className={thClass}>On leave</th>
                  <th className={thClass}>Hours</th>
                  <th className={thClass}><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => {
                  const p = byNumber.get(s.employeeNumber);
                  return (
                    <tr key={s.employeeNumber} className="border-b border-border last:border-0">
                      <td className={tdClass}>
                        <div className="font-semibold">{nameOf(s.employeeNumber)}</div>
                        <div className="text-[11px] text-muted-foreground">{[s.employeeNumber, p?.branch].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className={tdClass}>{p?.department || '—'}</td>
                      <td className={`${tdClass} tabular-nums`}>{s.present}</td>
                      <td className={`${tdClass} tabular-nums`}>{s.late ? <span className="font-semibold text-orange-text-alt">{s.late}</span> : 0}</td>
                      <td className={`${tdClass} tabular-nums`}>{s.absent ? <span className="font-semibold text-status-danger">{s.absent}</span> : 0}</td>
                      <td className={`${tdClass} tabular-nums`}>{s.leave}</td>
                      <td className={`${tdClass} tabular-nums`}>{formatHours(s.hours)}</td>
                      <td className={`${tdClass} text-right`}>
                        <Button variant="secondary" aria-label={`Open days for ${nameOf(s.employeeNumber)}`} onClick={() => setOpenEmp(s.employeeNumber)}>Days</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      <Modal open={!!openEmp} onClose={() => setOpenEmp(null)} title={openEmp ? `Attendance: ${nameOf(openEmp)}` : 'Attendance'} size="4xl">
        {openEmp && <EmployeeDays days={openDays} canCorrect={access.manages} onChanged={reload} />}
      </Modal>
    </div>
  );
}

/** One person's days, with HR's Correct on each. */
export function EmployeeDays({ days, canCorrect, onChanged }: {
  days: AttendanceDay[];
  canCorrect: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const today = nairobiToday();
  if (days.length === 0) return <p className="text-[13px] text-muted-foreground">No days in this range.</p>;
  const current = days.find((d) => d.day === editing) ?? null;
  return (
    <div className="space-y-3">
      <TableScroll>
        <table className="w-full min-w-[620px]">
          <thead className="border-b border-border">
            <tr>
              <th className={thClass}>Day</th>
              <th className={thClass}>Status</th>
              <th className={thClass}>Clock in</th>
              <th className={thClass}>Clock out</th>
              <th className={thClass}>Hours</th>
              {canCorrect && <th className={thClass}><span className="sr-only">Correct</span></th>}
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day} className="border-b border-border last:border-0">
                <td className={tdClass}>
                  <div className="font-semibold whitespace-nowrap">{dayLabel(d.day)}</div>
                  {d.note && <div className="text-[11px] text-muted-foreground whitespace-pre-wrap">{d.note}</div>}
                  {d.source === 'hr' && <div className="text-[11px] text-status-info font-semibold">Corrected by HR</div>}
                </td>
                <td className={tdClass}>
                  {d.status ? <StatusPill label={statusLabel(d.status)} tone={STATUS_TONE[d.status]} /> : <span className="text-[12px] text-muted-foreground">{statusLabel(null)}</span>}
                  {d.status === 'late' && d.lateMinutes ? <div className="text-[11px] text-muted-foreground">{d.lateMinutes} min</div> : null}
                </td>
                <td className={`${tdClass} tabular-nums`}>{formatTime(d.clockIn)}</td>
                <td className={`${tdClass} tabular-nums`}>{formatTime(d.clockOut)}</td>
                <td className={`${tdClass} tabular-nums`}>{formatHours(d.hours)}</td>
                {canCorrect && (
                  <td className={`${tdClass} text-right`}>
                    {d.day <= today && (
                      <Button variant="secondary" icon={<Pencil size={12} />} aria-label={`Correct ${dayLabel(d.day)}`} onClick={() => setEditing(d.day)}>
                        Correct
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      {current && canCorrect && (
        <CorrectDay
          key={current.day}
          day={current}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

/** HR sets one day's clock-in and clock-out, with a note saying why; or removes the day's record. */
export function CorrectDay({ day, onCancel, onSaved }: {
  day: AttendanceDay;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [inTime, setInTime] = useState(day.clockIn ? nairobiParts(day.clockIn).time : '');
  const [outTime, setOutTime] = useState(day.clockOut ? nairobiParts(day.clockOut).time : '');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const p = correctionProblem(inTime, outTime, note);
    if (p) return setProblem(p);
    setBusy(true);
    try {
      await setAttendanceDay(day.employeeNumber, day.day, nairobiToIso(day.day, inTime), outTime ? nairobiToIso(day.day, outTime) : null, note.trim());
      toast.success('Day corrected');
      await onSaved();
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await removeAttendanceDay(day.employeeNumber, day.day);
      toast.success("The day's record was removed");
      await onSaved();
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="sm" className="space-y-3">
      <div className="text-[13px] font-semibold text-ink">Correct {dayLabel(day.day)}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="min-w-0">
          <label htmlFor="correct-in" className={labelClass}>Clock in</label>
          <input id="correct-in" type="time" className={inputClass} value={inTime} onChange={(e) => setInTime(e.target.value)} />
        </div>
        <div className="min-w-0">
          <label htmlFor="correct-out" className={labelClass}>Clock out (leave empty if still at work)</label>
          <input id="correct-out" type="time" className={inputClass} value={outTime} onChange={(e) => setOutTime(e.target.value)} />
        </div>
      </div>
      <div className="min-w-0">
        <label htmlFor="correct-note" className={labelClass}>Note (why it is being corrected)</label>
        <textarea id="correct-note" rows={2} maxLength={500} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Forgot to clock in; arrived at 8:10 (confirmed by the supervisor)" />
      </div>
      {problem && <p role="alert" className="text-[12px] text-status-danger">{problem}</p>}
      <div className="flex flex-wrap gap-2 justify-end">
        {day.clockIn && (
          <Button variant="ghost" disabled={busy} onClick={remove}>Remove this day's record</Button>
        )}
        <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button disabled={busy} onClick={save}>Save</Button>
      </div>
    </Card>
  );
}
