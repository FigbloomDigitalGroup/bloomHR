import { useEffect, useState } from 'react';
import { Cake, CalendarDays, PartyPopper, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import { chatService } from '../chat/services/chatServices';
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
  const [me, setMe] = useState<{ id: string; email: string } | null>(null);
  const [writingTo, setWritingTo] = useState<string | null>(null);
  const [wish, setWish] = useState('');
  const [sending, setSending] = useState(false);
  const [wished, setWished] = useState<Set<string>>(new Set());

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

  const firstName = (item: UpcomingItem) => item.title.split(' ')[0];
  const isMe = (item: UpcomingItem) => !!me && !!item.email && item.email.trim().toLowerCase() === me.email;
  const todays = birthdays.filter((b) => b.daysAway === 0);
  const mine = todays.find(isMe);
  const others = todays.filter((b) => !isMe(b));

  const startWish = (item: UpcomingItem) => {
    setWritingTo(item.email || null);
    setWish(`Happy birthday, ${firstName(item)}! 🎉 Wishing you a wonderful year ahead.`);
  };

  const sendWish = async (item: UpcomingItem) => {
    if (!me || !item.email || !wish.trim() || sending) return;
    setSending(true);
    try {
      const conversation = await chatService.startDirectMessage(item.email);
      await chatService.sendMessage(conversation, me.id, wish.trim());
      setWished((prev) => new Set(prev).add(item.email!));
      setWritingTo(null);
      toast.success(`Sent to ${firstName(item)} in Chat`);
    } catch (err) {
      toast.error((err as Error).message || 'The wish could not be sent');
    } finally {
      setSending(false);
    }
  };

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
      {mine && (
        <div className="mb-4 rounded-xl bg-brand text-white px-4 py-3 flex items-center gap-3">
          <Cake className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-semibold">Happy birthday, {firstName(mine)}! 🎉 Have a wonderful day.</p>
        </div>
      )}

      {/* today's birthdays: a prompt to send a wish */}
      {others.length > 0 && (
        <div className="mb-4 space-y-2">
          {others.map((b) => (
            <div key={b.title} className="rounded-xl border border-brand/30 bg-green-tint px-4 py-3">
              <div className="flex items-center gap-3 flex-wrap">
                <Cake className="w-5 h-5 text-brand flex-shrink-0" />
                <p className="text-sm text-gray-900 flex-1 min-w-[180px]">
                  It's <span className="font-semibold">{b.title}</span>'s birthday today!
                </p>
                {b.email && wished.has(b.email) ? (
                  <span className="text-xs font-semibold text-brand">Wish sent ✓</span>
                ) : b.email && writingTo !== b.email ? (
                  <button
                    type="button"
                    onClick={() => startWish(b)}
                    className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-semibold hover:bg-brand-dark transition-colors"
                  >
                    Send wishes
                  </button>
                ) : null}
              </div>
              {b.email && writingTo === b.email && (
                <div className="mt-3 space-y-2">
                  <textarea
                    value={wish}
                    onChange={(e) => setWish(e.target.value)}
                    rows={2}
                    maxLength={500}
                    aria-label={`Your birthday message to ${b.title}`}
                    className="w-full rounded-lg border border-gray-200 bg-white text-sm text-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/40"
                  />
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setWritingTo(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100">
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => sendWish(b)}
                      disabled={sending || !wish.trim()}
                      className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-semibold hover:bg-brand-dark disabled:opacity-60 inline-flex items-center gap-1.5"
                    >
                      <Send className="w-3.5 h-3.5" /> {sending ? 'Sending…' : 'Send'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8">
        {column('Birthdays', birthdays, 'No birthdays in the next 30 days.')}
        {column('Coming up', comingUp, 'No events or holidays in the next 30 days.')}
      </div>
    </section>
  );
}
