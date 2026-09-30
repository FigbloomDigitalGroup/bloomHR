import { useEffect, useMemo, useState } from 'react';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  format,
  addMonths,
  subMonths,
} from 'date-fns';
import { Cake, PartyPopper, CalendarPlus, ChevronLeft, ChevronRight, X, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { PageHeader, Card, Button } from '../UI';

interface BirthdayEntry {
  name: string;
  town?: string;
}

interface HolidayEntry {
  name: string;
  recurring: boolean;
}

interface CompanyEvent {
  id: string;
  title: string;
  date: string;
  description: string | null;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CompanyCalendar() {
  const navigate = useNavigate();
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [birthdaysByDay, setBirthdaysByDay] = useState<Map<string, BirthdayEntry[]>>(new Map());
  const [holidaysByDay, setHolidaysByDay] = useState<Map<string, HolidayEntry[]>>(new Map());
  const [eventsByDay, setEventsByDay] = useState<Map<string, CompanyEvent[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showEventForm, setShowEventForm] = useState(false);
  const [savingEvent, setSavingEvent] = useState(false);
  const [newEvent, setNewEvent] = useState({ title: '', date: format(new Date(), 'yyyy-MM-dd'), description: '' });

  const loadCalendarData = async () => {
    setLoading(true);
    try {
      const [{ data: employees }, { data: holidays }, { data: events }] = await Promise.all([
        supabase.from('employees').select('"First Name", "Last Name", "Date of Birth", Town'),
        supabase.from('holidays').select('name, date, recurring'),
        supabase.from('company_events').select('id, title, date, description').order('date'),
      ]);

      const bdayMap = new Map<string, BirthdayEntry[]>();
      (employees || []).forEach((emp) => {
        if (!emp['Date of Birth']) return;
        const birthDate = new Date(emp['Date of Birth']);
        if (isNaN(birthDate.getTime())) return;
        // Key by month-day only, so a birthday shows every year it's viewed
        const key = `${birthDate.getMonth()}-${birthDate.getDate()}`;
        const entry: BirthdayEntry = {
          name: `${emp['First Name'] || ''} ${emp['Last Name'] || ''}`.trim(),
          town: emp.Town || undefined,
        };
        bdayMap.set(key, [...(bdayMap.get(key) || []), entry]);
      });
      setBirthdaysByDay(bdayMap);

      const holMap = new Map<string, HolidayEntry[]>();
      (holidays || []).forEach((h: any) => {
        if (!h.date) return;
        const d = new Date(h.date);
        if (isNaN(d.getTime())) return;
        // Recurring holidays match every year by month-day; one-off ones match the exact date
        const key = h.recurring ? `r-${d.getMonth()}-${d.getDate()}` : `d-${format(d, 'yyyy-MM-dd')}`;
        holMap.set(key, [...(holMap.get(key) || []), { name: h.name, recurring: !!h.recurring }]);
      });
      setHolidaysByDay(holMap);

      const evtMap = new Map<string, CompanyEvent[]>();
      (events || []).forEach((e: any) => {
        if (!e.date) return;
        const key = format(new Date(e.date), 'yyyy-MM-dd');
        evtMap.set(key, [...(evtMap.get(key) || []), e]);
      });
      setEventsByDay(evtMap);
    } catch (err) {
      console.error('Error loading company calendar data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCalendarData();
  }, []);

  const gridDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth));
    const end = endOfWeek(endOfMonth(currentMonth));
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const getBirthdaysFor = (day: Date) => birthdaysByDay.get(`${day.getMonth()}-${day.getDate()}`) || [];
  const getHolidaysFor = (day: Date) => [
    ...(holidaysByDay.get(`r-${day.getMonth()}-${day.getDate()}`) || []),
    ...(holidaysByDay.get(`d-${format(day, 'yyyy-MM-dd')}`) || []),
  ];
  const getEventsFor = (day: Date) => eventsByDay.get(format(day, 'yyyy-MM-dd')) || [];

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
    if (!window.confirm(`Remove "${event.title}" from the calendar?`)) return;
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
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Company Calendar"
        subtitle="Birthdays, holidays and company events"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setCurrentMonth((m) => subMonths(m, 1))} icon={<ChevronLeft className="w-3.5 h-3.5" />}>
              Prev
            </Button>
            <span className="text-[13px] font-bold text-ink w-32 text-center">{format(currentMonth, 'MMMM yyyy')}</span>
            <Button variant="secondary" onClick={() => setCurrentMonth((m) => addMonths(m, 1))} icon={<ChevronRight className="w-3.5 h-3.5" />}>
              Next
            </Button>
            <Button variant="primary" onClick={() => setShowEventForm(true)} icon={<CalendarPlus className="w-3.5 h-3.5" />}>
              New Event
            </Button>
          </div>
        }
      />

      <Card padding="none" className="overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border bg-secondary">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="px-2 py-2 text-[10.5px] font-semibold text-muted-foreground text-center uppercase tracking-wide">
              {label}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {gridDays.map((day) => {
            const inMonth = isSameMonth(day, currentMonth);
            const birthdays = getBirthdaysFor(day);
            const holidays = getHolidaysFor(day);
            const events = getEventsFor(day);
            return (
              <div
                key={day.toISOString()}
                className={`min-h-[104px] border-b border-r border-border p-1.5 last:border-r-0 ${inMonth ? 'bg-white' : 'bg-secondary/40'}`}
              >
                <div
                  className={`text-[11px] font-semibold w-5 h-5 flex items-center justify-center rounded-full ${
                    isToday(day) ? 'bg-brand text-white' : inMonth ? 'text-ink' : 'text-subtle'
                  }`}
                >
                  {format(day, 'd')}
                </div>
                <div className="mt-1 space-y-1">
                  {events.map((e) => (
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
                  {holidays.map((h, i) => (
                    <div key={`h-${i}`} className="flex items-center gap-1 text-[10px] font-medium text-orange-text bg-orange-tint rounded px-1 py-0.5 truncate">
                      <PartyPopper className="w-2.5 h-2.5 flex-shrink-0" />
                      <span className="truncate">{h.name}</span>
                    </div>
                  ))}
                  {birthdays.slice(0, 2).map((b, i) => (
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

      {!loading && birthdaysByDay.size === 0 && holidaysByDay.size === 0 && eventsByDay.size === 0 && (
        <p className="text-[11.5px] text-muted-foreground text-center mt-4">No birthdays, holidays or events on record yet.</p>
      )}

      {showEventForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm">
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
          </Card>
        </div>
      )}
    </div>
  );
}
