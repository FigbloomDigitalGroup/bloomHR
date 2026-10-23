import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarClock, ChevronDown, ChevronRight, Download } from 'lucide-react';
import { Button, Card, EmptyState, SearchInput, StatusPill, TableScroll } from '../UI';
import { LoaderBlock } from '../UI/FigbloomLoader';
import { inputClass, labelClass, tdClass, thClass } from '../Perfomance/kpis/shared';
import {
  clockOutLabel,
  clockedInVia,
  dayHours,
  dayHoursLabel,
  dayLabel,
  formatTime,
  nairobiToday,
  placeText,
  type AttendanceDay,
  type CsvPerson,
} from '../../lib/attendance';
import {
  KIND_TONE,
  SORT_LABEL,
  TODAY_FILTERS,
  countByFilter,
  matchesFilter,
  nextSort,
  sortToday,
  todayCsv,
  todayKind,
  todayStatusLabel,
  type SortDir,
  type TodayFilter,
  type TodayRow,
  type TodaySortKey,
} from '../../lib/attendanceToday';
import { loadAttendanceDays, loadWebReasons, type AttendanceAccess } from '../../lib/attendanceApi';
import { loadEmployeeDirectory, type DirectoryEmployee } from '../../lib/employeeDirectory';
import { downloadCsv } from '../../lib/kpiApi';
import { DayScans } from './AttendanceDays';

/**
 * One day at a glance (FIG-1203): who arrived when, late, not in yet, on leave or off, sortable by any column, with
 * quick counts that filter, and each person's scans a click away. Today by default; any date works the same way.
 */
