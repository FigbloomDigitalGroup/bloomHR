import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CalendarPlus, ListTodo, PartyPopper } from 'lucide-react';
import { leaveHints, nextHolidays, shortDay, tasksDuringLeave, inDaysLabel, type EventRow, type HolidayRow, type TaskRow } from '../../lib/upcoming';
import { loadCompanyEvents, loadHolidays, loadMyTasks } from '../../lib/upcomingApi';

const NEXT_HOLIDAYS = 3;

/**
 * Planning help on the leave form: the next public holidays (to plan around), and, once dates are picked, the holidays
 * and company events in or right next to the leave and the employee's tasks due during it. It only informs: nothing
 * here stops an application (the database already leaves holidays and non-work days out of the count).
 */
export default function LeavePlanningHints({
  employeeNumber,
  startDate,
  endDate,
  onSeeCalendar,
  today = new Date(),
}: {
  employeeNumber: string;
  startDate: string;
  endDate: string;
  onSeeCalendar?: () => void;
  today?: Date;
}) {
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadHolidays(), loadCompanyEvents()])
      .then(([h, e]) => {
        if (cancelled) return;
        setHolidays(h);
        setEvents(e);
      })
      .catch((err) => console.error('Could not load holidays and events for the leave form:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!employeeNumber) return;
    let cancelled = false;
    loadMyTasks(employeeNumber)
      .then((t) => !cancelled && setTasks(t))
      .catch((err) => console.error('Could not load your tasks for the leave form:', err));
    return () => {
      cancelled = true;
    };
  }, [employeeNumber]);

  const upcomingHolidays = nextHolidays(holidays, today, NEXT_HOLIDAYS);
  const hints = useMemo(() => leaveHints(startDate, endDate || startDate, events, holidays), [startDate, endDate, events, holidays]);
  const dueTasks = useMemo(() => tasksDuringLeave(startDate, endDate || startDate, tasks, employeeNumber), [startDate, endDate, tasks, employeeNumber]);

  const seeCalendar = onSeeCalendar && (
    <button type="button" onClick={onSeeCalendar} className="text-[11.5px] font-semibold text-brand hover:underline whitespace-nowrap">
      See calendar
    </button>
  );

  return (
    <div className="space-y-2" data-testid="leave-planning">
      {upcomingHolidays.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-gray-600" data-testid="next-holidays">
          <CalendarDays className="w-3.5 h-3.5 text-orange-text flex-shrink-0" />
          <span className="font-medium">Next public holidays:</span>
          {upcomingHolidays.map((h, i) => (
            <span key={`${h.name}-${h.date.getTime()}`}>
              {h.name} ({shortDay(h.date)}, {inDaysLabel(h.daysAway).toLowerCase()}){i < upcomingHolidays.length - 1 ? ' ·' : ''}
            </span>
          ))}
          {!startDate && seeCalendar}
        </div>
      )}

      {startDate && (hints.length > 0 || dueTasks.length > 0) && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-1.5" data-testid="leave-hints" role="status">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11.5px] font-semibold text-gray-700 m-0">Around these dates</p>
            {seeCalendar}
          </div>
          {hints.map((h) => (
            <p key={`${h.kind}-${h.title}-${h.date.getTime()}`} className="flex items-start gap-1.5 text-[11.5px] text-gray-700 m-0">
              {h.kind === 'holiday' ? <PartyPopper className="w-3.5 h-3.5 mt-0.5 text-orange-text flex-shrink-0" /> : <CalendarPlus className="w-3.5 h-3.5 mt-0.5 text-status-purple flex-shrink-0" />}
              <span>{h.text}</span>
            </p>
          ))}
          {dueTasks.length > 0 && (
            <div className="flex items-start gap-1.5 text-[11.5px] text-gray-700">
              <ListTodo className="w-3.5 h-3.5 mt-0.5 text-amber-700 flex-shrink-0" />
              <div>
                <p className="m-0">
                  {dueTasks.length === 1 ? '1 of your tasks is' : `${dueTasks.length} of your tasks are`} due during this leave:
                </p>
                <ul className="m-0 pl-4 list-disc">
                  {dueTasks.map((t) => (
                    <li key={t.id}>
                      {t.key ? `${t.key} ` : ''}{t.title} (due {shortDay(t.due)})
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
