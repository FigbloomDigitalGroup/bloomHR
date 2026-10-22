import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Cake, CalendarClock, CalendarDays, Check, CircleCheck, HandCoins, ListChecks, MessageCircle, PartyPopper, Plane,
  ReceiptText, Sprout, User, WalletCards,
} from 'lucide-react';
import toast from 'react-hot-toast';
import StatusPill from '../UI/StatusPill';
import EmptyState from '../UI/EmptyState';
import CompleteProfileCard from './CompleteProfileCard';
import { ResignationHomeLine } from './ResignationCards';
import { useMyOpenResignation } from './useMyOpenResignation';
import { StatusIcon } from '../Tasks/TaskBits';
import { BirthdayWishes, type Me } from '../Celebrations/BirthdayWishes';
import { supabase } from '../../lib/supabase';
import { loadMyOpenTasks, loadProjects, updateTask } from '../../lib/tasksApi';
import { currentEmployeeNumber, loadBirthdayPeople, loadCompanyEvents, loadHolidays, loadMyLeave } from '../../lib/upcomingApi';
import { comingUp, inDaysLabel, shortDay, type EventRow, type HolidayRow, type LeaveRow } from '../../lib/upcoming';
import { upcomingBirthdays, type UpcomingItem } from '../../lib/celebrations';
import { statusLabel, type Task } from '../../lib/tasks';
import {
  MY_WORK_LINK, STATUS_TONES, WEEK_DAYS, countsLine, dueBucket, dueLabel, orderMyTasks, quickLinks, taskCounts, withinDays,
  type QuickLinkIcon,
} from '../../lib/staffHome';
import { LoaderBlock } from '../UI/FigbloomLoader';
import LeaveAwaitingMe from '../Approvals/LeaveAwaitingMe';
import ClockCard from '../Attendance/ClockCard';

const SHOW_TASKS = 6;
const SHOW_WEEK = 8;

interface StaffHomeProps {
  /** opens a staff portal section */
  setActiveTab: (tab: string) => void;
  userName: string;
  /** opens Tasks with this task open (falls back to the Tasks list) */
  onOpenTask?: (taskId: string) => void;
  /** paid by work or given contract jobs: a "My work" quick link (FIG-812) */
  showMyWork?: boolean;
}

/**
 * The staff portal home: a greeting, Clock in / Clock out, "My tasks" (a quick look at what is assigned to me, overdue
 * first), "This week" (events, public holidays, birthdays and my own leave in the next 7 days) and quick links at the
 * bottom.
 */
