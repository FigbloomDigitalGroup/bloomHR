import { useEffect, useMemo, useState } from 'react';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  format,
  addMonths,
  subMonths,
} from 'date-fns';
import { Cake, PartyPopper, CalendarPlus, ChevronLeft, ChevronRight, X, Trash2, Plane, ListTodo, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { fetchAllResult } from '../../lib/fetchAll';
import { PageHeader, Card, Button, Modal } from '../UI';
import { birthdayMonthDay, toDay } from '../../lib/celebrations';
import {
  comingUp, dayKey, holidayDates, holidaysForCountry, myLeaveRanges, myOpenTasks, startOfDay, withCountryTags,
  type CalendarEntry, type HolidayRow, type LeaveRow, type TaskRow, type UpcomingKind,
} from '../../lib/upcoming';
import { currentEmployeeNumber, loadMyLeave, loadMyTasks, myHolidayCountry } from '../../lib/upcomingApi';
import ComingUpList, { type RangeChoice } from './ComingUpList';

import { confirmDialog } from '../../lib/confirmDialog';
interface BirthdayEntry {
  name: string;
  town?: string;
}

interface CompanyEvent {
  id: string;
  title: string;
  date: string;
  description: string | null;
}

interface LeaveEntry {
  type: string;
  status: 'approved' | 'pending';
}

interface DueTask {
  id: string;
  title: string;
  key?: string | null;
  overdue: boolean;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// a leave longer than this is drawn only for its first year (a typo in the end date would otherwise fill the calendar)
const MAX_LEAVE_DAYS = 366;

const KIND_FILTERS: { kind: UpcomingKind; label: string; dot: string }[] = [
  { kind: 'event', label: 'Events', dot: 'bg-status-purple' },
  { kind: 'holiday', label: 'Holidays', dot: 'bg-orange-text' },
  { kind: 'birthday', label: 'Birthdays', dot: 'bg-brand' },
  { kind: 'leave', label: 'My leave', dot: 'bg-status-info' },
  { kind: 'task', label: 'My tasks', dot: 'bg-amber-500' },
];

interface CompanyCalendarProps {
  /** the staff portal: nothing can be added or removed, and birthdays do not link to the employee list */
  readOnly?: boolean;
  /** also show this employee's own approved and pending leave (the staff portal passes the signed-in employee's) */
  myEmployeeNumber?: string | null;
  /** opens one of the viewer's tasks (the staff portal's Tasks); without it, the admin Tasks page opens */
  onOpenTask?: (taskId: string) => void;
}

const leaveLabel = (l: LeaveEntry) => `My ${l.type}${l.status === 'pending' ? ' (pending)' : ''}`;
const taskLabel = (t: DueTask) => `${t.overdue ? 'Overdue: ' : 'Due: '}${t.title}`;

export default function CompanyCalendar({ readOnly = false, myEmployeeNumber = null, onOpenTask }: CompanyCalendarProps = {}) {
  const navigate = useNavigate();
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [birthdaysByDay, setBirthdaysByDay] = useState<Map<string, BirthdayEntry[]>>(new Map());
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [events, setEvents] = useState<CompanyEvent[]>([]);
  const [myLeave, setMyLeave] = useState<LeaveRow[]>([]);
  const [myTasks, setMyTasks] = useState<TaskRow[]>([]);
  // whose tasks are shown: the staff portal's employee, or the signed-in admin's own employee record
  const [taskOwner, setTaskOwner] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // which kinds of entry are shown, on the grid and in "Coming up"
  const [shown, setShown] = useState<Record<UpcomingKind, boolean>>({ event: true, holiday: true, birthday: true, leave: true, task: true });
  const [range, setRange] = useState<RangeChoice>(90);
  // the day tapped on the phone layout (whose entries are listed under the grid), or picked in "Coming up"
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [showEventForm, setShowEventForm] = useState(false);
  const [savingEvent, setSavingEvent] = useState(false);
  const [newEvent, setNewEvent] = useState({ title: '', date: format(new Date(), 'yyyy-MM-dd'), description: '' });

  const loadCalendarData = async () => {
    setLoading(true);
    try {
      const [{ data: employees }, { data: holidayRows }, { data: eventRows }] = await Promise.all([
        // every employee, a page at a time (one request is capped at 1000 rows)
        fetchAllResult((from, to) =>
          supabase.from('employee_directory').select('"First Name", "Last Name", birthday, Town').order('"Employee Number"').range(from, to)
        ),
        supabase.from('holidays').select('name, date, recurring, country'),
        supabase.from('company_events').select('id, title, date, description').order('date'),
      ]);

      const bdayMap = new Map<string, BirthdayEntry[]>();
      (employees || []).forEach((emp) => {
        // 'MM-DD' only: colleagues never get the year
        const born = birthdayMonthDay(emp.birthday);
        if (!born) return;
        // Key by month-day only, so a birthday shows every year it's viewed
        const key = `${born.month}-${born.day}`;
        const entry: BirthdayEntry = {
          name: `${emp['First Name'] || ''} ${emp['Last Name'] || ''}`.trim(),
          town: emp.Town || undefined,
        };
        bdayMap.set(key, [...(bdayMap.get(key) || []), entry]);
      });
      setBirthdaysByDay(bdayMap);
      // staff see their own country's holidays (FIG-905); people who run the company see every country's, tagged
      const allHolidays = (holidayRows || []) as HolidayRow[];
      setHolidays(readOnly ? holidaysForCountry(allHolidays, await myHolidayCountry()) : withCountryTags(allHolidays));
      setEvents((eventRows || []) as CompanyEvent[]);

      if (myEmployeeNumber) {
        try {
          setMyLeave(await loadMyLeave(myEmployeeNumber));
        } catch (err) {
          console.error('Error loading your leave for the calendar:', err);
        }
      }

      // the viewer's own tasks with a due date (an admin's own, from their employee record, if they have one)
      try {
        const owner = myEmployeeNumber || (readOnly ? null : await currentEmployeeNumber());
        setTaskOwner(owner);
        setMyTasks(owner ? await loadMyTasks(owner) : []);
      } catch (err) {
        console.error('Error loading your tasks for the calendar:', err);
      }
    } catch (err) {
      console.error('Error loading company calendar data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCalendarData();
    // reloads when the employee is known (the staff portal finds them after the first render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myEmployeeNumber]);

  const gridDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth));
    const end = endOfWeek(endOfMonth(currentMonth));
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  // the weeks on screen, by day ("yyyy-MM-dd"): recurring holidays by month and day, one-off ones on their date
  const holidaysByDay = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const h of holidayDates(holidays, gridDays[0], gridDays[gridDays.length - 1])) {
      const key = dayKey(h.date);
      map.set(key, [...(map.get(key) || []), h.name]);
    }
    return map;
  }, [holidays, gridDays]);
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CompanyEvent[]>();
    for (const e of events) {
      const day = toDay(e.date);
      if (!day) continue;
      const key = dayKey(day);
      map.set(key, [...(map.get(key) || []), e]);
    }
    return map;
  }, [events]);
  const myLeaveByDay = useMemo(() => {
    const map = new Map<string, LeaveEntry[]>();
    for (const l of myLeaveRanges(myLeave)) {
      const entry: LeaveEntry = { type: l.type, status: l.pending ? 'pending' : 'approved' };
      const day = new Date(l.start);
      for (let i = 0; day <= l.end && i < MAX_LEAVE_DAYS; i++, day.setDate(day.getDate() + 1)) {
        const key = dayKey(day);
        map.set(key, [...(map.get(key) || []), entry]);
      }
    }
    return map;
  }, [myLeave]);
  const tasksByDay = useMemo(() => {
    const map = new Map<string, DueTask[]>();
    const today = startOfDay(new Date());
    for (const t of myOpenTasks(myTasks, taskOwner)) {
      const key = dayKey(t.due);
      map.set(key, [...(map.get(key) || []), { id: t.id, title: t.title, key: t.key, overdue: t.due < today }]);
    }
    return map;
  }, [myTasks, taskOwner]);

  const getBirthdaysFor = (day: Date) => {
    if (!shown.birthday) return [];
    const on = birthdaysByDay.get(`${day.getMonth()}-${day.getDate()}`) || [];
    // 29 February birthdays are shown on the 28th in years without one
    const isLeap = new Date(day.getFullYear(), 1, 29).getMonth() === 1;
    return day.getMonth() === 1 && day.getDate() === 28 && !isLeap ? [...on, ...(birthdaysByDay.get('1-29') || [])] : on;
  };
  const getHolidaysFor = (day: Date) => (shown.holiday ? holidaysByDay.get(dayKey(day)) || [] : []);
  const getEventsFor = (day: Date) => (shown.event ? eventsByDay.get(dayKey(day)) || [] : []);
  const getLeaveFor = (day: Date) => (shown.leave ? myLeaveByDay.get(dayKey(day)) || [] : []);
  const getTasksFor = (day: Date) => (shown.task ? tasksByDay.get(dayKey(day)) || [] : []);
  const hasEntries = (day: Date) =>
    getEventsFor(day).length > 0 || getHolidaysFor(day).length > 0 || getBirthdaysFor(day).length > 0 || getLeaveFor(day).length > 0 || getTasksFor(day).length > 0;
  // the days listed under the grid on phones
  const phoneListDays = selectedDay
    ? (hasEntries(selectedDay) ? [selectedDay] : [])
    : gridDays.filter((day) => isSameMonth(day, currentMonth) && hasEntries(day));

  const upcoming = useMemo(
    () => comingUp({ events, holidays, leave: myLeave, tasks: myTasks, employeeNumber: taskOwner }, new Date(), range).filter((i) => shown[i.kind]),
    [events, holidays, myLeave, myTasks, taskOwner, range, shown]
  );

  const openTask = (taskId: string) => {
    if (onOpenTask) onOpenTask(taskId);
    else navigate(`/tasks?task=${encodeURIComponent(taskId)}`);
  };
  // a "Coming up" row: the calendar moves to its month and marks the day (a leave already under way: today)
  const pick = (entry: CalendarEntry) => {
    const day = startOfDay(entry.kind === 'leave' && entry.daysAway < 0 ? new Date() : entry.date);
    setCurrentMonth(startOfMonth(day));
    setSelectedDay(day);
  };
  const filterKinds = KIND_FILTERS.filter((f) => (f.kind === 'leave' ? !!myEmployeeNumber : f.kind === 'task' ? !!taskOwner : true));

  const handleAddEvent = async () => {
    if (!newEvent.title.trim() || !newEvent.date) {
      toast.error('Please give the event a title and date');
      return;
    }
    setSavingEvent(true);
    try {
      const { error } = await supabase.from('company_events').insert([{
        title: newEvent.title.trim(),
        date: newEvent.date,
        description: newEvent.description.trim() || null,
      }]);
      if (error) throw error;
      toast.success('Event added');
      setShowEventForm(false);
      setNewEvent({ title: '', date: format(new Date(), 'yyyy-MM-dd'), description: '' });
      await loadCalendarData();
    } catch (err) {
      console.error('Error adding event:', err);
      toast.error('Failed to add event');
    } finally {
      setSavingEvent(false);
    }
  };

  const handleDeleteEvent = async (event: CompanyEvent) => {
    if (!(await confirmDialog({ title: `Remove “${event.title}” from the calendar?`, confirmLabel: 'Remove', tone: 'danger' }))) return;
    try {
      const { error } = await supabase.from('company_events').delete().eq('id', event.id);
      if (error) throw error;
      toast.success('Event removed');
      await loadCalendarData();
    } catch (err) {
      console.error('Error deleting event:', err);
      toast.error('Failed to remove event');
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Company Calendar"
        subtitle={myEmployeeNumber ? 'Holidays, company events, birthdays, your leave and your tasks' : 'Birthdays, holidays and company events'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => { setCurrentMonth((m) => subMonths(m, 1)); setSelectedDay(null); }} icon={<ChevronLeft className="w-3.5 h-3.5" />}>
              Prev
            </Button>
            <span className="text-[13px] font-bold text-ink w-32 text-center">{format(currentMonth, 'MMMM yyyy')}</span>
            <Button variant="secondary" onClick={() => { setCurrentMonth((m) => addMonths(m, 1)); setSelectedDay(null); }} icon={<ChevronRight className="w-3.5 h-3.5" />}>
              Next
            </Button>
            {!readOnly && (
              <Button variant="primary" onClick={() => setShowEventForm(true)} icon={<CalendarPlus className="w-3.5 h-3.5" />}>
                New Event
              </Button>
            )}
          </div>
        }
      />

      {/* show or hide each kind of entry */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3" role="group" aria-label="Show on the calendar" data-testid="calendar-filters">
        {filterKinds.map((f) => (
          <button
            key={f.kind}
            type="button"
            aria-pressed={shown[f.kind]}
            onClick={() => setShown((s) => ({ ...s, [f.kind]: !s[f.kind] }))}
            className={`inline-flex items-center gap-1.5 text-[11.5px] font-semibold rounded-full border px-2.5 py-1 transition-colors ${
              shown[f.kind] ? 'bg-white text-ink border-border' : 'bg-secondary text-subtle border-transparent line-through'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${shown[f.kind] ? f.dot : 'bg-subtle/50'}`} aria-hidden />
            {f.label}
          </button>
        ))}
      </div>

      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-4 xl:items-start">
      <div className="min-w-0">
      <Card padding="none" className="overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border bg-secondary">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="px-0.5 sm:px-2 py-2 text-[10.5px] font-semibold text-muted-foreground text-center uppercase tracking-wide">
              <span className="sm:hidden">{label.charAt(0)}</span>
              <span className="hidden sm:inline">{label}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {gridDays.map((day) => {
            const inMonth = isSameMonth(day, currentMonth);
            const birthdays = getBirthdaysFor(day);
            const holidayNames = getHolidaysFor(day);
            const dayEvents = getEventsFor(day);
            const leave = getLeaveFor(day);
            const tasks = getTasksFor(day);
            const isSelected = selectedDay !== null && isSameDay(day, selectedDay);
            const dayNumberClass = `text-[11px] font-semibold w-5 h-5 items-center justify-center rounded-full ${
              isToday(day) ? 'bg-brand text-white' : inMonth ? 'text-ink' : 'text-subtle'
            }`;
            return (
              <div
                key={day.toISOString()}
                data-day={dayKey(day)}
                data-selected={isSelected || undefined}
                className={`min-h-[52px] sm:min-h-[104px] border-b border-r border-border p-0.5 sm:p-1.5 last:border-r-0 ${inMonth ? 'bg-white' : 'bg-secondary/40'} ${isSelected ? 'sm:ring-2 sm:ring-inset sm:ring-brand sm:bg-green-tint/30' : ''}`}
              >
                {/* Phones: the columns are too narrow for event labels, so show the day and a dot per kind
                    of entry, and list the tapped day's entries under the grid */}
                <button
                  type="button"
                  onClick={() => setSelectedDay(isSelected ? null : day)}
                  aria-pressed={isSelected}
                  aria-label={format(day, 'd MMMM yyyy')}
                  className={`sm:hidden w-full h-full min-h-[44px] flex flex-col items-center gap-1 rounded ${isSelected ? 'ring-2 ring-brand' : ''}`}
                >
                  <span className={`flex ${dayNumberClass}`}>{format(day, 'd')}</span>
                  <span className="flex items-center gap-0.5" aria-hidden>
                    {dayEvents.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-status-purple" />}
                    {holidayNames.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-orange-text" />}
                    {birthdays.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-brand" />}
                    {leave.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-status-info" />}
                    {tasks.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
                  </span>
                </button>
                <div className={`hidden sm:flex ${dayNumberClass}`}>
                  {format(day, 'd')}
                </div>
                <div className="mt-1 space-y-1 hidden sm:block">
                  {leave.map((l, i) => (
                    <div key={`l-${i}`} className={`flex items-center gap-1 text-[10px] font-medium text-status-info bg-status-info-tint rounded px-1 py-0.5 truncate ${l.status === 'pending' ? 'border border-dashed border-status-info/50' : ''}`} title={leaveLabel(l)}>
                      <Plane className="w-2.5 h-2.5 flex-shrink-0" />
                      <span className="truncate">{leaveLabel(l)}</span>
                    </div>
                  ))}
                  {tasks.map((t) => (
                    <button
                      key={`t-${t.id}`}
                      type="button"
                      onClick={() => openTask(t.id)}
                      className={`flex items-center gap-1 text-[10px] font-medium rounded px-1 py-0.5 w-full truncate transition-colors ${t.overdue ? 'text-status-danger bg-red-50 hover:bg-red-100' : 'text-amber-800 bg-amber-50 hover:bg-amber-100'}`}
                      title={`${taskLabel(t)}${t.key ? ` (${t.key})` : ''}: open in Tasks`}
                    >
                      {t.overdue ? <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0" /> : <ListTodo className="w-2.5 h-2.5 flex-shrink-0" />}
                      <span className="truncate">{t.title}</span>
                    </button>
                  ))}
                  {readOnly && dayEvents.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center gap-1 text-[10px] font-medium text-status-purple bg-status-purple-tint rounded px-1 py-0.5 truncate"
                      title={`${e.title}${e.description ? ` — ${e.description}` : ''}`}
                    >
                      <CalendarPlus className="w-2.5 h-2.5 flex-shrink-0" />
                      <span className="truncate">{e.title}</span>
                    </div>
                  ))}
                  {!readOnly && dayEvents.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => handleDeleteEvent(e)}
                      className="group flex items-center gap-1 text-[10px] font-medium text-status-purple bg-status-purple-tint hover:bg-status-purple-tint/70 rounded px-1 py-0.5 w-full truncate transition-colors"
                      title={`${e.title}${e.description ? ` — ${e.description}` : ''} (click to remove)`}
                    >
                      <CalendarPlus className="w-2.5 h-2.5 flex-shrink-0 group-hover:hidden" />
                      <Trash2 className="w-2.5 h-2.5 flex-shrink-0 hidden group-hover:block" />
                      <span className="truncate">{e.title}</span>
                    </button>
                  ))}
                  {holidayNames.map((name, i) => (
                    <div key={`h-${i}`} className="flex items-center gap-1 text-[10px] font-medium text-orange-text bg-orange-tint rounded px-1 py-0.5 truncate" title={`${name}: public holiday, office closed`}>
                      <PartyPopper className="w-2.5 h-2.5 flex-shrink-0" />
                      <span className="truncate">{name}</span>
                    </div>
                  ))}
                  {readOnly && birthdays.slice(0, 2).map((b, i) => (
                    <div key={`b-${i}`} className="flex items-center gap-1 text-[10px] font-medium text-brand bg-green-tint rounded px-1 py-0.5 truncate" title={`${b.name}: birthday`}>
                      <Cake className="w-2.5 h-2.5 flex-shrink-0" />
                      <span className="truncate">{b.name}</span>
                    </div>
                  ))}
                  {!readOnly && birthdays.slice(0, 2).map((b, i) => (
                    <button
                      key={`b-${i}`}
                      type="button"
                      onClick={() => navigate(`/employees?q=${encodeURIComponent(b.name)}`)}
                      className="flex items-center gap-1 text-[10px] font-medium text-brand bg-green-tint hover:bg-green-tint/70 rounded px-1 py-0.5 w-full truncate transition-colors"
                      title={`View ${b.name} in Employees`}
                    >
                      <Cake className="w-2.5 h-2.5 flex-shrink-0" />
                      <span className="truncate">{b.name}</span>
                    </button>
                  ))}
                  {birthdays.length > 2 && (
                    <div className="text-[10px] text-muted-foreground px-1">+{birthdays.length - 2} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Phones: the entries for the tapped day, or for the whole month when no day is picked */}
      <div className="sm:hidden mt-4" data-testid="calendar-phone-list">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="text-[13px] font-bold text-ink">
            {selectedDay ? format(selectedDay, 'EEEE d MMMM') : `This month`}
          </h2>
          {selectedDay && (
            <button type="button" onClick={() => setSelectedDay(null)} className="text-[12px] font-semibold text-brand">
              Show whole month
            </button>
          )}
        </div>
        {phoneListDays.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            {selectedDay ? 'Nothing on this day.' : 'Nothing on the calendar this month.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {phoneListDays.map((day) => (
              <li key={day.toISOString()} className="bg-white border border-border rounded-card p-3">
                {!selectedDay && <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">{format(day, 'EEE d MMM')}</p>}
                <div className="space-y-1.5">
                  {getLeaveFor(day).map((l, i) => (
                    <div key={`l-${i}`} className="flex items-start gap-1.5 text-[12px] font-medium text-status-info bg-status-info-tint rounded px-2 py-1">
                      <Plane className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      <span className="min-w-0 break-words">{leaveLabel(l)}</span>
                    </div>
                  ))}
                  {getTasksFor(day).map((t) => (
                    <button
                      key={`t-${t.id}`}
                      type="button"
                      onClick={() => openTask(t.id)}
                      className={`flex items-start gap-1.5 text-left text-[12px] font-medium rounded px-2 py-1 w-full ${t.overdue ? 'text-status-danger bg-red-50' : 'text-amber-800 bg-amber-50'}`}
                      title="Open in Tasks"
                    >
                      {t.overdue ? <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> : <ListTodo className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />}
                      <span className="min-w-0 break-words">{taskLabel(t)}</span>
                    </button>
                  ))}
                  {getEventsFor(day).map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={readOnly ? undefined : () => handleDeleteEvent(e)}
                      disabled={readOnly}
                      className="flex items-start gap-1.5 text-left text-[12px] font-medium text-status-purple bg-status-purple-tint rounded px-2 py-1 w-full disabled:cursor-default"
                      title={readOnly ? undefined : 'Tap to remove'}
                    >
                      <CalendarPlus className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      <span className="min-w-0 break-words">
                        {e.title}
                        {e.description && <span className="block text-[11px] font-normal opacity-80">{e.description}</span>}
                      </span>
                    </button>
                  ))}
                  {getHolidaysFor(day).map((name, i) => (
                    <div key={`h-${i}`} className="flex items-start gap-1.5 text-[12px] font-medium text-orange-text bg-orange-tint rounded px-2 py-1">
                      <PartyPopper className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      <span className="min-w-0 break-words">{name}</span>
                    </div>
                  ))}
                  {getBirthdaysFor(day).map((b, i) => (
                    <button
                      key={`b-${i}`}
                      type="button"
                      onClick={readOnly ? undefined : () => navigate(`/employees?q=${encodeURIComponent(b.name)}`)}
                      disabled={readOnly}
                      className="flex items-start gap-1.5 text-left text-[12px] font-medium text-brand bg-green-tint rounded px-2 py-1 w-full disabled:cursor-default"
                    >
                      <Cake className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      <span className="min-w-0 break-words">{b.name}</span>
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>

      {/* what is coming up: beside the grid on wide screens, under it otherwise */}
      <div className="mt-4 xl:mt-0">
        <ComingUpList items={upcoming} range={range} onRangeChange={setRange} onPick={pick} onOpenTask={taskOwner ? openTask : undefined} loading={loading} />
      </div>
      </div>

      {!loading && birthdaysByDay.size === 0 && holidays.length === 0 && events.length === 0 && myLeave.length === 0 && (
        <p className="text-[11.5px] text-muted-foreground text-center mt-4">No birthdays, holidays or events on record yet.</p>
      )}

      <Modal
        open={!readOnly && showEventForm}
        onClose={() => setShowEventForm(false)}
        closeOnBackdrop={!savingEvent}
        title="New Company Event"
        hideTitle
        size="sm"
        className="bg-white border border-border rounded-card p-[18px]"
      >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[14px] font-bold text-ink">New Company Event</h2>
              <button type="button" onClick={() => setShowEventForm(false)} className="text-subtle hover:text-ink transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Title</label>
                <input
                  type="text"
                  value={newEvent.title}
                  onChange={(e) => setNewEvent((prev) => ({ ...prev, title: e.target.value }))}
                  placeholder="e.g. All-hands town hall"
                  className="w-full box-border rounded-tile border border-border px-3 py-2 text-xs text-ink outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Date</label>
                <input
                  type="date"
                  value={newEvent.date}
                  onChange={(e) => setNewEvent((prev) => ({ ...prev, date: e.target.value }))}
                  className="w-full box-border rounded-tile border border-border px-3 py-2 text-xs text-ink outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground block mb-1">Description (optional)</label>
                <textarea
                  value={newEvent.description}
                  onChange={(e) => setNewEvent((prev) => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  className="w-full box-border rounded-tile border border-border px-3 py-2 text-xs text-ink outline-none focus:border-brand resize-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <Button variant="secondary" onClick={() => setShowEventForm(false)} disabled={savingEvent}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleAddEvent} disabled={savingEvent}>
                {savingEvent ? 'Saving...' : 'Add Event'}
              </Button>
            </div>
      </Modal>
    </div>
  );
}