export default function AttendanceToday({ access }: { access: AttendanceAccess }) {
  const today = nairobiToday();
  const [date, setDate] = useState(today);
  const [days, setDays] = useState<AttendanceDay[]>([]);
  const [reasons, setReasons] = useState<Map<string, string>>(new Map());
  const [people, setPeople] = useState<DirectoryEmployee[]>([]);
  const [loading, setLoading] = useState(false);
  const [department, setDepartment] = useState('');
  const [branch, setBranch] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<TodayFilter | null>(null);
  const [sort, setSort] = useState<{ key: TodaySortKey; dir: SortDir }>({ key: 'arrival', dir: 'asc' });
  const [open, setOpen] = useState<string | null>(null);
  const isMobile = useNarrowScreen();

  useEffect(() => {
    loadEmployeeDirectory().then(setPeople).catch(() => setPeople([]));
  }, []);

  const reload = useCallback(async () => {
    if (!date) return;
    setLoading(true);
    setOpen(null);
    try {
      const [d, r] = await Promise.all([loadAttendanceDays(date, date), loadWebReasons(date)]);
      setDays(d);
      setReasons(r);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [date]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const byNumber = useMemo(() => new Map(people.map((p) => [p.employeeNumber, p])), [people]);
  const nameOf = useCallback((emp: string) => byNumber.get(emp)?.fullName || emp, [byNumber]);
  const departments = useMemo(
    () => [...new Set(days.map((d) => byNumber.get(d.employeeNumber)?.department).filter(Boolean) as string[])].sort(),
    [days, byNumber]
  );
  const branches = useMemo(
    () => [...new Set(days.map((d) => byNumber.get(d.employeeNumber)?.branch).filter(Boolean) as string[])].sort(),
    [days, byNumber]
  );

  // department, branch and search narrow everything, the counts included; a count then filters within that
  const narrowed = useMemo(() => {
    const q = search.trim().toLowerCase();
    return days.filter((d) => {
      const p = byNumber.get(d.employeeNumber);
      return (!department || p?.department === department)
        && (!branch || p?.branch === branch)
        && (!q || d.employeeNumber.toLowerCase().includes(q) || (p?.fullName ?? '').toLowerCase().includes(q));
    });
  }, [days, byNumber, department, branch, search]);
  const counts = useMemo(() => countByFilter(narrowed, today), [narrowed, today]);
  const rows = useMemo(() => {
    const list: TodayRow[] = narrowed
      .filter((d) => !filter || matchesFilter(d, filter, today))
      .map((d) => ({ day: d, name: nameOf(d.employeeNumber) }));
    return sortToday(list, sort.key, sort.dir, today);
  }, [narrowed, filter, today, sort, nameOf]);

  const exportCsv = () => {
    if (rows.length === 0) return toast.error('Nothing to export');
    const csvPeople = new Map<string, CsvPerson>(
      rows.map(({ day: d }) => {
        const p = byNumber.get(d.employeeNumber);
        return [d.employeeNumber, { name: p?.fullName ?? '', department: p?.department ?? '', branch: p?.branch ?? '' }];
      })
    );
    downloadCsv(`Attendance-${date}.csv`, todayCsv(rows, csvPeople, today, reasons));
  };

  const toggle = (emp: string) => setOpen((x) => (x === emp ? null : emp));
  const headerProps = { sort, onSort: (key: TodaySortKey) => setSort((s) => nextSort(s, key)) };
  const shownFilters = TODAY_FILTERS.filter((f) => f.id !== 'absent' || counts.absent > 0 || filter === 'absent');

  return (
    <div className="space-y-4">
      <Card padding="sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <div className="min-w-0">
            <label htmlFor="attendance-date" className={labelClass}>Date</label>
            <input id="attendance-date" type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="min-w-0">
            <label htmlFor="attendance-today-department" className={labelClass}>Department</label>
            <select id="attendance-today-department" className={inputClass} value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label htmlFor="attendance-today-branch" className={labelClass}>Branch</label>
            <select id="attendance-today-branch" className={inputClass} value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">All branches</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label htmlFor="attendance-today-sort" className={labelClass}>Sort by</label>
            <select
              id="attendance-today-sort"
              className={inputClass}
              value={`${sort.key}:${sort.dir}`}
              onChange={(e) => {
                const [key, dir] = e.target.value.split(':') as [TodaySortKey, SortDir];
                setSort({ key, dir });
              }}
            >
              {(Object.keys(SORT_LABEL) as TodaySortKey[]).flatMap((k) => [
                <option key={`${k}:asc`} value={`${k}:asc`}>{SORT_LABEL[k]}{sortWords(k, 'asc')}</option>,
                <option key={`${k}:desc`} value={`${k}:desc`}>{SORT_LABEL[k]}{sortWords(k, 'desc')}</option>,
              ])}
            </select>
          </div>
          <div className="min-w-0">
            <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people" aria-label="Search people" />
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {date !== today && <Button variant="secondary" onClick={() => setDate(today)}>Back to today</Button>}
            <Button variant="secondary" icon={<Download size={14} />} onClick={exportCsv}>Export CSV</Button>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Quick counts: choose one to filter">
        {shownFilters.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter((x) => (x === f.id ? null : f.id))}
              className={`inline-flex items-center gap-2 rounded-pill border px-3 py-1.5 text-[12.5px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                active ? 'border-brand bg-brand text-white' : 'border-border bg-card text-ink hover:border-brand'
              }`}
            >
              <span>{f.label}</span>
              <span className={`tabular-nums ${active ? 'text-white' : 'text-muted-foreground'}`}>{counts[f.id]}</span>
            </button>
          );
        })}
        {filter && (
          <button type="button" className="text-[12px] font-semibold text-brand hover:underline px-1" onClick={() => setFilter(null)}>
            Show everyone
          </button>
        )}
      </div>

      {!access.seesAll && <p className="text-[12px] text-muted-foreground">Showing you and the people who report to you.</p>}

      {rows.length === 0 ? (
        <Card>
          {loading ? <LoaderBlock label="Loading" compact /> : (
            <EmptyState
              icon={<CalendarClock size={20} />}
              title={filter ? 'Nobody here' : 'No attendance'}
              description={filter ? 'Nobody matches this count. Choose it again to show everyone.' : `Nobody here has a day on ${dayLabel(date)}.`}
            />
          )}
        </Card>
      ) : isMobile ? (
        <ul className="space-y-2" aria-label={`Attendance on ${dayLabel(date)}`}>
          {rows.map(({ day: d, name }) => {
            const p = byNumber.get(d.employeeNumber);
            const expanded = open === d.employeeNumber;
            return (
              <li key={d.employeeNumber}>
                <Card padding="sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-ink truncate">{name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{[d.employeeNumber, p?.department].filter(Boolean).join(' · ')}</div>
                    </div>
                    <StatusPill label={todayStatusLabel(d, today)} tone={KIND_TONE[todayKind(d, today)]} />
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
                    <div><dt className="text-muted-foreground text-[11px]">In</dt><dd className="tabular-nums">{formatTime(d.clockIn)}</dd></div>
                    <div><dt className="text-muted-foreground text-[11px]">Out</dt><dd className="tabular-nums">{clockOutLabel(d, today)}</dd></div>
                    <div><dt className="text-muted-foreground text-[11px]">Hours</dt><dd className="tabular-nums">{dayHoursLabel(d, today)}</dd></div>
                  </dl>
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <Via day={d} reason={reasons.get(d.employeeNumber)} />
                    <button
                      type="button"
                      className="shrink-0 text-[12px] font-semibold text-brand hover:underline"
                      aria-expanded={expanded}
                      aria-label={`${expanded ? 'Hide' : 'Show'} scans for ${name}`}
                      onClick={() => toggle(d.employeeNumber)}
                    >
                      {expanded ? 'Hide scans' : 'Scans'}
                    </button>
                  </div>
                  {expanded && (
                    <div className="mt-2 border-t border-border pt-2">
                      <DayDetail day={d} />
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      ) : (
        <Card padding="none">
          <TableScroll>
            <table className="w-full min-w-[760px]" aria-label={`Attendance on ${dayLabel(date)}`}>
              <thead className="border-b border-border bg-secondary/50">
                <tr>
                  <SortHeader label="Employee" sortKey="name" {...headerProps} />
                  <SortHeader label="Status" sortKey="status" {...headerProps} />
                  <SortHeader label="In" sortKey="arrival" {...headerProps} />
                  <th className={thClass}>Out</th>
                  <SortHeader label="Hours" sortKey="hours" {...headerProps} />
                  <th className={thClass}>Via</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ day: d, name }) => {
                  const p = byNumber.get(d.employeeNumber);
                  const expanded = open === d.employeeNumber;
                  const kind = todayKind(d, today);
                  return (
                    <Fragment key={d.employeeNumber}>
                      <tr
                        className={`border-b border-border cursor-pointer hover:bg-secondary/40 ${expanded ? 'bg-secondary/30' : 'last:border-0'}`}
                        onClick={() => toggle(d.employeeNumber)}
                      >
                        <td className={tdClass}>
                          <button
                            type="button"
                            className="flex items-start gap-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
                            aria-expanded={expanded}
                            aria-label={`${expanded ? 'Hide' : 'Show'} scans for ${name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle(d.employeeNumber);
                            }}
                          >
                            {expanded ? <ChevronDown size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> : <ChevronRight size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
                            <span className="min-w-0">
                              <span className="block font-semibold">{name}</span>
                              <span className="block text-[11px] text-muted-foreground">{[d.employeeNumber, p?.department].filter(Boolean).join(' · ')}</span>
                            </span>
                          </button>
                        </td>
                        <td className={tdClass}>
                          {kind === 'not_in' || kind === 'not_yet' || kind === 'not_counted'
                            ? <span className="text-[12px] text-muted-foreground">{todayStatusLabel(d, today)}</span>
                            : <StatusPill label={todayStatusLabel(d, today)} tone={KIND_TONE[kind]} />}
                          {d.flag && <div className="mt-1 text-[11px] text-status-danger">{d.flag}</div>}
                        </td>
                        <td className={`${tdClass} tabular-nums`}>{formatTime(d.clockIn)}</td>
                        <td className={`${tdClass} tabular-nums`}>{clockOutLabel(d, today)}</td>
                        <td className={`${tdClass} tabular-nums`}>
                          <span className={dayHours(d, today).open === 'missing' ? 'text-status-danger font-semibold' : ''}>{dayHoursLabel(d, today)}</span>
                        </td>
                        <td className={tdClass}><Via day={d} reason={reasons.get(d.employeeNumber)} /></td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-border last:border-0 bg-secondary/30">
                          <td className={tdClass} colSpan={6}>
                            <DayDetail day={d} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}
    </div>
  );
}

/** Phone width (under 768px): the rows become stacked cards. Wide when the browser can't tell. */
function useNarrowScreen() {
  const query = '(max-width: 767px)';
  const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [narrow, setNarrow] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setNarrow(mql.matches);
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);
  return narrow;
}

const sortWords = (key: TodaySortKey, dir: SortDir) => {
  if (key === 'name') return dir === 'asc' ? ' (A to Z)' : ' (Z to A)';
  if (key === 'arrival') return dir === 'asc' ? ' (earliest first)' : ' (latest first)';
  if (key === 'status') return dir === 'asc' ? ' (on time first)' : ' (off first)';
  return dir === 'asc' ? ' (fewest first)' : ' (most first)';
};

/** A column header that sorts: a button, with aria-sort on the header cell. */
function SortHeader({ label, sortKey, sort, onSort }: {
  label: string;
  sortKey: TodaySortKey;
  sort: { key: TodaySortKey; dir: SortDir };
  onSort: (key: TodaySortKey) => void;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={thClass} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${active ? 'text-ink' : ''}`}
      >
        {label}
        <Icon size={12} aria-hidden="true" className={active ? '' : 'opacity-50'} />
      </button>
    </th>
  );
}

/** How the day's clock-in was made ("Scanner", "App · remote" ...) and, when they used the app, why. */
function Via({ day, reason }: { day: AttendanceDay; reason?: string }) {
  const via = clockedInVia(day);
  const detail = placeText(day);
  if (!via && !reason) return <span className="text-[12px] text-muted-foreground">—</span>;
  return (
    <div className="text-[12px] min-w-0">
      {via && <div>{via}{detail ? <span className="text-muted-foreground"> · {detail}</span> : null}</div>}
      {reason && <div className="text-[11px] text-muted-foreground break-words">“{reason}”</div>}
    </div>
  );
}

/** The opened row: the day's note and every scan, without the full Days dialog. */
function DayDetail({ day }: { day: AttendanceDay }) {
  return (
    <div className="space-y-1.5">
      {day.note && <div className="text-[11px] text-muted-foreground whitespace-pre-wrap">{day.note}</div>}
      {day.source === 'hr' && <div className="text-[11px] text-status-info font-semibold">Corrected by HR</div>}
      <DayScans employeeNumber={day.employeeNumber} day={day.day} place={day.source === 'app' ? day.place : null} />
    </div>
  );
}