export default function StaffHome({ setActiveTab, userName, onOpenTask, showMyWork }: StaffHomeProps) {
  const [employeeNumber, setEmployeeNumber] = useState<string | null | undefined>(undefined);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [projects, setProjects] = useState<Record<string, string>>({});
  const [leave, setLeave] = useState<LeaveRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [birthdays, setBirthdays] = useState<UpcomingItem[]>([]);
  const [weekLoading, setWeekLoading] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  // a resignation under way stays in sight (resigning itself is in Profile, not the menu)
  const openResignation = useMyOpenResignation();

  useEffect(() => {
    let cancelled = false;
    const today = new Date();

    // tasks and leave: only for someone with an employee record
    currentEmployeeNumber()
      .catch(() => null)
      .then(async (num) => {
        if (cancelled) return;
        setEmployeeNumber(num);
        if (!num) {
          setTasks([]);
          return;
        }
        const [mine, projectList, myLeave] = await Promise.allSettled([loadMyOpenTasks(num), loadProjects(), loadMyLeave(num)]);
        if (cancelled) return;
        setTasks(mine.status === 'fulfilled' ? mine.value : []);
        if (projectList.status === 'fulfilled') setProjects(Object.fromEntries(projectList.value.map((p) => [p.id, p.name])));
        if (myLeave.status === 'fulfilled') setLeave(myLeave.value);
      });

    // the company's week: events, holidays and birthdays
    Promise.allSettled([loadCompanyEvents(), loadHolidays(), loadBirthdayPeople(), supabase.auth.getSession()]).then(
      ([ev, hol, people, session]) => {
        if (cancelled) return;
        if (ev.status === 'fulfilled') setEvents(ev.value);
        if (hol.status === 'fulfilled') setHolidays(hol.value);
        if (people.status === 'fulfilled') setBirthdays(withinDays(upcomingBirthdays(people.value, today, WEEK_DAYS), WEEK_DAYS));
        const user = session.status === 'fulfilled' ? session.value.data.session?.user : null;
        if (user) setMe({ id: user.id, email: (user.email || '').toLowerCase() });
        setWeekLoading(false);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const openTask = (id: string) => (onOpenTask ? onOpenTask(id) : setActiveTab('tasks'));

  const markDone = async (t: Task) => {
    try {
      await updateTask(t.id, { status: 'done' });
      setTasks((prev) => (prev ?? []).filter((x) => x.id !== t.id));
      toast.success(`${t.key} marked done`);
    } catch (e) {
      toast.error((e as Error).message || 'Could not mark the task done');
    }
  };

  return (
    <div className="px-3 py-2 md:p-6 space-y-4 md:space-y-6">
      <Greeting userName={userName} onProfile={() => setActiveTab('details')} />

      <CompleteProfileCard onOpen={() => setActiveTab('onboarding')} />

      {openResignation && <ResignationHomeLine exit={openResignation} onView={() => setActiveTab('resignation')} />}

      {/* clock in / clock out (only for someone with an employee record) */}
      {employeeNumber && <ClockCard />}

      {/* leave waiting on my decision (nothing when there is none) */}
      <LeaveAwaitingMe />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 items-start">
        <MyTasks
          tasks={tasks}
          employeeNumber={employeeNumber}
          projects={projects}
          onOpen={openTask}
          onMarkDone={markDone}
          onSeeAll={() => setActiveTab('tasks')}
        />
        <ThisWeek
          loading={weekLoading}
          events={events}
          holidays={holidays}
          leave={leave}
          birthdays={birthdays}
          me={me}
          tasksDueThisWeek={tasks ? taskCounts(tasks).thisWeek : 0}
          onSeeTasks={() => setActiveTab('tasks')}
          onViewCalendar={() => setActiveTab('company-calendar')}
        />
      </div>

      <QuickLinks onOpen={setActiveTab} showMyWork={showMyWork} />
    </div>
  );
}

function Greeting({ userName, onProfile }: { userName: string; onProfile: () => void }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = userName.trim().split(/\s+/)[0] || 'there';
  return (
    <div className="flex items-start justify-between gap-3 pt-2">
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-gray-500">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <h2 className="text-xl md:text-2xl font-light tracking-tight text-gray-900 leading-tight">
          {greeting}, <span className="font-bold">{firstName}</span>
          <span className="text-brand">.</span>
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">Here's your week.</p>
      </div>
      <button
        type="button"
        onClick={onProfile}
        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800 transition-colors shadow-sm"
      >
        <User className="w-3.5 h-3.5" />
        Profile
      </button>
    </div>
  );
}

function Section({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-4 md:p-5 shadow-sm min-w-0">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base md:text-lg font-bold text-gray-900">{title}</h3>
          {subtitle && <p className="text-[11px] md:text-xs text-gray-500 font-medium">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const linkButton = 'text-xs font-semibold text-brand hover:underline whitespace-nowrap mt-1';

function MyTasks({ tasks, employeeNumber, projects, onOpen, onMarkDone, onSeeAll }: {
  tasks: Task[] | null;
  employeeNumber: string | null | undefined;
  projects: Record<string, string>;
  onOpen: (id: string) => void;
  onMarkDone: (t: Task) => void;
  onSeeAll: () => void;
}) {
  const ordered = useMemo(() => orderMyTasks(tasks ?? [], employeeNumber), [tasks, employeeNumber]);
  const counts = taskCounts(ordered);
  const loading = tasks === null;
  return (
    <Section
      title="My tasks"
      subtitle={loading ? 'What you need to do' : ordered.length ? countsLine(counts) : 'What you need to do'}
      action={
        <button type="button" onClick={onSeeAll} className={linkButton}>
          See all my tasks →
        </button>
      }
    >
      {loading ? (
        <LoaderBlock label="Loading" compact />
      ) : ordered.length === 0 ? (
        <EmptyState icon={<CircleCheck className="w-5 h-5" />} title="Nothing assigned to you right now" description="New tasks for you will show here." />
      ) : (
        <ul className="divide-y divide-gray-100 -mx-2">
          {ordered.slice(0, SHOW_TASKS).map((t) => {
            const bucket = dueBucket(t.due_date);
            const dueTone = bucket === 'overdue' ? 'text-status-danger' : bucket === 'today' ? 'text-brand' : 'text-gray-500';
            return (
              <li key={t.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onOpen(t.id)}
                  className="flex-1 min-w-0 flex items-start gap-2.5 px-2 py-2.5 rounded-lg text-left hover:bg-gray-50 transition-colors"
                >
                  <span className="mt-0.5"><StatusIcon status={t.status} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-gray-900 truncate">{t.title}</span>
                    <span className="block text-xs text-gray-500 truncate">
                      <span className="font-mono">{t.key}</span>
                      {projects[t.project_id] ? ` · ${projects[t.project_id]}` : ''}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1 flex-shrink-0">
                    <StatusPill label={statusLabel(t.status)} tone={STATUS_TONES[t.status]} className="!px-2 !py-0.5 !text-[10px]" />
                    <span className={`text-[11px] font-semibold whitespace-nowrap ${dueTone}`}>{dueLabel(t.due_date)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onMarkDone(t)}
                  aria-label={`Mark ${t.key} done`}
                  title="Mark done"
                  className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-status-success hover:bg-green-tint transition-colors"
                >
                  <Check className="w-4 h-4" />
                </button>
              </li>
            );
          })}
          {ordered.length > SHOW_TASKS && (
            <li className="px-2 pt-2 text-xs text-gray-500">and {ordered.length - SHOW_TASKS} more</li>
          )}
        </ul>
      )}
    </Section>
  );
}

interface WeekItem {
  kind: 'event' | 'holiday' | 'birthday' | 'leave';
  key: string;
  title: string;
  date: Date;
  endDate?: Date;
  daysAway: number;
  detail?: string | null;
}

const KIND_ORDER: Record<WeekItem['kind'], number> = { holiday: 0, event: 1, leave: 2, birthday: 3 };

function ThisWeek({ loading, events, holidays, leave, birthdays, me, tasksDueThisWeek, onSeeTasks, onViewCalendar }: {
  loading: boolean;
  events: EventRow[];
  holidays: HolidayRow[];
  leave: LeaveRow[];
  birthdays: UpcomingItem[];
  me: Me | null;
  tasksDueThisWeek: number;
  onSeeTasks: () => void;
  onViewCalendar: () => void;
}) {
  const items = useMemo(() => {
    const today = new Date();
    const out: WeekItem[] = [];
    for (const e of comingUp({ events, holidays, leave }, today, WEEK_DAYS)) {
      if (e.kind === 'task' || e.kind === 'birthday') continue;
      out.push({ kind: e.kind, key: e.key, title: e.title, date: e.date, endDate: e.endDate, daysAway: e.daysAway, detail: e.detail });
    }
    for (const b of birthdays) {
      out.push({ kind: 'birthday', key: `b-${b.title}-${b.date.getTime()}`, title: b.title, date: b.date, daysAway: b.daysAway });
    }
    const sortDay = (i: WeekItem) => Math.max(0, i.daysAway);
    return out.sort((a, b) => sortDay(a) - sortDay(b) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.title.localeCompare(b.title));
  }, [events, holidays, leave, birthdays]);

  return (
    <Section
      title="This week"
      subtitle="The next 7 days"
      action={
        <button type="button" onClick={onViewCalendar} className={linkButton}>
          View calendar →
        </button>
      }
    >
      {/* today's birthdays: a happy birthday, or a prompt to send a wish */}
      <div className="mb-3 empty:hidden">
        <BirthdayWishes birthdays={birthdays} me={me} />
      </div>
      {tasksDueThisWeek > 0 && (
        <button
          type="button"
          onClick={onSeeTasks}
          className="mb-2 w-full flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <ListChecks className="w-4 h-4 text-brand flex-shrink-0" />
          {tasksDueThisWeek === 1 ? '1 of your tasks is due this week' : `${tasksDueThisWeek} of your tasks are due this week`}
        </button>
      )}
      {loading ? (
        <LoaderBlock label="Loading" compact />
      ) : items.length === 0 ? (
        <EmptyState icon={<CalendarDays className="w-5 h-5" />} title="Nothing on the calendar this week" />
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.slice(0, SHOW_WEEK).map((item) => <WeekRow key={item.key} item={item} />)}
          {items.length > SHOW_WEEK && (
            <li className="pt-2">
              <button type="button" onClick={onViewCalendar} className="text-xs text-gray-500 hover:text-brand">
                and {items.length - SHOW_WEEK} more
              </button>
            </li>
          )}
        </ul>
      )}
    </Section>
  );
}

function WeekRow({ item }: { item: WeekItem }) {
  const isToday = item.daysAway <= 0;
  const icon =
    item.kind === 'birthday' ? <Cake className="w-4 h-4" />
      : item.kind === 'holiday' ? <CalendarDays className="w-4 h-4" />
        : item.kind === 'leave' ? <Plane className="w-4 h-4" />
          : <PartyPopper className="w-4 h-4" />;
  const what =
    item.kind === 'holiday' ? 'Public holiday'
      : item.kind === 'birthday' ? 'Birthday'
        : item.kind === 'leave' ? (item.endDate && item.endDate.getTime() !== item.date.getTime() ? `Until ${shortDay(item.endDate)}` : 'One day')
          : item.detail || 'Company event';
  // a leave already under way shows as "On leave now"
  const when = item.daysAway < 0 ? 'Now' : item.daysAway <= 1 ? inDaysLabel(item.daysAway) : null;
  return (
    <li className="flex items-start gap-3 py-2">
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isToday ? 'bg-brand text-white' : 'bg-green-tint text-brand'}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900 truncate">{item.title}</p>
        <p className="text-xs text-gray-500 truncate">{what}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-xs font-semibold text-gray-700 whitespace-nowrap">{shortDay(item.daysAway < 0 ? new Date() : item.date)}</p>
        {when && <p className={`text-[11px] font-semibold ${isToday ? 'text-brand' : 'text-gray-500'}`}>{when}</p>}
      </div>
    </li>
  );
}

const LINK_ICONS: Record<QuickLinkIcon, ReactNode> = {
  leave: <CalendarClock className="w-5 h-5" strokeWidth={1.75} />,
  payslips: <ReceiptText className="w-5 h-5" strokeWidth={1.75} />,
  tasks: <ListChecks className="w-5 h-5" strokeWidth={1.75} />,
  calendar: <CalendarDays className="w-5 h-5" strokeWidth={1.75} />,
  chat: <MessageCircle className="w-5 h-5" strokeWidth={1.75} />,
  profile: <User className="w-5 h-5" strokeWidth={1.75} />,
  advance: <WalletCards className="w-5 h-5" strokeWidth={1.75} />,
  loans: <HandCoins className="w-5 h-5" strokeWidth={1.75} />,
  work: <Sprout className="w-5 h-5" strokeWidth={1.75} />,
};

function QuickLinks({ onOpen, showMyWork }: { onOpen: (tab: string) => void; showMyWork?: boolean }) {
  const links = showMyWork ? [MY_WORK_LINK, ...quickLinks()] : quickLinks();
  return (
    <nav aria-label="Quick links" className="space-y-2">
      <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Quick links</h3>
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2 md:gap-3">
        {links.map((l) => (
          <button
            key={l.tab}
            type="button"
            onClick={() => onOpen(l.tab)}
            className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2 py-3 text-center shadow-sm hover:border-brand/30 hover:bg-green-tint/30 transition-colors"
          >
            <span className="w-9 h-9 rounded-full bg-green-tint text-brand flex items-center justify-center">{LINK_ICONS[l.icon]}</span>
            <span className="text-[11px] md:text-xs font-medium text-gray-700 leading-tight">{l.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
