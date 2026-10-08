import { useEffect, useState } from 'react';
import { Cake, CalendarDays, PartyPopper } from 'lucide-react';
import { BirthdayWishes, type Me } from '../Celebrations/BirthdayWishes';
import { supabase } from '../../lib/supabase';
import { upcomingBirthdays, upcomingEventsAndHolidays, whenLabel, type UpcomingItem } from '../../lib/celebrations';

const WITHIN_DAYS = 30;
const SHOW = 5;

/**
 * Birthdays (name and day only, never the year) and the company events and public holidays coming up in the next
 * 30 days, for everyone in the staff portal. HR and admins add events in the company calendar. When it is someone's
 * birthday today, a banner prompts everyone else to send them a wish, which arrives as a direct message in Chat.
 */
export default function CelebrationsCard() {
  const [birthdays, setBirthdays] = useState<UpcomingItem[]>([]);
  const [comingUp, setComingUp] = useState<UpcomingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [people, events, holidays, session] = await Promise.all([
        supabase.from('employee_directory').select('"First Name", "Last Name", "Date of Birth", "Work Email"'),
        supabase.from('company_events').select('title, date, description'),
        supabase.from('holidays').select('name, date, recurring'),
        supabase.auth.getSession(),
      ]);
      if (cancelled) return;
      const user = session.data.session?.user;
      if (user) setMe({ id: user.id, email: (user.email || '').toLowerCase() });
      const today = new Date();
      setBirthdays(
        upcomingBirthdays(
          ((people.data || []) as Record<string, string | null>[]).map((p) => ({
            name: `${p['First Name'] || ''} ${p['Last Name'] || ''}`,
            dateOfBirth: p['Date of Birth'],
            email: p['Work Email'],
          })),
          today,
          WITHIN_DAYS
        )
      );
      setComingUp(upcomingEventsAndHolidays(events.data || [], holidays.data || [], today, WITHIN_DAYS));
      setLoading(false);
    })().catch(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const row = (item: UpcomingItem) => (
    <li key={`${item.kind}-${item.title}-${item.date.toISOString()}`} className="flex items-start gap-3 py-2">
      <span
        className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
          item.daysAway === 0 ? 'bg-brand text-white' : 'bg-green-tint text-brand'
        }`}
      >
        {item.kind === 'birthday' ? <Cake className="w-4 h-4" /> : item.kind === 'holiday' ? <CalendarDays className="w-4 h-4" /> : <PartyPopper className="w-4 h-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900 truncate">{item.title}</p>
        <p className="text-xs text-gray-500 truncate">
          {item.kind === 'holiday' ? 'Public holiday' : item.kind === 'birthday' ? 'Birthday' : item.detail || 'Company event'}
        </p>
      </div>
      <span className={`text-xs font-semibold whitespace-nowrap ${item.daysAway === 0 ? 'text-brand' : 'text-gray-500'}`}>
        {whenLabel(item)}
      </span>
    </li>
  );

  const column = (title: string, items: UpcomingItem[], empty: string) => (
    <div className="min-w-0">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{title}</h4>
      {loading ? (
        <div className="space-y-2 py-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-9 rounded-lg bg-gray-100 animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500 py-3">{empty}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.slice(0, SHOW).map(row)}
          {items.length > SHOW && <li className="pt-2 text-xs text-gray-500">and {items.length - SHOW} more this month</li>}
        </ul>
      )}
    </div>
  );

  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-4 md:p-6 shadow-sm">
      <div className="mb-3">
        <h3 className="text-base md:text-lg font-bold text-gray-900">Celebrations & events</h3>
        <p className="text-[10px] md:text-xs text-gray-500 font-medium">The next 30 days at your company</p>
      </div>
      {/* today's birthdays: a happy birthday, or a prompt to send a wish */}
      <div className="mb-4 empty:hidden">
        <BirthdayWishes birthdays={birthdays} me={me} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8">
        {column('Birthdays', birthdays, 'No birthdays in the next 30 days.')}
        {column('Coming up', comingUp, 'No events or holidays in the next 30 days.')}
      </div>
    </section>
  );
}
